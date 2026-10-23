package main

import (
	"adb-tool-wails/internal/actions"
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/aya"
	"adb-tool-wails/internal/types"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 应用列表：通过设备端 Aya 服务批量读取应用信息

// GetPackageInfoFromAya 使用 Aya 服务获取应用详细信息
func (a *App) GetPackageInfoFromAya(param adb.ExecuteParams, packageNames []string) types.ExecResult {

	client := aya.NewClient(param)

	if err := client.Connect(a.ayaDexPath); err != nil {
		return types.NewExecResultErrorString("aya_connect", fmt.Sprintf("连接 Aya 服务失败: %v", err))
	}
	defer client.Close()

	result, err := client.SendMessage("getPackageInfos", map[string]interface{}{
		"packageNames": packageNames,
	})
	if err != nil {
		return types.NewExecResultErrorString("aya_send_message", fmt.Sprintf("发送消息失败: %v", err))
	}

	// 从 result 中提取 packageInfos
	packageInfosRaw, ok := result["packageInfos"]
	if !ok {
		return types.NewExecResultErrorString("aya_parse_response", "响应中缺少 packageInfos 字段")
	}

	// 通过 JSON 序列化和反序列化来转换类型
	jsonBytes, err := json.Marshal(packageInfosRaw)
	if err != nil {
		return types.NewExecResultErrorString("aya_marshal", fmt.Sprintf("序列化失败: %v", err))
	}

	var packageInfos []aya.PackageInfo
	if err := json.Unmarshal(jsonBytes, &packageInfos); err != nil {
		return types.NewExecResultErrorString("aya_unmarshal", fmt.Sprintf("反序列化失败: %v", err))
	}

	// 格式化为 JSON 输出
	jsonData, err := json.MarshalIndent(packageInfos, "", "  ")
	if err != nil {
		return types.NewExecResultErrorString("json_marshal", fmt.Sprintf("JSON序列化失败: %v", err))
	}

	return types.NewExecResultSuccess(
		fmt.Sprintf("getPackageInfos(%v)", packageNames),
		string(jsonData),
	)
}

func (a *App) extractAyaDex() error {
	// 1. 获取临时目录
	tmpDir := os.TempDir()
	ayaDir := filepath.Join(tmpDir, "aya-wails")

	// 2. 创建目录
	if err := os.MkdirAll(ayaDir, 0755); err != nil {
		return err
	}

	// 3. 保存 aya.dex 文件
	ayaDexPath := filepath.Join(ayaDir, "aya.dex")
	if err := os.WriteFile(ayaDexPath, ayaDexData, 0644); err != nil {
		return err
	}

	// 4. 保存路径供后续使用
	a.ayaDexPath = ayaDexPath

	return nil
}

// GetApplicationListWithProgress 获取应用列表（带进度回调和取消支持）
func (a *App) GetApplicationListWithProgress(deviceId string) ([]aya.PackageInfo, error) {
	// 先取消之前的任务并等待其完成
	a.CancelApplicationListLoading()

	// 创建完全独立的 context，不受之前取消的影响
	a.appListMutex.Lock()
	ctx, cancel := context.WithCancel(context.Background()) // ← 改用 Background
	a.appListCancel = cancel
	done := make(chan struct{})
	a.appListDone = done
	a.appListMutex.Unlock()

	// 同时监听应用级别的 context（用于应用退出时清理）
	go func() {
		select {
		case <-a.ctx.Done():
			cancel() // 应用退出时取消任务
		case <-done:
			// 任务正常完成
		}
	}()

	// 确保任务结束时正确清理
	defer func() {
		a.appListMutex.Lock()
		// 只有当前任务的 done 才关闭
		if a.appListDone == done {
			close(done)
			a.appListDone = nil
			a.appListCancel = nil
		}
		a.appListMutex.Unlock()
	}()

	// 辅助函数：检查任务是否被取消
	isCancelled := func() bool {
		select {
		case <-ctx.Done():
			return true
		default:
			return false
		}
	}

	// 辅助函数：安全发送事件（只有未取消时才发送）
	emitProgress := func(total, current int, completed bool) {
		if !isCancelled() {
			runtime.EventsEmit(a.ctx, "app-list-progress", map[string]interface{}{
				"total":     total,
				"current":   current,
				"completed": completed,
			})
		}
	}

	if a.adbPath == "" {
		return nil, fmt.Errorf("ADB path not configured")
	}

	param := adb.ExecuteParams{
		Ctxt:     ctx,
		AdbPath:  a.adbPath,
		DeviceId: deviceId,
	}

	// 检查是否已取消
	if isCancelled() {
		return nil, context.Canceled
	}

	client := aya.NewClient(param)
	if err := client.Connect(a.ayaDexPath); err != nil {
		if isCancelled() {
			return nil, context.Canceled
		}
		return nil, fmt.Errorf("failed to connect to Aya: %w", err)
	}
	defer client.Close()

	// 检查是否已取消
	if isCancelled() {
		return nil, context.Canceled
	}

	allPackagesRes := actions.GetAllPackages(param)
	if allPackagesRes.Error != "" {
		if isCancelled() {
			return nil, context.Canceled
		}
		return nil, fmt.Errorf("failed to get package list: %s", allPackagesRes.Error)
	}

	// 清理包名列表
	packageNames := []string{}
	for _, pkg := range strings.Split(allPackagesRes.Res, "\n") {
		pkg = strings.TrimSpace(pkg)
		if pkg != "" {
			packageNames = append(packageNames, pkg)
		}
	}

	if len(packageNames) == 0 {
		return []aya.PackageInfo{}, nil
	}

	totalPackages := len(packageNames)
	applog.Infof(applog.CategoryAction, "app_list_started device=%s total_packages=%d", deviceId, totalPackages)

	// 发送开始事件
	emitProgress(totalPackages, 0, false)

	// 分批获取应用信息，每批50个
	batchSize := 50
	allApps := make([]aya.PackageInfo, 0, totalPackages)

	for i := 0; i < totalPackages; i += batchSize {
		// 检查是否已取消
		if isCancelled() {
			applog.Warnf(applog.CategoryAction, "app_list_cancelled device=%s", deviceId)
			return nil, context.Canceled
		}

		end := i + batchSize
		if end > totalPackages {
			end = totalPackages
		}

		batch := packageNames[i:end]
		applog.Infof(applog.CategoryAction, "app_list_batch_fetch device=%s start=%d end=%d total=%d", deviceId, i+1, end, totalPackages)

		// 批量获取当前批次的应用信息
		batchApps, err := client.GetPackageInfos(batch)
		if err != nil {
			if isCancelled() {
				return nil, context.Canceled
			}
			applog.Warnf(applog.CategoryAction, "app_list_batch_failed device=%s start=%d end=%d err=%q", deviceId, i+1, end, err.Error())
			continue
		}

		allApps = append(allApps, batchApps...)

		// 发送进度更新
		emitProgress(totalPackages, len(allApps), false)

		applog.Infof(applog.CategoryAction, "app_list_progress device=%s loaded=%d total=%d", deviceId, len(allApps), totalPackages)
	}

	// 检查是否已取消，取消则不发送完成事件
	if isCancelled() {
		return nil, context.Canceled
	}

	// 发送完成事件
	emitProgress(totalPackages, len(allApps), true)

	applog.Infof(applog.CategoryAction, "app_list_completed device=%s loaded=%d total=%d", deviceId, len(allApps), totalPackages)

	return allApps, nil
}

// CancelApplicationListLoading 取消当前正在进行的应用列表加载任务
func (a *App) CancelApplicationListLoading() {
	a.appListMutex.Lock()
	cancel := a.appListCancel
	done := a.appListDone
	// 立即清空，防止重复取消
	a.appListCancel = nil
	a.appListDone = nil // ← 添加这行
	a.appListMutex.Unlock()

	if cancel != nil {
		applog.Warnf(applog.CategoryAction, "app_list_cancel_previous")
		cancel()

		// 等待前一个任务完成
		if done != nil {
			select {
			case <-done:
				applog.Infof(applog.CategoryAction, "app_list_previous_cancelled")
			case <-time.After(3 * time.Second):
				applog.Warnf(applog.CategoryAction, "app_list_previous_cancel_timeout")
			}
		}
	}
}
