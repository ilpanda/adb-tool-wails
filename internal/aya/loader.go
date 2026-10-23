package aya

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ExtractDex 把内嵌的 aya.dex 写到临时目录，返回文件路径
func ExtractDex(data []byte) (string, error) {
	dir := filepath.Join(os.TempDir(), "aya-wails")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "aya.dex")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return "", err
	}
	return path, nil
}

// Progress 应用列表加载进度
type Progress struct {
	Total     int  `json:"total"`
	Current   int  `json:"current"`
	Completed bool `json:"completed"`
}

// 每批向 Aya 请求的应用数
const loadBatchSize = 50

// Loader 加载设备上的应用列表。同一时间只进行一次加载：开始新的加载会先取消上一次并等待其结束
type Loader struct {
	mu     sync.Mutex
	cancel context.CancelFunc
	done   chan struct{}
}

// Load 通过 listPackages 取得包名后，分批从设备端 Aya 服务读取应用信息。
// parent 结束（应用退出）时加载随之取消；onProgress 只在未取消时回调
func (l *Loader) Load(
	parent context.Context,
	param adb.ExecuteParams,
	dexPath string,
	listPackages func(adb.ExecuteParams) ([]string, error),
	onProgress func(Progress),
) ([]PackageInfo, error) {
	l.Cancel()

	ctx, cancel := context.WithCancel(parent)
	done := make(chan struct{})
	l.mu.Lock()
	l.cancel = cancel
	l.done = done
	l.mu.Unlock()
	defer func() {
		cancel()
		l.mu.Lock()
		// 只清理自己这一次的状态，避免覆盖之后开始的加载
		if l.done == done {
			l.cancel = nil
			l.done = nil
		}
		l.mu.Unlock()
		close(done)
	}()

	cancelled := func() bool { return ctx.Err() != nil }
	report := func(p Progress) {
		if !cancelled() && onProgress != nil {
			onProgress(p)
		}
	}

	param.Ctxt = ctx
	client := NewClient(param)
	if err := client.Connect(dexPath); err != nil {
		if cancelled() {
			return nil, context.Canceled
		}
		return nil, fmt.Errorf("failed to connect to Aya: %w", err)
	}
	defer client.Close()
	if cancelled() {
		return nil, context.Canceled
	}

	packageNames, err := listPackages(param)
	if err != nil {
		if cancelled() {
			return nil, context.Canceled
		}
		return nil, fmt.Errorf("failed to get package list: %w", err)
	}
	if len(packageNames) == 0 {
		return []PackageInfo{}, nil
	}

	total := len(packageNames)
	deviceId := param.DeviceId
	applog.Infof(applog.CategoryAction, "app_list_started device=%s total_packages=%d", deviceId, total)
	report(Progress{Total: total})

	apps := make([]PackageInfo, 0, total)
	for start := 0; start < total; start += loadBatchSize {
		if cancelled() {
			applog.Warnf(applog.CategoryAction, "app_list_cancelled device=%s", deviceId)
			return nil, context.Canceled
		}
		end := min(start+loadBatchSize, total)
		applog.Infof(applog.CategoryAction, "app_list_batch_fetch device=%s start=%d end=%d total=%d", deviceId, start+1, end, total)

		batch, err := client.GetPackageInfos(packageNames[start:end])
		if err != nil {
			if cancelled() {
				return nil, context.Canceled
			}
			applog.Warnf(applog.CategoryAction, "app_list_batch_failed device=%s start=%d end=%d err=%q", deviceId, start+1, end, err.Error())
			continue
		}
		apps = append(apps, batch...)
		report(Progress{Total: total, Current: len(apps)})
		applog.Infof(applog.CategoryAction, "app_list_progress device=%s loaded=%d total=%d", deviceId, len(apps), total)
	}

	if cancelled() {
		return nil, context.Canceled
	}
	report(Progress{Total: total, Current: len(apps), Completed: true})
	applog.Infof(applog.CategoryAction, "app_list_completed device=%s loaded=%d total=%d", deviceId, len(apps), total)
	return apps, nil
}

// Cancel 取消正在进行的加载，最多等待 3 秒让它结束
func (l *Loader) Cancel() {
	l.mu.Lock()
	cancel, done := l.cancel, l.done
	l.cancel, l.done = nil, nil
	l.mu.Unlock()
	if cancel == nil {
		return
	}
	applog.Warnf(applog.CategoryAction, "app_list_cancel_previous")
	cancel()
	select {
	case <-done:
		applog.Infof(applog.CategoryAction, "app_list_previous_cancelled")
	case <-time.After(3 * time.Second):
		applog.Warnf(applog.CategoryAction, "app_list_previous_cancel_timeout")
	}
}
