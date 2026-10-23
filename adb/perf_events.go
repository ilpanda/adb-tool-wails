package adb

import (
	"adb-tool-wails/applog"
	"adb-tool-wails/util"
	"bufio"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 进程事件类型
const (
	PerfProcStarted   = "started"   // 新进程出现
	PerfProcDied      = "died"      // 进程消失且未重启
	PerfProcRestarted = "restarted" // 同名进程身份变化（pid 或启动时间不同）
	PerfProcAnr       = "anr"
)

// PerfProcEvent 进程事件
type PerfProcEvent struct {
	Id        int64  `json:"id"`
	Timestamp int64  `json:"timestamp"` // 本机毫秒时间
	Kind      string `json:"kind"`
	Process   string `json:"process"`
	Pid       int    `json:"pid"`    // 新进程 pid；died 时为死亡进程 pid
	OldPid    int    `json:"oldPid"` // restarted 时为旧进程 pid
	Reason    string `json:"reason"` // 归类后的原因
	Detail    string `json:"detail"` // 原始细节，如 am_kill 的原因、崩溃异常
	Source    string `json:"source"` // 原因来源：exit-info / logcat
}

// perfPidLog logcat 中与某个 pid 相关的记录，时间均为本机毫秒时间
type perfPidLog struct {
	KillReason  string
	KillAt      int64
	Crash       string
	CrashAt     int64
	DiedAt      int64
	StartReason string
	StartAt     int64
	seenAt      time.Time
}

// 等 logcat 和 exit-info 记录落地后再补充原因
const perfEventEnrichDelay = 2 * time.Second

func (s *perfSession) belongs(process string) bool {
	return process == s.opts.PackageName || strings.HasPrefix(process, s.opts.PackageName+":")
}

func (s *perfSession) nextEventId() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.eventSeq++
	return s.eventSeq
}

// detectProcessChanges 以 (pid, 启动时间) 作为进程身份，与上次采样对比
func (s *perfSession) detectProcessChanges(raw perfFastRaw, hostMs int64) {
	current := map[string]procIdentity{}
	var pids []int
	for _, p := range raw.Procs {
		if p.Stat.Pid == 0 {
			continue
		}
		if _, exists := current[p.Name]; !exists {
			current[p.Name] = procIdentity{Pid: p.Stat.Pid, StartTime: p.Stat.StartTime}
		}
		pids = append(pids, p.Stat.Pid)
	}
	sort.Ints(pids)

	s.mu.Lock()
	previous := s.identities
	s.identities = current
	s.pids = pids
	s.mu.Unlock()
	if previous == nil {
		return
	}

	var events []PerfProcEvent
	for name, old := range previous {
		now, ok := current[name]
		switch {
		case !ok:
			events = append(events, PerfProcEvent{Kind: PerfProcDied, Process: name, Pid: old.Pid})
		case now != old:
			events = append(events, PerfProcEvent{Kind: PerfProcRestarted, Process: name, Pid: now.Pid, OldPid: old.Pid})
		}
	}
	for name, now := range current {
		if _, ok := previous[name]; !ok {
			events = append(events, PerfProcEvent{Kind: PerfProcStarted, Process: name, Pid: now.Pid})
		}
	}
	for _, ev := range events {
		ev.Id = s.nextEventId()
		ev.Timestamp = hostMs
		go s.enrichAndEmit(ev)
	}
}

func (s *perfSession) enrichAndEmit(ev PerfProcEvent) {
	select {
	case <-s.ctx.Done():
		return
	case <-time.After(perfEventEnrichDelay):
	}

	deadPid := 0
	switch ev.Kind {
	case PerfProcDied:
		deadPid = ev.Pid
	case PerfProcRestarted:
		deadPid = ev.OldPid
	}

	s.mu.Lock()
	var dead, started perfPidLog
	if log := s.logs[deadPid]; deadPid > 0 && log != nil {
		dead = *log
	}
	if log := s.logs[ev.Pid]; ev.Kind != PerfProcDied && log != nil {
		started = *log
	}
	s.mu.Unlock()

	if deadPid > 0 {
		// 有 logcat 记录时用更精确的死亡时间
		for _, at := range []int64{dead.KillAt, dead.CrashAt, dead.DiedAt} {
			if at > 0 && (ev.Timestamp == 0 || at < ev.Timestamp) {
				ev.Timestamp = at
			}
		}
		switch {
		case dead.Crash != "":
			ev.Reason, ev.Detail, ev.Source = "崩溃", dead.Crash, "logcat"
		case dead.KillReason != "":
			ev.Reason, ev.Detail, ev.Source = "被系统终止", dead.KillReason, "logcat"
		}
		// exit-info 是系统官方记录的退出原因（Android 11+），有则优先作为归类
		if reason, detail := s.queryExitInfo(deadPid); reason != "" {
			ev.Reason, ev.Source = reason, "exit-info"
			if ev.Detail == "" {
				ev.Detail = detail
			}
		}
	} else if started.StartAt > 0 {
		ev.Timestamp = started.StartAt
	}

	if started.StartReason != "" {
		startDetail := "启动方式：" + started.StartReason
		if ev.Detail == "" {
			ev.Detail = startDetail
		} else {
			ev.Detail += "；" + startDetail
		}
	}
	if ev.Reason == "" {
		switch ev.Kind {
		case PerfProcStarted:
			ev.Reason = "进程启动"
		case PerfProcDied:
			ev.Reason = "进程退出"
		case PerfProcRestarted:
			ev.Reason = "进程重启"
		}
	}
	s.monitor.emit(PerfEventProc, ev)
}

var (
	reExitPid    = regexp.MustCompile(`\bpid=(\d+)\b`)
	reExitReason = regexp.MustCompile(`\breason=\d+ \(([A-Z_ ]+)\)`)
	reExitSub    = regexp.MustCompile(`\bsubreason=\d+ \(([A-Z_ ]+)\)`)
	reExitDesc   = regexp.MustCompile(`\bdescription=(.*?)(?: state=| trace=|$)`)
)

// ApplicationExitInfo.REASON_* 的中文说明
var exitReasonNames = map[string]string{
	"EXIT_SELF":                "主动退出",
	"SIGNALED":                 "被信号终止",
	"LOW_MEMORY":               "低内存被杀",
	"CRASH":                    "Java 崩溃",
	"CRASH_NATIVE":             "Native 崩溃",
	"ANR":                      "ANR",
	"INITIALIZATION_FAILURE":   "初始化失败",
	"PERMISSION_CHANGE":        "权限变更",
	"EXCESSIVE_RESOURCE_USAGE": "资源占用过高",
	"USER_REQUESTED":           "用户请求（强制停止等）",
	"USER_STOPPED":             "用户已停止",
	"DEPENDENCY_DIED":          "依赖进程死亡",
	"OTHER":                    "系统终止（其他）",
	"FREEZER":                  "冻结状态下被杀",
	"PACKAGE_STATE_CHANGE":     "包状态变化",
	"PACKAGE_UPDATED":          "应用更新",
}

// queryExitInfo 从 dumpsys activity exit-info 中找到指定 pid 的退出记录
func (s *perfSession) queryExitInfo(pid int) (string, string) {
	output, err := s.shell("dumpsys activity exit-info " + s.opts.PackageName)
	if err != nil {
		return "", ""
	}
	return parseExitInfo(output, pid)
}

func parseExitInfo(output string, pid int) (string, string) {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	for i, line := range lines {
		m := reExitPid.FindStringSubmatch(line)
		if m == nil || m[1] != strconv.Itoa(pid) || !strings.Contains(line, "timestamp=") {
			continue
		}
		// 一条记录跨 3 行：timestamp/pid、process/reason、importance/description
		block := strings.Join(lines[i:min(i+3, len(lines))], " ")
		reasonMatch := reExitReason.FindStringSubmatch(block)
		if reasonMatch == nil {
			return "", ""
		}
		// 不同版本分别用空格或下划线分隔，如 USER REQUESTED / USER_REQUESTED
		reasonKey := strings.ReplaceAll(reasonMatch[1], " ", "_")
		reason := exitReasonNames[reasonKey]
		if reason == "" {
			reason = reasonKey
		}
		var details []string
		if sub := reExitSub.FindStringSubmatch(block); sub != nil && sub[1] != "UNKNOWN" {
			details = append(details, sub[1])
		}
		if desc := reExitDesc.FindStringSubmatch(block); desc != nil {
			if d := strings.TrimSpace(desc[1]); d != "" && d != "null" {
				details = append(details, d)
			}
		}
		return reason, strings.Join(details, "；")
	}
	return "", ""
}

var reLogcatEvent = regexp.MustCompile(`^\s*(\d+)\.(\d{3})\s+\d+\s+\d+\s+\w\s+(\w+)\s*:\s*\[(.*)\]\s*$`)

// perfLogcatLifetime logcat 在设备上用 timeout 限定运行时长，到期后接着上次的时间重新拉起。
// 应用被强杀（崩溃、wails dev 重新编译）时 shutdown 不会执行，常驻的 logcat 会变成孤儿进程一直运行；
// 有了时限，孤儿进程最多存活这么久
const perfLogcatLifetime = 30

// logcatLoop 实时读取 events 缓冲区中与进程生命周期相关的记录；正常到期立即重启，出错时 3 秒后重连
func (s *perfSession) logcatLoop() {
	select {
	case <-s.ctx.Done():
		return
	case <-s.ready:
	}
	var cursor logcatCursor
	for {
		begin := time.Now()
		s.runLogcat(&cursor)
		retry := time.Duration(0)
		if time.Since(begin) < perfLogcatLifetime*time.Second/2 {
			retry = 3 * time.Second
		}
		select {
		case <-s.ctx.Done():
			return
		case <-time.After(retry):
		}
	}
}

// logcatCursor 记录已处理到的设备时间，重启 logcat 时用 -T 接上，并跳过同一毫秒内已处理过的行
type logcatCursor struct {
	deviceMs int64
	seen     map[string]bool
}

func (c *logcatCursor) since() string {
	if c.deviceMs == 0 {
		return "1"
	}
	return fmt.Sprintf("%d.%03d", c.deviceMs/1000, c.deviceMs%1000)
}

// accept 返回该行是否第一次出现
func (c *logcatCursor) accept(deviceMs int64, line string) bool {
	switch {
	case deviceMs < c.deviceMs:
		return false
	case deviceMs > c.deviceMs:
		c.deviceMs = deviceMs
		c.seen = map[string]bool{}
	}
	if c.seen[line] {
		return false
	}
	c.seen[line] = true
	return true
}

func (s *perfSession) runLogcat(cursor *logcatCursor) {
	script := fmt.Sprintf("timeout %d logcat -b events -v epoch -T %s -s am_kill:I am_crash:I am_anr:I am_proc_died:I am_proc_start:I",
		perfLogcatLifetime, cursor.since())
	cmd := exec.CommandContext(s.ctx, s.adbPath, "-s", s.opts.DeviceId, "shell", script)
	util.ConfigureCommand(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		applog.Warnf(applog.CategoryADB, "perf_logcat_start_failed err=%q", err.Error())
		return
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		s.handleLogcatLine(cursor, scanner.Text())
	}
	_ = cmd.Wait()
}

func (s *perfSession) handleLogcatLine(cursor *logcatCursor, line string) {
	m := reLogcatEvent.FindStringSubmatch(line)
	if m == nil {
		return
	}
	sec, _ := strconv.ParseInt(m[1], 10, 64)
	ms, _ := strconv.ParseInt(m[2], 10, 64)
	if !cursor.accept(sec*1000+ms, line) {
		return
	}
	tag, fields := m[3], strings.Split(m[4], ",")
	if len(fields) < 3 {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(fields[1]))
	if err != nil {
		return
	}

	s.mu.Lock()
	at := sec*1000 + ms - s.clockOffset
	s.mu.Unlock()
	// -T 1 会先输出一条历史记录，只处理本次会话开始之后的
	if at < s.start.UnixMilli()-1000 {
		return
	}

	switch tag {
	case "am_kill":
		// [user, pid, process, adj, reason(, pss)]
		if len(fields) < 5 || !s.belongs(strings.TrimSpace(fields[2])) {
			return
		}
		end := len(fields)
		if end >= 6 {
			if _, err := strconv.Atoi(strings.TrimSpace(fields[end-1])); err == nil {
				end--
			}
		}
		reason := strings.TrimSpace(strings.Join(fields[4:end], ","))
		s.updateLog(pid, func(l *perfPidLog) { l.KillReason, l.KillAt = reason, at })
	case "am_crash":
		// [user, pid, process, flags, exception, message, file, line(, recoverable)]
		if len(fields) < 6 || !s.belongs(strings.TrimSpace(fields[2])) {
			return
		}
		crash := strings.TrimSpace(fields[4])
		if msg := strings.TrimSpace(fields[5]); msg != "" {
			crash += ": " + msg
		}
		s.updateLog(pid, func(l *perfPidLog) { l.Crash, l.CrashAt = crash, at })
	case "am_proc_died":
		if !s.belongs(strings.TrimSpace(fields[2])) {
			return
		}
		s.updateLog(pid, func(l *perfPidLog) { l.DiedAt = at })
	case "am_proc_start":
		// [user, pid, uid, process, hostingType, hostingName...]
		if len(fields) < 5 || !s.belongs(strings.TrimSpace(fields[3])) {
			return
		}
		reason := strings.TrimSpace(fields[4])
		if len(fields) >= 6 {
			if name := strings.Trim(strings.TrimSpace(fields[5]), "{}"); name != "" {
				reason += " " + name
			}
		}
		s.updateLog(pid, func(l *perfPidLog) { l.StartReason, l.StartAt = reason, at })
	case "am_anr":
		// [user, pid, package, flags, reason]；ANR 不一定导致进程死亡，单独作为事件
		if len(fields) < 4 || !s.belongs(strings.TrimSpace(fields[2])) {
			return
		}
		detail := ""
		if len(fields) >= 5 {
			detail = strings.TrimSpace(strings.Join(fields[4:], ","))
		}
		s.monitor.emit(PerfEventProc, PerfProcEvent{
			Id: s.nextEventId(), Timestamp: at, Kind: PerfProcAnr, Process: strings.TrimSpace(fields[2]),
			Pid: pid, Reason: "ANR", Detail: detail, Source: "logcat",
		})
	}
}

func (s *perfSession) updateLog(pid int, update func(*perfPidLog)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	log := s.logs[pid]
	if log == nil {
		log = &perfPidLog{}
		s.logs[pid] = log
	}
	update(log)
	log.seenAt = time.Now()
	// 清理 10 分钟前的记录
	for p, l := range s.logs {
		if time.Since(l.seenAt) > 10*time.Minute {
			delete(s.logs, p)
		}
	}
}
