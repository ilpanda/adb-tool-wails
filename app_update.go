package main

import (
	"adb-tool-wails/internal/update"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 版本更新：检查、应用内下载与安装

// CheckUpdate 查询 GitHub Releases 是否有新版本
func (a *App) CheckUpdate() update.Info {
	return a.updater.Check()
}

// DownloadUpdate 在后台下载最近一次检查到的新版本，进度通过 update-status 事件推送
func (a *App) DownloadUpdate() error {
	return a.updater.Download(a.ctx)
}

func (a *App) GetUpdateStatus() update.Status {
	return a.updater.Status()
}

// InstallUpdate 替换为已下载的新版本并退出，新版本会在退出后自动打开
func (a *App) InstallUpdate() error {
	if err := a.updater.Install(); err != nil {
		return err
	}
	// 稍等再退出，让这次调用的结果先返回给前端
	time.AfterFunc(300*time.Millisecond, func() { runtime.Quit(a.ctx) })
	return nil
}
