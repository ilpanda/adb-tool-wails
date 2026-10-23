package main

import (
	"adb-tool-wails/internal/actions"
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/aya"
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 应用列表：通过设备端 Aya 服务批量读取应用信息，实现在 internal/aya

// GetApplicationListWithProgress 获取应用列表，进度通过 app-list-progress 事件推送；开始新的加载会取消上一次
func (a *App) GetApplicationListWithProgress(deviceId string) ([]aya.PackageInfo, error) {
	if a.adbPath == "" {
		return nil, fmt.Errorf("ADB path not configured")
	}
	param := adb.ExecuteParams{AdbPath: a.adbPath, DeviceId: deviceId}
	listPackages := func(p adb.ExecuteParams) ([]string, error) {
		result := actions.GetAllPackages(p)
		if result.Error != "" {
			return nil, fmt.Errorf("%s", result.Error)
		}
		var names []string
		for _, name := range strings.Split(result.Res, "\n") {
			if name = strings.TrimSpace(name); name != "" {
				names = append(names, name)
			}
		}
		return names, nil
	}
	return a.appLoader.Load(a.ctx, param, a.ayaDexPath, listPackages, func(p aya.Progress) {
		runtime.EventsEmit(a.ctx, "app-list-progress", p)
	})
}

// CancelApplicationListLoading 取消正在进行的应用列表加载
func (a *App) CancelApplicationListLoading() {
	a.appLoader.Cancel()
}
