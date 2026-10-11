package adb

import (
	"bytes"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"adb-tool-wails/util"
)

// ProcessBrief 包名对应的一个进程（主进程或 :xxx 子进程）
type ProcessBrief struct {
	Pid  int    `json:"pid"`
	Name string `json:"name"`
}

// CpuCluster 一个 CPU 簇（同一 cpufreq policy 下的核）
type CpuCluster struct {
	Label   string `json:"label"`   // 小核 / 中核 / 大核 / 超大核
	Cpus    []int  `json:"cpus"`    // 该簇包含的核
	MaxFreq int    `json:"maxFreq"` // 最高频率，单位 kHz；未知为 0
}

// ThreadSched 单个线程的调度信息
type ThreadSched struct {
	Tid         int    `json:"tid"`
	Name        string `json:"name"`
	State       string `json:"state"`
	Prio        int    `json:"prio"` // 内核 prio，与 systrace/perfetto 一致：CFS 为 120+nice，RT 为 99-rtprio
	Nice        int    `json:"nice"`
	NiceName    string `json:"niceName"` // 对应的 Android Process.THREAD_PRIORITY_* 常量
	Policy      string `json:"policy"`   // OTHER / FIFO / RR / BATCH / IDLE / DEADLINE
	RtPriority  int    `json:"rtPriority"`
	CpusAllowed string `json:"cpusAllowed"` // Cpus_allowed_list 原始值，例如 0-3,7
	AllowedCpus []int  `json:"allowedCpus"`
	Cpuset      string `json:"cpuset"` // 例如 /top-app、/background
}

// ThreadSchedResult GetThreadSchedInfo 的返回值
type ThreadSchedResult struct {
	Cmd       string         `json:"cmd"`
	Processes []ProcessBrief `json:"processes"`
	Pid       int            `json:"pid"`
	Clusters  []CpuCluster   `json:"clusters"`
	Threads   []ThreadSched  `json:"threads"`
}

var rePackageName = regexp.MustCompile(`^[A-Za-z0-9._]+$`)

const (
	secProcs    = "##PROCS"
	secPid      = "##PID"
	secStat     = "##STAT"
	secAllowed  = "##ALLOWED"
	secCpuset   = "##CPUSET"
	secPolicy   = "##POLICY"
	secCapacity = "##CAPACITY"
)

// GetThreadSchedInfo 获取指定进程所有线程的优先级与可运行核信息。
// pid <= 0 时取包名对应的主进程。所有数据通过一次 adb shell 获取，无需 root。
func GetThreadSchedInfo(adbPath, deviceId, packageName string, pid int) (ThreadSchedResult, error) {
	var result ThreadSchedResult
	if !rePackageName.MatchString(packageName) {
		return result, fmt.Errorf("包名不合法: %s", packageName)
	}

	pidExpr := strconv.Itoa(pid)
	if pid <= 0 {
		pidExpr = fmt.Sprintf("$(pidof %s | cut -d' ' -f1)", packageName)
	}

	script := strings.Join([]string{
		"echo '" + secProcs + "'",
		"ps -A -o PID,NAME",
		"P=" + pidExpr,
		"echo '" + secPid + "'",
		"echo $P",
		`[ -n "$P" ] && [ -d /proc/$P/task ] || exit 0`,
		"echo '" + secStat + "'",
		"cat /proc/$P/task/*/stat 2>/dev/null",
		"echo '" + secAllowed + "'",
		"grep -H Cpus_allowed_list /proc/$P/task/*/status 2>/dev/null",
		"echo '" + secCpuset + "'",
		"grep -H . /proc/$P/task/*/cpuset 2>/dev/null",
		"echo '" + secPolicy + "'",
		`for p in /sys/devices/system/cpu/cpufreq/policy*; do [ -d $p ] && echo "$(cat $p/related_cpus) | $(cat $p/cpuinfo_max_freq)"; done`,
		"echo '" + secCapacity + "'",
		"grep -H . /sys/devices/system/cpu/cpu[0-9]*/cpu_capacity 2>/dev/null",
	}, "\n")

	args := []string{}
	if deviceId != "" {
		args = append(args, "-s", deviceId)
	}
	args = append(args, "shell", script)
	result.Cmd = fmt.Sprintf("%s %s", adbPath, strings.Join(args[:len(args)-1], " ")) + " <thread-sched-script>"

	cmd := exec.Command(adbPath, args...)
	util.ConfigureCommand(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return result, fmt.Errorf("执行 adb 失败: %s", msg)
	}

	sections := splitSections(strings.ReplaceAll(stdout.String(), "\r\n", "\n"))
	result.Processes = parseProcesses(sections[secProcs], packageName)
	result.Pid, _ = strconv.Atoi(strings.TrimSpace(strings.Join(sections[secPid], "")))
	if result.Pid <= 0 || len(sections[secStat]) == 0 {
		if pid > 0 {
			return result, fmt.Errorf("进程 %d 不存在，请刷新", pid)
		}
		return result, fmt.Errorf("未找到进程 %s，请检查应用是否运行", packageName)
	}

	result.Clusters = parseClusters(sections[secPolicy], sections[secCapacity])
	result.Threads = parseThreads(sections[secStat], sections[secAllowed], sections[secCpuset])
	return result, nil
}

func splitSections(output string) map[string][]string {
	sections := map[string][]string{}
	current := ""
	for _, line := range strings.Split(output, "\n") {
		if strings.HasPrefix(line, "##") {
			current = strings.TrimSpace(line)
			sections[current] = nil
			continue
		}
		if current != "" && strings.TrimSpace(line) != "" {
			sections[current] = append(sections[current], line)
		}
	}
	return sections
}

func parseProcesses(lines []string, packageName string) []ProcessBrief {
	var processes []ProcessBrief
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil {
			continue
		}
		name := fields[1]
		if name == packageName || strings.HasPrefix(name, packageName+":") {
			processes = append(processes, ProcessBrief{Pid: pid, Name: name})
		}
	}
	sort.Slice(processes, func(i, j int) bool {
		if (processes[i].Name == packageName) != (processes[j].Name == packageName) {
			return processes[i].Name == packageName
		}
		return processes[i].Pid < processes[j].Pid
	})
	return processes
}

// parseTaskKeyValue 解析 grep -H 的输出：/proc/<pid>/task/<tid>/<file>:<value>
func parseTaskKeyValue(lines []string, trimPrefix string) map[int]string {
	values := map[int]string{}
	for _, line := range lines {
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		path, value := line[:idx], line[idx+1:]
		parts := strings.Split(path, "/")
		// ["", "proc", pid, "task", tid, file]
		if len(parts) < 6 {
			continue
		}
		tid, err := strconv.Atoi(parts[4])
		if err != nil {
			continue
		}
		value = strings.TrimPrefix(value, trimPrefix)
		values[tid] = strings.TrimSpace(value)
	}
	return values
}

func parseThreads(statLines, allowedLines, cpusetLines []string) []ThreadSched {
	allowed := parseTaskKeyValue(allowedLines, "Cpus_allowed_list:")
	cpusets := parseTaskKeyValue(cpusetLines, "")

	var threads []ThreadSched
	for _, line := range statLines {
		// 线程名可能包含空格或括号，按第一个 "(" 与最后一个 ")" 切分
		open := strings.Index(line, "(")
		closeIdx := strings.LastIndex(line, ")")
		if open < 0 || closeIdx < open {
			continue
		}
		tid, err := strconv.Atoi(strings.TrimSpace(line[:open]))
		if err != nil {
			continue
		}
		// fields[0] 对应 stat 第 3 个字段 state，因此第 n 个字段为 fields[n-3]
		fields := strings.Fields(line[closeIdx+1:])
		if len(fields) < 39 {
			continue
		}
		priority, _ := strconv.Atoi(fields[15])
		nice, _ := strconv.Atoi(fields[16])
		rtPriority, _ := strconv.Atoi(fields[37])
		policy, _ := strconv.Atoi(fields[38])

		cpusAllowed := allowed[tid]
		threads = append(threads, ThreadSched{
			Tid:         tid,
			Name:        line[open+1 : closeIdx],
			State:       fields[0],
			Prio:        priority + 100,
			Nice:        nice,
			NiceName:    androidPriorityName(nice),
			Policy:      schedPolicyName(policy),
			RtPriority:  rtPriority,
			CpusAllowed: cpusAllowed,
			AllowedCpus: parseCpuList(cpusAllowed),
			Cpuset:      cpusets[tid],
		})
	}
	sort.Slice(threads, func(i, j int) bool { return threads[i].Tid < threads[j].Tid })
	return threads
}

// parseClusters 优先按 cpufreq policy 分簇，缺失时按 cpu_capacity 分簇；按性能从低到高排序
func parseClusters(policyLines, capacityLines []string) []CpuCluster {
	var clusters []CpuCluster
	for _, line := range policyLines {
		parts := strings.SplitN(line, "|", 2)
		if len(parts) != 2 {
			continue
		}
		var cpus []int
		for _, f := range strings.Fields(parts[0]) {
			if cpu, err := strconv.Atoi(f); err == nil {
				cpus = append(cpus, cpu)
			}
		}
		if len(cpus) == 0 {
			continue
		}
		freq, _ := strconv.Atoi(strings.TrimSpace(parts[1]))
		clusters = append(clusters, CpuCluster{Cpus: cpus, MaxFreq: freq})
	}

	if len(clusters) == 0 {
		capacityToCpus := map[int][]int{}
		for cpu, value := range parseCpuKeyValue(capacityLines) {
			capacityToCpus[value] = append(capacityToCpus[value], cpu)
		}
		for _, cpus := range capacityToCpus {
			sort.Ints(cpus)
			clusters = append(clusters, CpuCluster{Cpus: cpus})
		}
		capacity := parseCpuKeyValue(capacityLines)
		sort.Slice(clusters, func(i, j int) bool {
			return capacity[clusters[i].Cpus[0]] < capacity[clusters[j].Cpus[0]]
		})
	} else {
		sort.SliceStable(clusters, func(i, j int) bool {
			if clusters[i].MaxFreq != clusters[j].MaxFreq {
				return clusters[i].MaxFreq < clusters[j].MaxFreq
			}
			return clusters[i].Cpus[0] < clusters[j].Cpus[0]
		})
	}

	labels := clusterLabels(len(clusters))
	for i := range clusters {
		clusters[i].Label = labels[i]
	}
	return clusters
}

// parseCpuKeyValue 解析 /sys/devices/system/cpu/cpu<N>/<file>:<int>
func parseCpuKeyValue(lines []string) map[int]int {
	values := map[int]int{}
	for _, line := range lines {
		idx := strings.LastIndex(line, ":")
		if idx < 0 {
			continue
		}
		parts := strings.Split(line[:idx], "/")
		if len(parts) < 2 {
			continue
		}
		cpu, err := strconv.Atoi(strings.TrimPrefix(parts[len(parts)-2], "cpu"))
		if err != nil {
			continue
		}
		value, err := strconv.Atoi(strings.TrimSpace(line[idx+1:]))
		if err != nil {
			continue
		}
		values[cpu] = value
	}
	return values
}

func clusterLabels(n int) []string {
	switch n {
	case 1:
		return []string{"全部核"}
	case 2:
		return []string{"小核", "大核"}
	case 3:
		return []string{"小核", "大核", "超大核"}
	case 4:
		return []string{"小核", "中核", "大核", "超大核"}
	}
	labels := make([]string, n)
	for i := range labels {
		labels[i] = fmt.Sprintf("簇%d", i)
	}
	return labels
}

// parseCpuList 解析 0-3,6,7 形式的 CPU 列表
func parseCpuList(list string) []int {
	var cpus []int
	for _, part := range strings.Split(list, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if lo, hi, ok := strings.Cut(part, "-"); ok {
			start, err1 := strconv.Atoi(lo)
			end, err2 := strconv.Atoi(hi)
			if err1 != nil || err2 != nil {
				continue
			}
			for cpu := start; cpu <= end; cpu++ {
				cpus = append(cpus, cpu)
			}
		} else if cpu, err := strconv.Atoi(part); err == nil {
			cpus = append(cpus, cpu)
		}
	}
	return cpus
}

func schedPolicyName(policy int) string {
	switch policy {
	case 0:
		return "OTHER"
	case 1:
		return "FIFO"
	case 2:
		return "RR"
	case 3:
		return "BATCH"
	case 5:
		return "IDLE"
	case 6:
		return "DEADLINE"
	}
	return strconv.Itoa(policy)
}

// androidPriorityName nice 值对应的 android.os.Process.THREAD_PRIORITY_* 常量
func androidPriorityName(nice int) string {
	switch nice {
	case 19:
		return "LOWEST"
	case 10:
		return "BACKGROUND"
	case 1:
		return "LESS_FAVORABLE"
	case 0:
		return "DEFAULT"
	case -1:
		return "MORE_FAVORABLE"
	case -2:
		return "FOREGROUND"
	case -4:
		return "DISPLAY"
	case -8:
		return "URGENT_DISPLAY"
	case -10:
		return "VIDEO"
	case -16:
		return "AUDIO"
	case -19:
		return "URGENT_AUDIO"
	}
	return ""
}
