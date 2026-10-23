package perf

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/util"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"
)

// 推送给前端的事件名
const (
	EventSample = "perf-sample" // 高频：CPU、频率、进程 RSS
	EventMemory = "perf-memory" // 低频：dumpsys meminfo + 温度
	EventProc   = "perf-event"  // 进程启动、死亡、重启、ANR
	EventStatus = "perf-status" // 会话开始 / 结束
)

const (
	perfTopThreads       = 5
	perfMaxFailures      = 5
	perfDefaultInterval  = time.Second
	perfDefaultMemPeriod = 5 * time.Second
)

// Options 前端传入的监控参数
type Options struct {
	DeviceId      string `json:"deviceId"`
	PackageName   string `json:"packageName"`
	IntervalMs    int    `json:"intervalMs"`
	MemIntervalMs int    `json:"memIntervalMs"`
}

// Core 单个核的负载与频率
type Core struct {
	Cpu  int      `json:"cpu"`
	Load *float64 `json:"load"` // 0-100，首次采样没有基线时为空
	Freq int      `json:"freq"` // 当前频率，kHz
}

// Cluster 一个核簇的频率
type Cluster struct {
	Label   string `json:"label"`
	Cpus    []int  `json:"cpus"`
	MaxFreq int    `json:"maxFreq"` // kHz
	CurFreq int    `json:"curFreq"` // 瞬时频率，kHz
	AvgFreq int    `json:"avgFreq"` // 两次采样之间的平均频率（time_in_state 差值），kHz
}

// Thread 线程 CPU 占用
type Thread struct {
	Tid  int     `json:"tid"`
	Name string  `json:"name"`
	Cpu  float64 `json:"cpu"` // 单核口径，%
}

// Process 一个进程的高频采样结果
type Process struct {
	Name       string   `json:"name"`
	Pid        int      `json:"pid"`
	Cpu        *float64 `json:"cpu"` // 单核口径，%；进程新出现时没有基线为空
	RssAnon    int64    `json:"rssAnon"`
	RssFile    int64    `json:"rssFile"`
	RssShmem   int64    `json:"rssShmem"`
	Swap       int64    `json:"swap"`
	Threads    int64    `json:"threads"`
	TopThreads []Thread `json:"topThreads"`
}

// Sample 一次高频采样
type Sample struct {
	Timestamp int64     `json:"timestamp"` // 本机毫秒时间
	CpuCount  int       `json:"cpuCount"`
	DeviceCpu *float64  `json:"deviceCpu"` // 整机口径，0-100
	Cores     []Core    `json:"cores"`
	Clusters  []Cluster `json:"clusters"`
	Processes []Process `json:"processes"`
}

// MemorySample 一次低频采样
type MemorySample struct {
	Timestamp int64            `json:"timestamp"`
	Processes []ProcessMemInfo `json:"processes"`
	Thermal   Thermal          `json:"thermal"`
}

// Status 会话状态
type Status struct {
	Running     bool   `json:"running"`
	PackageName string `json:"packageName"`
	DeviceId    string `json:"deviceId"`
	Error       string `json:"error"`
}

// Emitter 由 App 注入，向前端推送事件
type Emitter func(event string, data any)

// Monitor 同一时间只运行一个监控会话
type Monitor struct {
	emit Emitter

	mu      sync.Mutex
	session *perfSession
}

func NewMonitor(emit Emitter) *Monitor {
	return &Monitor{emit: emit}
}

// Start 停掉已有会话后开始新的监控
func (m *Monitor) Start(parent context.Context, adbPath string, opts Options) error {
	if !adb.ValidPackageName(opts.PackageName) {
		return fmt.Errorf("包名不合法: %s", opts.PackageName)
	}
	if opts.DeviceId == "" {
		return fmt.Errorf("请先连接设备")
	}
	if adbPath == "" {
		adbPath = "adb"
	}
	m.Stop(2 * time.Second)

	ctx, cancel := context.WithCancel(parent)
	s := &perfSession{
		monitor:  m,
		adbPath:  adbPath,
		opts:     opts,
		ctx:      ctx,
		cancel:   cancel,
		done:     make(chan struct{}),
		ready:    make(chan struct{}),
		interval: durationOr(opts.IntervalMs, perfDefaultInterval),
		memEvery: durationOr(opts.MemIntervalMs, perfDefaultMemPeriod),
		logs:     map[int]*perfPidLog{},
		start:    time.Now(),
	}
	m.mu.Lock()
	m.session = s
	m.mu.Unlock()

	applog.Infof(applog.CategoryADB, "perf_monitor_start device=%s package=%s interval_ms=%d mem_interval_ms=%d",
		opts.DeviceId, opts.PackageName, s.interval.Milliseconds(), s.memEvery.Milliseconds())
	m.emit(EventStatus, Status{Running: true, PackageName: opts.PackageName, DeviceId: opts.DeviceId})
	go s.run()
	return nil
}

// Stop 结束当前会话（如有），最多等待 timeout
func (m *Monitor) Stop(timeout time.Duration) {
	m.mu.Lock()
	s := m.session
	m.session = nil
	m.mu.Unlock()
	if s == nil {
		return
	}
	s.cancel()
	select {
	case <-s.done:
	case <-time.After(timeout):
		applog.Warnf(applog.CategoryADB, "perf_monitor_stop_timeout timeout_ms=%d", timeout.Milliseconds())
	}
}

func durationOr(ms int, fallback time.Duration) time.Duration {
	if ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}

type procIdentity struct {
	Pid       int
	StartTime uint64
}

type perfSession struct {
	monitor  *Monitor
	adbPath  string
	opts     Options
	ctx      context.Context
	cancel   context.CancelFunc
	done     chan struct{}
	ready    chan struct{} // 首次采样完成（设备时钟偏移已知）后关闭
	interval time.Duration
	memEvery time.Duration
	start    time.Time

	mu          sync.Mutex
	prev        *perfFastRaw
	identities  map[string]procIdentity // 进程名 -> 身份；nil 表示还没有采样过
	pids        []int                   // 当前所有进程，供低频采样使用
	clockOffset int64                   // 设备毫秒时间 - 本机毫秒时间
	logs        map[int]*perfPidLog     // pid -> logcat 中与该 pid 相关的记录
	eventSeq    int64
	failure     string
}

func (s *perfSession) run() {
	defer close(s.done)
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); s.fastLoop() }()
	go func() { defer wg.Done(); s.slowLoop() }()
	go func() { defer wg.Done(); s.logcatLoop() }()
	wg.Wait()

	s.mu.Lock()
	failure := s.failure
	s.mu.Unlock()
	applog.Infof(applog.CategoryADB, "perf_monitor_stopped package=%s err=%q", s.opts.PackageName, failure)
	s.monitor.emit(EventStatus, Status{PackageName: s.opts.PackageName, DeviceId: s.opts.DeviceId, Error: failure})
}

// fail 连续失败过多时结束整个会话
func (s *perfSession) fail(msg string) {
	s.mu.Lock()
	if s.failure == "" {
		s.failure = msg
	}
	s.mu.Unlock()
	s.cancel()
}

// shell 在设备上执行脚本，会话结束时随 context 一起终止
func (s *perfSession) shell(script string) (string, error) {
	cmd := exec.CommandContext(s.ctx, s.adbPath, "-s", s.opts.DeviceId, "shell", script)
	util.ConfigureCommand(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return stdout.String(), nil
}

// fastLoop time.Ticker 在接收方来不及处理时会丢弃 tick，上一次采样未完成不会叠加请求
func (s *perfSession) fastLoop() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	script := buildFastScript(s.opts.PackageName)
	failures := 0
	readyClosed := false

	for {
		begin := time.Now()
		output, err := s.shell(script)
		if s.ctx.Err() != nil {
			return
		}
		if err != nil {
			failures++
			applog.Warnf(applog.CategoryADB, "perf_fast_sample_failed count=%d err=%q", failures, err.Error())
			if failures >= perfMaxFailures {
				s.fail("采样连续失败：" + err.Error())
				return
			}
		} else {
			failures = 0
			// 以命令执行的中点作为采样时刻
			hostMs := begin.Add(time.Since(begin) / 2).UnixMilli()
			raw := parseFastOutput(output)
			s.handleFast(raw, hostMs)
			if !readyClosed {
				close(s.ready)
				readyClosed = true
			}
		}

		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *perfSession) handleFast(raw perfFastRaw, hostMs int64) {
	s.mu.Lock()
	prev := s.prev
	s.prev = &raw
	if raw.DeviceMs > 0 {
		s.clockOffset = raw.DeviceMs - hostMs
	}
	s.mu.Unlock()

	sample := buildSample(prev, &raw, hostMs)
	s.monitor.emit(EventSample, sample)
	s.detectProcessChanges(raw, hostMs)
}

// buildSample 用相邻两次采样的 jiffies 差值计算 CPU 占用；没有上一次采样时只输出瞬时数据
func buildSample(prev, cur *perfFastRaw, hostMs int64) Sample {
	// 切片初始化为空，避免进程不存在时序列化成 null
	sample := Sample{
		Timestamp: hostMs,
		CpuCount:  len(cur.Cores),
		Cores:     []Core{},
		Clusters:  []Cluster{},
		Processes: []Process{},
	}
	var elapsed uint64 // 所有核总 jiffies 的差值
	if prev != nil && cur.CpuAll.Total > prev.CpuAll.Total {
		elapsed = cur.CpuAll.Total - prev.CpuAll.Total
		sample.DeviceCpu = loadPercent(prev.CpuAll, cur.CpuAll)
	}

	freqByCpu := map[int]int{}
	for _, p := range cur.Policies {
		for _, cpu := range p.Cpus {
			freqByCpu[cpu] = p.CurFreq
		}
	}
	cpus := make([]int, 0, len(cur.Cores))
	for cpu := range cur.Cores {
		cpus = append(cpus, cpu)
	}
	sort.Ints(cpus)
	for _, cpu := range cpus {
		core := Core{Cpu: cpu, Freq: freqByCpu[cpu]}
		// 按核编号对应，核下线后 /proc/stat 少一行也不会错位
		if prev != nil {
			if before, ok := prev.Cores[cpu]; ok {
				core.Load = loadPercent(before, cur.Cores[cpu])
			}
		}
		sample.Cores = append(sample.Cores, core)
	}

	sample.Clusters = buildClusters(prev, cur)

	prevProcs := map[int]perfProcRaw{}
	if prev != nil {
		for _, p := range prev.Procs {
			prevProcs[p.Stat.Pid] = p
		}
	}
	// 单核口径：Δ进程 jiffies / (Δ总 jiffies / 核数)
	perCore := 0.0
	if elapsed > 0 && len(cur.Cores) > 0 {
		perCore = float64(elapsed) / float64(len(cur.Cores))
	}
	for _, p := range cur.Procs {
		if p.Stat.Pid == 0 {
			continue
		}
		proc := Process{
			Name:     p.Name,
			Pid:      p.Stat.Pid,
			RssAnon:  p.Status["RssAnon"],
			RssFile:  p.Status["RssFile"],
			RssShmem: p.Status["RssShmem"],
			Swap:     p.Status["VmSwap"],
			Threads:  p.Status["Threads"],
		}
		before, ok := prevProcs[p.Stat.Pid]
		if ok && perCore > 0 && before.Stat.StartTime == p.Stat.StartTime {
			proc.Cpu = cpuPercent(before.Stat, p.Stat, perCore)
			proc.TopThreads = topThreads(before.Tasks, p.Tasks, perCore)
		}
		sample.Processes = append(sample.Processes, proc)
	}
	return sample
}

func loadPercent(before, after cpuTimes) *float64 {
	if after.Total <= before.Total {
		return nil
	}
	total := float64(after.Total - before.Total)
	idle := float64(0)
	if after.Idle > before.Idle {
		idle = float64(after.Idle - before.Idle)
	}
	value := clampPercent((total-idle)/total*100, 100)
	return &value
}

func cpuPercent(before, after procStat, perCore float64) *float64 {
	used := after.Utime + after.Stime
	usedBefore := before.Utime + before.Stime
	if used < usedBefore {
		return nil
	}
	value := float64(used-usedBefore) / perCore * 100
	return &value
}

func topThreads(before, after []procStat, perCore float64) []Thread {
	prev := make(map[int]procStat, len(before))
	for _, t := range before {
		prev[t.Pid] = t
	}
	var threads []Thread
	for _, t := range after {
		old, ok := prev[t.Pid]
		if !ok || old.StartTime != t.StartTime {
			continue
		}
		cpu := cpuPercent(old, t, perCore)
		if cpu == nil || *cpu <= 0 {
			continue
		}
		threads = append(threads, Thread{Tid: t.Pid, Name: t.Comm, Cpu: *cpu})
	}
	sort.Slice(threads, func(i, j int) bool { return threads[i].Cpu > threads[j].Cpu })
	if len(threads) > perfTopThreads {
		threads = threads[:perfTopThreads]
	}
	return threads
}

func clampPercent(value, max float64) float64 {
	if value < 0 {
		return 0
	}
	if value > max {
		return max
	}
	return value
}

// buildClusters 复用 parseClusters 的分簇与命名，再补上当前频率与区间平均频率
func buildClusters(prev, cur *perfFastRaw) []Cluster {
	policyLines := make([]string, 0, len(cur.Policies))
	byFirstCpu := map[int]perfPolicy{}
	for _, p := range cur.Policies {
		cpus := make([]string, len(p.Cpus))
		for i, cpu := range p.Cpus {
			cpus[i] = fmt.Sprint(cpu)
		}
		policyLines = append(policyLines, fmt.Sprintf("%s | %d", strings.Join(cpus, " "), p.MaxFreq))
		byFirstCpu[p.Cpus[0]] = p
	}
	prevByFirstCpu := map[int]perfPolicy{}
	if prev != nil {
		for _, p := range prev.Policies {
			prevByFirstCpu[p.Cpus[0]] = p
		}
	}

	clusters := []Cluster{}
	for _, c := range parseClusters(policyLines, nil) {
		p := byFirstCpu[c.Cpus[0]]
		cluster := Cluster{Label: c.Label, Cpus: c.Cpus, MaxFreq: c.MaxFreq, CurFreq: p.CurFreq, AvgFreq: p.CurFreq}
		if before, ok := prevByFirstCpu[c.Cpus[0]]; ok {
			if avg := averageFreq(before.TimeInState, p.TimeInState); avg > 0 {
				cluster.AvgFreq = avg
			}
		}
		clusters = append(clusters, cluster)
	}
	return clusters
}

// averageFreq 按各频点停留时间加权
func averageFreq(before, after map[int]uint64) int {
	var weighted, total float64
	for freq, t := range after {
		if t <= before[freq] {
			continue
		}
		delta := float64(t - before[freq])
		weighted += float64(freq) * delta
		total += delta
	}
	if total == 0 {
		return 0
	}
	return int(weighted / total)
}

// slowLoop dumpsys meminfo 单次约 0.7~1 秒，放在独立的循环里，不阻塞高频采样
func (s *perfSession) slowLoop() {
	select {
	case <-s.ctx.Done():
		return
	case <-s.ready:
	}
	ticker := time.NewTicker(s.memEvery)
	defer ticker.Stop()

	for {
		s.mu.Lock()
		pids := append([]int(nil), s.pids...)
		s.mu.Unlock()

		begin := time.Now()
		output, err := s.shell(buildSlowScript(pids))
		if s.ctx.Err() != nil {
			return
		}
		if err != nil {
			applog.Warnf(applog.CategoryADB, "perf_memory_sample_failed err=%q", err.Error())
		} else {
			memOutputs, thermalOutput := splitSlowOutput(output)
			sample := MemorySample{
				Timestamp: begin.Add(time.Since(begin) / 2).UnixMilli(),
				Thermal:   parseThermal(thermalOutput),
				Processes: []ProcessMemInfo{},
			}
			for _, pid := range pids {
				if info, ok := parsePerfMemInfo(pid, memOutputs[pid]); ok {
					info.Timestamp = sample.Timestamp
					sample.Processes = append(sample.Processes, info)
				}
			}
			s.monitor.emit(EventMemory, sample)
		}

		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
