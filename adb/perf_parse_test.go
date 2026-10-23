package adb

import (
	"math"
	"strings"
	"testing"
)

func TestParseProcStat(t *testing.T) {
	// comm 中包含空格和括号时以最后一个 ')' 为界
	line := "7561 (Audio (Track) 1) S 2646 2372 0 0 -1 1077952576 100 0 0 0 250 120 0 0 -3 0 30 0 13925043 1000 200"
	st, ok := parseProcStat(line)
	if !ok {
		t.Fatal("parse failed")
	}
	if st.Pid != 7561 || st.Comm != "Audio (Track) 1" || st.Utime != 250 || st.Stime != 120 || st.StartTime != 13925043 {
		t.Fatalf("unexpected stat: %+v", st)
	}
	if _, ok := parseProcStat("garbage"); ok {
		t.Fatal("garbage should not parse")
	}
}

func TestParseFastOutput(t *testing.T) {
	output := strings.Join([]string{
		"##TIME", "1792723934244480823",
		"##STAT",
		"cpu  100 0 100 700 100 0 0 0 0 0",
		"cpu0 50 0 50 350 50 0 0 0 0 0",
		"cpu2 50 0 50 350 50 0 0 0 0 0", // cpu1 下线
		"##FREQ", "0 1 2 3|2200000|480000", "7|3350000|400000",
		"##TIS",
		"/sys/devices/system/cpu/cpufreq/policy0/stats/time_in_state:480000 100",
		"/sys/devices/system/cpu/cpufreq/policy7/stats/time_in_state:400000 10",
		"##PROC 14997 com.tencent.mm",
		"14997 (com.tencent.mm) S 2646 2372 1 4 -1 0 0 0 0 0 2646 2372 1 4 20 0 150 0 13925043 1 1",
		"##STATUS 14997", "RssAnon:\t  111608 kB", "VmSwap:\t  147372 kB", "Threads:\t150",
		"##TASK 14997",
		"14997 (com.tencent.mm) S 2646 2372 1 4 -1 0 0 0 0 0 2000 2000 1 4 20 0 150 0 13925043 1 1",
		"15000 (RenderThread) S 2646 2372 1 4 -1 0 0 0 0 0 646 372 1 4 20 0 150 0 13925050 1 1",
	}, "\n")
	raw := parseFastOutput(output)
	if raw.DeviceMs != 1792723934244 {
		t.Fatalf("device ms = %d", raw.DeviceMs)
	}
	if raw.CpuAll.Total != 1000 || raw.CpuAll.Idle != 800 {
		t.Fatalf("cpu all = %+v", raw.CpuAll)
	}
	if _, ok := raw.Cores[1]; ok || len(raw.Cores) != 2 {
		t.Fatalf("cores = %+v", raw.Cores)
	}
	if len(raw.Policies) != 2 || raw.Policies[0].CurFreq != 480000 || raw.Policies[1].TimeInState[400000] != 10 {
		t.Fatalf("policies = %+v", raw.Policies)
	}
	if len(raw.Procs) != 1 {
		t.Fatalf("procs = %+v", raw.Procs)
	}
	proc := raw.Procs[0]
	if proc.Name != "com.tencent.mm" || proc.Stat.Pid != 14997 || proc.Status["RssAnon"] != 111608 || proc.Status["VmSwap"] != 147372 || proc.Status["Threads"] != 150 || len(proc.Tasks) != 2 {
		t.Fatalf("proc = %+v", proc)
	}
}

func TestBuildSample(t *testing.T) {
	prev := &perfFastRaw{
		CpuAll: cpuTimes{Total: 1000, Idle: 800},
		Cores:  map[int]cpuTimes{0: {Total: 500, Idle: 400}, 1: {Total: 500, Idle: 400}},
		Procs: []perfProcRaw{{Name: "a", Stat: procStat{Pid: 1, Utime: 10, Stime: 10, StartTime: 5},
			Tasks: []procStat{{Pid: 1, Comm: "main", Utime: 10, Stime: 10, StartTime: 5}, {Pid: 2, Comm: "worker", StartTime: 6}}}},
	}
	cur := &perfFastRaw{
		// 两个核各过了 100 jiffies，共 200
		CpuAll: cpuTimes{Total: 1200, Idle: 900},
		Cores:  map[int]cpuTimes{0: {Total: 600, Idle: 420}, 1: {Total: 600, Idle: 480}},
		Procs: []perfProcRaw{
			{Name: "a", Stat: procStat{Pid: 1, Utime: 100, Stime: 70, StartTime: 5},
				Tasks: []procStat{{Pid: 1, Comm: "main", Utime: 40, Stime: 30, StartTime: 5}, {Pid: 2, Comm: "worker", Utime: 60, Stime: 40, StartTime: 6}}},
			// 同 pid 但启动时间不同：进程已重启，不应与旧数据相减
			{Name: "b", Stat: procStat{Pid: 3, Utime: 500, StartTime: 9}},
		},
	}
	sample := buildSample(prev, cur, 42)
	if sample.DeviceCpu == nil || math.Abs(*sample.DeviceCpu-50) > 1e-9 {
		t.Fatalf("device cpu = %v", sample.DeviceCpu)
	}
	if *sample.Cores[0].Load != 80 || *sample.Cores[1].Load != 20 {
		t.Fatalf("core loads = %v %v", *sample.Cores[0].Load, *sample.Cores[1].Load)
	}
	// 进程用了 150 jiffies，每个核 100 jiffies：单核口径 150%
	a := sample.Processes[0]
	if a.Cpu == nil || math.Abs(*a.Cpu-150) > 1e-9 {
		t.Fatalf("process cpu = %v", a.Cpu)
	}
	if len(a.TopThreads) != 2 || a.TopThreads[0].Name != "worker" || a.TopThreads[0].Cpu != 100 {
		t.Fatalf("top threads = %+v", a.TopThreads)
	}
	if sample.Processes[1].Cpu != nil {
		t.Fatal("new process should have no cpu baseline")
	}

	// 进程不存在时序列化为 [] 而不是 null
	empty := buildSample(nil, &perfFastRaw{Cores: map[int]cpuTimes{}}, 0)
	if empty.Processes == nil || empty.Cores == nil || empty.Clusters == nil {
		t.Fatalf("empty sample has nil slices: %+v", empty)
	}
}

func TestAverageFreq(t *testing.T) {
	before := map[int]uint64{1000: 100, 2000: 100}
	after := map[int]uint64{1000: 130, 2000: 110}
	if got := averageFreq(before, after); got != 1250 {
		t.Fatalf("avg = %d", got)
	}
	if got := averageFreq(after, after); got != 0 {
		t.Fatalf("no change avg = %d", got)
	}
}

func TestParseThermal(t *testing.T) {
	output := strings.Join([]string{
		"IsStatusOverride: false",
		"Thermal Status: 2",
		"Cached temperatures:",
		"\tTemperature{mValue=87.105, mType=0, mName=CPU, mStatus=0}",
		"HAL Ready: true",
		"Current temperatures from HAL:",
		"\tTemperature{mValue=34.205, mType=0, mName=CPU, mStatus=0}",
		"\tTemperature{mValue=36.5, mType=0, mName=CPU1, mStatus=0}",
		"\tTemperature{mValue=40.0, mType=2, mName=BATTERY, mStatus=0}",
		"Temperature static thresholds from HAL:",
		"\tTemperatureThreshold{mType=0, mName=CPU, mHotThrottlingThresholds=[NaN, NaN, NaN, 95.0, 90.0, 100.0, 117.0], mColdThrottlingThresholds=[NaN]}",
	}, "\n")
	thermal := parseThermal(output)
	// 只取当前值中 CPU 类型的最高温度，忽略缓存的 87°C 和电池温度
	if thermal.CpuTemp != 36.5 || thermal.ThrottleTemp != 95 || thermal.ThermalStatus != 2 {
		t.Fatalf("thermal = %+v", thermal)
	}
}

func TestParseExitInfo(t *testing.T) {
	output := strings.Join([]string{
		"        ApplicationExitInfo #1:",
		"          timestamp=2026-10-23 10:56:41.687 pid=12698 realUid=10124 packageUid=10124 definingUid=10124 user=0",
		"          process=com.ilpanda.inputtype reason=10 (USER REQUESTED) subreason=21 (FORCE STOP) status=0",
		"          importance=400 pss=0.00 rss=102MB description=stop com.ilpanda.inputtype due to from pid 13179 state=empty trace=null",
		"        ApplicationExitInfo #2:",
		"          timestamp=2026-10-21 14:15:29.884 pid=26498 realUid=99021 packageUid=10345 definingUid=10345 user=0",
		"          process=com.example:sandbox reason=3 (LOW_MEMORY) subreason=0 (UNKNOWN) status=0",
		"          importance=400 pss=0.00 rss=0.00 description=null state=empty trace=null",
	}, "\n")
	reason, detail := parseExitInfo(output, 12698)
	if reason != "用户请求（强制停止等）" || detail != "FORCE STOP；stop com.ilpanda.inputtype due to from pid 13179" {
		t.Fatalf("reason=%q detail=%q", reason, detail)
	}
	reason, detail = parseExitInfo(output, 26498)
	if reason != "低内存被杀" || detail != "" {
		t.Fatalf("reason=%q detail=%q", reason, detail)
	}
	if reason, _ := parseExitInfo(output, 1); reason != "" {
		t.Fatalf("unknown pid reason=%q", reason)
	}
}

func TestParsePerfMemInfo(t *testing.T) {
	output := strings.Join([]string{
		"Applications Memory Usage (in Kilobytes):",
		"** MEMINFO in pid 14997 [com.tencent.mm] **",
		" App Summary",
		"            Java Heap:    13884                          23456",
		"          Native Heap:     3432                           4567",
		"           TOTAL PSS:   209903            TOTAL RSS:   185700       TOTAL SWAP PSS:   104042",
		"",
		" Objects",
		"               Views:      689         ViewRootImpl:        3",
		"         AppContexts:       13           Activities:        2",
		"       Local Binders:      121        Proxy Binders:      405",
		"",
		" SQL",
	}, "\n")
	info, ok := parsePerfMemInfo(14997, output)
	if !ok {
		t.Fatal("parse failed")
	}
	if info.Process != "com.tencent.mm" || info.TotalPSS != 209903 || info.TotalRss != 185700 || info.SwapPss != 104042 || info.JavaHeap != 13884 {
		t.Fatalf("info = %+v", info)
	}
	want := map[string]int64{"Views": 689, "ViewRootImpl": 3, "AppContexts": 13, "Activities": 2, "Local Binders": 121, "Proxy Binders": 405}
	for k, v := range want {
		if info.Objects[k] != v {
			t.Fatalf("objects[%s] = %d, want %d (all: %v)", k, info.Objects[k], v, info.Objects)
		}
	}
	if _, ok := parsePerfMemInfo(1, "No process found for: 1"); ok {
		t.Fatal("missing process should not parse")
	}
}

func TestLogcatCursor(t *testing.T) {
	var c logcatCursor
	if c.since() != "1" {
		t.Fatalf("initial since = %s", c.since())
	}
	if !c.accept(1792723548658, "a") || !c.accept(1792723548658, "b") {
		t.Fatal("first lines should be accepted")
	}
	if c.since() != "1792723548.658" {
		t.Fatalf("since = %s", c.since())
	}
	// 重启后 -T 会重复输出同一毫秒的行，以及更早的行
	if c.accept(1792723548658, "a") || c.accept(1792723548000, "c") {
		t.Fatal("replayed lines should be skipped")
	}
	if !c.accept(1792723548659, "a") {
		t.Fatal("newer line should be accepted")
	}
}

func TestParseMdnsServices(t *testing.T) {
	output := strings.Join([]string{
		"List of discovered mdns services",
		"adb-3B6F5PE7KFB5M797-pxQzQ1\t_adb-tls-connect._tcp\t192.168.1.5:41235",
		"studio-AbCd\t_adb-tls-pairing._tcp.\t192.168.1.5:37123",
	}, "\n")
	services := parseMdnsServices(output)
	if len(services) != 2 || services[0].Type != "_adb-tls-connect._tcp" || services[0].Address != "192.168.1.5:41235" ||
		services[1].Name != "studio-AbCd" || services[1].Type != "_adb-tls-pairing._tcp" {
		t.Fatalf("services = %+v", services)
	}
}

func TestAdbdPortCandidates(t *testing.T) {
	info := strings.Join([]string{
		"    inet 172.18.165.138/22 brd 172.18.167.255 scope global wlan0",
		"##PROP",
		"",
		"##NET",
		"  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
		"   0: 0000000000000000FFFF00000100007F:871D 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 10103        0 2202031 1",
		"   4: 00000000000000000000000000000000:9B03 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  2000        0 3430753 1",
		"   5: 00000000000000000000000000000000:27A6 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 10091        0 130843 1",
		"   0: 0100007F:27AC 00000000:0000 0A 00000000:00000000 00:00000000 00000000  2000        0 128507 1",
	}, "\n")
	ports := adbdPortCandidates(info)
	if len(ports) != 1 || ports[0] != "39683" {
		t.Fatalf("ports = %v", ports)
	}
	if got := adbdPortCandidates("##PROP\n41235\n##NET\n"); len(got) != 1 || got[0] != "41235" {
		t.Fatalf("prop ports = %v", got)
	}
}
