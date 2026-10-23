package perf

import (
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// procStat /proc/<pid>/stat 或 /proc/<pid>/task/<tid>/stat 中用到的字段
type procStat struct {
	Pid       int
	Comm      string
	Utime     uint64 // 单位 jiffies
	Stime     uint64
	StartTime uint64 // 开机后第几个 jiffy 启动，与 pid 组合作为进程身份
}

// cpuTimes /proc/stat 中一行 cpu 的累计时间，单位 jiffies
type cpuTimes struct {
	Total uint64
	Idle  uint64 // idle + iowait
}

type perfPolicy struct {
	Cpus        []int
	MaxFreq     int // kHz
	CurFreq     int // kHz
	TimeInState map[int]uint64
}

type perfProcRaw struct {
	Name   string
	Stat   procStat
	Status map[string]int64 // RssAnon/RssFile/RssShmem/VmSwap，单位 KB；Threads 为个数
	Tasks  []procStat
}

// perfFastRaw 一次高频采样的原始数据
type perfFastRaw struct {
	DeviceMs int64
	CpuAll   cpuTimes
	Cores    map[int]cpuTimes
	Policies []perfPolicy
	Procs    []perfProcRaw
}

const (
	secPerfTime   = "##TIME"
	secPerfStat   = "##STAT"
	secPerfFreq   = "##FREQ"
	secPerfTis    = "##TIS"
	secPerfProc   = "##PROC"   // ##PROC <pid> <name>
	secPerfStatus = "##STATUS" // ##STATUS <pid>
	secPerfTask   = "##TASK"   // ##TASK <pid>
	secPerfMem    = "##MEM"    // ##MEM <pid>
	secPerfTherm  = "##THERMAL"
)

// buildFastScript 高频采样脚本：一次 adb shell 读完 CPU、频率和包名下所有进程的 /proc 数据
func buildFastScript(packageName string) string {
	return strings.Join([]string{
		"echo '" + secPerfTime + "'",
		"date +%s%N",
		"echo '" + secPerfStat + "'",
		"grep '^cpu' /proc/stat",
		"echo '" + secPerfFreq + "'",
		`for p in /sys/devices/system/cpu/cpufreq/policy*; do [ -d $p ] && echo "$(cat $p/related_cpus)|$(cat $p/cpuinfo_max_freq)|$(cat $p/scaling_cur_freq)"; done`,
		"echo '" + secPerfTis + "'",
		"grep -H . /sys/devices/system/cpu/cpufreq/policy*/stats/time_in_state 2>/dev/null",
		"PKG=" + packageName,
		`ps -A -o PID,NAME | while read P N; do case "$N" in "$PKG"|"$PKG":*)`,
		`  echo "` + secPerfProc + ` $P $N"; cat /proc/$P/stat 2>/dev/null`,
		`  echo "` + secPerfStatus + ` $P"; grep -E '^(RssAnon|RssFile|RssShmem|VmSwap|Threads):' /proc/$P/status 2>/dev/null`,
		`  echo "` + secPerfTask + ` $P"; cat /proc/$P/task/*/stat 2>/dev/null;;`,
		`esac; done`,
	}, "\n")
}

// buildSlowScript 低频采样脚本：逐个进程 dumpsys meminfo（按 pid，按包名只会输出同名进程），再读温度
func buildSlowScript(pids []int) string {
	lines := make([]string, 0, len(pids)*2+2)
	for _, pid := range pids {
		lines = append(lines, "echo '"+secPerfMem+" "+strconv.Itoa(pid)+"'", "dumpsys meminfo "+strconv.Itoa(pid))
	}
	lines = append(lines, "echo '"+secPerfTherm+"'", "dumpsys thermalservice")
	return strings.Join(lines, "\n")
}

func parseFastOutput(output string) perfFastRaw {
	raw := perfFastRaw{Cores: map[int]cpuTimes{}}
	var policyLines []string
	tis := map[int]map[int]uint64{} // policy 首个 cpu -> freq -> time
	var tisLines []string
	var cur *perfProcRaw
	section := ""

	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, "##") {
			fields := strings.Fields(line)
			section = fields[0]
			switch section {
			case secPerfProc:
				if len(fields) >= 3 {
					raw.Procs = append(raw.Procs, perfProcRaw{Name: fields[2], Status: map[string]int64{}})
					cur = &raw.Procs[len(raw.Procs)-1]
				} else {
					cur = nil
				}
			}
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		switch section {
		case secPerfTime:
			if ns, err := strconv.ParseInt(line, 10, 64); err == nil {
				raw.DeviceMs = ns / 1e6
			}
		case secPerfStat:
			name, times, ok := parseCpuLine(line)
			if !ok {
				continue
			}
			if name == "cpu" {
				raw.CpuAll = times
			} else if idx, err := strconv.Atoi(strings.TrimPrefix(name, "cpu")); err == nil {
				raw.Cores[idx] = times
			}
		case secPerfFreq:
			policyLines = append(policyLines, line)
		case secPerfTis:
			tisLines = append(tisLines, line)
		case secPerfProc:
			if cur != nil {
				if st, ok := parseProcStat(line); ok {
					cur.Stat = st
				}
			}
		case secPerfStatus:
			if cur != nil {
				if key, value, ok := parseStatusLine(line); ok {
					cur.Status[key] = value
				}
			}
		case secPerfTask:
			if cur != nil {
				if st, ok := parseProcStat(line); ok {
					cur.Tasks = append(cur.Tasks, st)
				}
			}
		}
	}

	// time_in_state：/sys/devices/system/cpu/cpufreq/policy<N>/stats/time_in_state:<freq> <time>
	for _, line := range tisLines {
		idx := strings.LastIndex(line, ":")
		if idx < 0 {
			continue
		}
		policy := 0
		for _, part := range strings.Split(line[:idx], "/") {
			if strings.HasPrefix(part, "policy") {
				policy, _ = strconv.Atoi(strings.TrimPrefix(part, "policy"))
			}
		}
		fields := strings.Fields(line[idx+1:])
		if len(fields) != 2 {
			continue
		}
		freq, err1 := strconv.Atoi(fields[0])
		t, err2 := strconv.ParseUint(fields[1], 10, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		if tis[policy] == nil {
			tis[policy] = map[int]uint64{}
		}
		tis[policy][freq] = t
	}

	for _, line := range policyLines {
		parts := strings.Split(line, "|")
		if len(parts) != 3 {
			continue
		}
		cpus := parseCpuList(strings.Join(strings.Fields(parts[0]), ","))
		if len(cpus) == 0 {
			continue
		}
		maxFreq, _ := strconv.Atoi(strings.TrimSpace(parts[1]))
		curFreq, _ := strconv.Atoi(strings.TrimSpace(parts[2]))
		raw.Policies = append(raw.Policies, perfPolicy{
			Cpus:        cpus,
			MaxFreq:     maxFreq,
			CurFreq:     curFreq,
			TimeInState: tis[cpus[0]],
		})
	}
	sort.Slice(raw.Policies, func(i, j int) bool { return raw.Policies[i].Cpus[0] < raw.Policies[j].Cpus[0] })
	return raw
}

// parseCpuLine 解析 /proc/stat 的 cpu 行：user nice system idle iowait irq softirq steal ...
func parseCpuLine(line string) (string, cpuTimes, bool) {
	fields := strings.Fields(line)
	if len(fields) < 5 || !strings.HasPrefix(fields[0], "cpu") {
		return "", cpuTimes{}, false
	}
	var values [8]uint64
	for i := 1; i < len(fields) && i <= 8; i++ {
		values[i-1], _ = strconv.ParseUint(fields[i], 10, 64)
	}
	var total uint64
	for _, v := range values {
		total += v
	}
	// iowait 计入空闲，与 Linux 通常口径一致
	return fields[0], cpuTimes{Total: total, Idle: values[3] + values[4]}, true
}

// parseProcStat comm 可能包含空格和括号，以最后一个 ')' 为界
func parseProcStat(line string) (procStat, bool) {
	l := strings.Index(line, "(")
	r := strings.LastIndex(line, ")")
	if l < 0 || r < l {
		return procStat{}, false
	}
	pid, err := strconv.Atoi(strings.TrimSpace(line[:l]))
	if err != nil {
		return procStat{}, false
	}
	// fields[0] 为第 3 个字段 state，第 n 个字段对应 fields[n-3]
	fields := strings.Fields(line[r+1:])
	if len(fields) < 20 {
		return procStat{}, false
	}
	utime, _ := strconv.ParseUint(fields[11], 10, 64)
	stime, _ := strconv.ParseUint(fields[12], 10, 64)
	start, _ := strconv.ParseUint(fields[19], 10, 64)
	return procStat{Pid: pid, Comm: line[l+1 : r], Utime: utime, Stime: stime, StartTime: start}, true
}

func parseStatusLine(line string) (string, int64, bool) {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return "", 0, false
	}
	fields := strings.Fields(line[idx+1:])
	if len(fields) == 0 {
		return "", 0, false
	}
	value, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return "", 0, false
	}
	return line[:idx], value, true
}

// ProcessMemInfo 单个进程一次 dumpsys meminfo 的结果
type ProcessMemInfo struct {
	MemInfo
	Pid      int              `json:"pid"`
	Process  string           `json:"process"`
	TotalRss int64            `json:"totalRss"`
	SwapPss  int64            `json:"swapPss"`
	Objects  map[string]int64 `json:"objects"`
}

var (
	reMemInfoHeader = regexp.MustCompile(`\*\* MEMINFO in pid (\d+) \[([^\]]+)\] \*\*`)
	reTotalRss      = regexp.MustCompile(`TOTAL RSS:\s+(\d+)`)
	reTotalSwapPss  = regexp.MustCompile(`TOTAL SWAP(?: PSS)?(?: \(KB\))?:\s+(\d+)`)
	reObjectPair    = regexp.MustCompile(`([A-Za-z][A-Za-z ]*?):\s+(\d+)`)
)

func parsePerfMemInfo(pid int, output string) (ProcessMemInfo, bool) {
	header := reMemInfoHeader.FindStringSubmatch(output)
	if header == nil {
		return ProcessMemInfo{}, false
	}
	info := ProcessMemInfo{MemInfo: parseMemInfo(output), Pid: pid, Process: header[2], Objects: map[string]int64{}}
	if info.TotalPSS == 0 {
		return ProcessMemInfo{}, false
	}
	info.RawMemInfo = output
	if m := reTotalRss.FindStringSubmatch(output); m != nil {
		info.TotalRss, _ = strconv.ParseInt(m[1], 10, 64)
	}
	if m := reTotalSwapPss.FindStringSubmatch(output); m != nil {
		info.SwapPss, _ = strconv.ParseInt(m[1], 10, 64)
	}

	inObjects := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "Objects" {
			inObjects = true
			continue
		}
		if !inObjects {
			continue
		}
		if trimmed == "" {
			break
		}
		for _, m := range reObjectPair.FindAllStringSubmatch(trimmed, -1) {
			value, _ := strconv.ParseInt(m[2], 10, 64)
			info.Objects[strings.TrimSpace(m[1])] = value
		}
	}
	return info, true
}

var (
	reThermalTemp      = regexp.MustCompile(`Temperature\{mValue=([-\d.]+),\s*mType=(\d+),\s*mName=([^,]+)`)
	reThermalThreshold = regexp.MustCompile(`TemperatureThreshold\{mType=0,.*?mHotThrottlingThresholds=\[([^\]]*)\]`)
	reThermalStatus    = regexp.MustCompile(`^Thermal Status:\s*(\d+)`)
)

// Thermal CPU 温度
type Thermal struct {
	CpuTemp       float64 `json:"cpuTemp"`       // 当前 CPU 传感器中的最高温度，0 表示未知
	ThrottleTemp  float64 `json:"throttleTemp"`  // 最低一级的降频阈值，0 表示未知
	ThermalStatus int     `json:"thermalStatus"` // PowerManager.THERMAL_STATUS_*，0 为正常
}

// parseThermal 只取 "Current temperatures from HAL" 一段，"Cached temperatures" 可能是很久之前的值
func parseThermal(output string) Thermal {
	var thermal Thermal
	section := ""
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if m := reThermalStatus.FindStringSubmatch(trimmed); m != nil {
			thermal.ThermalStatus, _ = strconv.Atoi(m[1])
			continue
		}
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && strings.HasSuffix(trimmed, ":") {
			section = trimmed
			continue
		}
		switch section {
		case "Current temperatures from HAL:":
			// mType=0 为 TYPE_CPU
			if m := reThermalTemp.FindStringSubmatch(trimmed); m != nil && m[2] == "0" {
				if value, err := strconv.ParseFloat(m[1], 64); err == nil && value > thermal.CpuTemp {
					thermal.CpuTemp = value
				}
			}
		case "Temperature static thresholds from HAL:":
			if m := reThermalThreshold.FindStringSubmatch(trimmed); m != nil && thermal.ThrottleTemp == 0 {
				for _, part := range strings.Split(m[1], ",") {
					value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
					if err == nil && !math.IsNaN(value) {
						thermal.ThrottleTemp = value
						break
					}
				}
			}
		}
	}
	return thermal
}

// splitSlowOutput 按 ##MEM <pid> / ##THERMAL 切分低频采样输出
func splitSlowOutput(output string) (map[int]string, string) {
	mem := map[int]string{}
	var thermal strings.Builder
	var current *strings.Builder
	currentPid := 0
	flush := func() {
		if current != nil && currentPid > 0 {
			mem[currentPid] = current.String()
		}
		current, currentPid = nil, 0
	}
	inThermal := false
	for _, line := range strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(line, secPerfMem+" ") {
			flush()
			inThermal = false
			currentPid, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, secPerfMem)))
			current = &strings.Builder{}
			continue
		}
		if strings.TrimSpace(line) == secPerfTherm {
			flush()
			inThermal = true
			continue
		}
		if inThermal {
			thermal.WriteString(line)
			thermal.WriteByte('\n')
		} else if current != nil {
			current.WriteString(line)
			current.WriteByte('\n')
		}
	}
	flush()
	return mem, thermal.String()
}
