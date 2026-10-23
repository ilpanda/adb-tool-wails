package main

import (
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/storage"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"fmt"
	"os/exec"
)

// 设置：adb 路径、偏好、收藏目录、版本

func (a *App) GetAdbPath() types.ExecResult {
	adbPath := "adb"
	if a.adbPath != "" {
		adbPath = a.adbPath
	}
	path, err := exec.LookPath(adbPath)
	if err == nil {
		return types.NewExecResultSuccess("adb", path)
	}
	return types.NewExecResultError("adb", err)
}

func (a *App) CheckAdbPath(path string) types.ExecResult {
	adbCmd := fmt.Sprintf("%s version", path)
	res, err := util.Exec(adbCmd, true, nil)
	if err == nil {
		return types.NewExecResultSuccess(adbCmd, res)
	}
	return types.NewExecResultError(adbCmd, err)
}

func (a *App) UpdateAdbPath(path string) {
	a.adbPath = path
	if a.deviceTracker != nil {
		a.deviceTracker.AdbPath = path
	}
	if a.store != nil {
		if err := a.store.Set(storage.KeyAdbPath, path); err != nil {
			applog.Errorf(applog.CategoryADB, "adb_path_save_failed path=%s err=%q", path, err.Error())
		}
	}
	applog.Infof(applog.CategoryADB, "adb_path_updated path=%s", path)
}

// GetTerminalOpenMode 快捷功能执行后何时打开执行记录：always / error / never
func (a *App) GetTerminalOpenMode() string {
	if a.store == nil {
		return "error"
	}
	switch mode := a.store.GetString(storage.KeyTerminalOpenMode, "error"); mode {
	case "always", "error", "never":
		return mode
	default:
		return "error"
	}
}

func (a *App) SetTerminalOpenMode(mode string) error {
	if mode != "always" && mode != "error" && mode != "never" {
		return fmt.Errorf("unknown terminal open mode: %s", mode)
	}
	if a.store == nil {
		return fmt.Errorf("storage is not initialized")
	}
	return a.store.Set(storage.KeyTerminalOpenMode, mode)
}

// GetVersion 返回应用版本号
func (a *App) GetVersion() string {
	return Version
}

// GetBookmarkPaths 获取收藏的路径列表
func (a *App) GetBookmarkPaths() []string {
	if a.store == nil {
		return []string{}
	}
	var paths []string
	err := a.store.Get(storage.KeyBookmarkPaths, &paths)
	if err != nil {
		return []string{}
	}
	return paths
}

// SetBookmarkPaths 保存收藏的路径列表
func (a *App) SetBookmarkPaths(paths []string) error {
	if a.store == nil {
		return fmt.Errorf("storage is not initialized")
	}
	return a.store.Set(storage.KeyBookmarkPaths, paths)
}
