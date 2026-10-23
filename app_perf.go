package main

import (
	"adb-tool-wails/internal/perf"
	"time"
)

// 性能监控与线程调度，实现在 internal/perf

// GetThreadSchedInfo 获取进程内所有线程的优先级与可运行核，pid <= 0 时取包名主进程
func (a *App) GetThreadSchedInfo(deviceId string, packageName string, pid int) (perf.ThreadSchedResult, error) {
	return perf.GetThreadSchedInfo(a.adbBinary(), deviceId, packageName, pid)
}

// StartPerfMonitor 开始监控包名下所有进程的 CPU、内存与进程事件，数据通过 perf-* 事件推送
func (a *App) StartPerfMonitor(opts perf.Options) error {
	return a.perfMonitor.Start(a.ctx, a.adbPath, opts)
}

// StopPerfMonitor 停止性能监控
func (a *App) StopPerfMonitor() {
	a.perfMonitor.Stop(2 * time.Second)
}
