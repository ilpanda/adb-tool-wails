package main

import (
	"adb-tool-wails/internal/actions"
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/types"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 快捷功能：前端按 action 名称调用 ExecuteAction，分发到 internal/actions

type Action struct {
	Action            string `json:"action"`
	TargetPackageName string `json:"targetPackageName"`
	DeviceId          string `json:"deviceId"`
	// TaskId 由前端生成，执行阶段通过 action-stage 事件按此 id 推送
	TaskId string `json:"taskId,omitempty"`
	// Files 本地文件路径，例如拖入窗口的 APK
	Files []string `json:"files,omitempty"`
}

// ActionStage action-stage 事件的数据
type ActionStage struct {
	TaskId string `json:"taskId"`
	Stage  string `json:"stage"`
}

var keyActionMap = map[string]string{
	"key-menu":        "KEYCODE_MENU",
	"key-home":        "KEYCODE_HOME",
	"key-back":        "KEYCODE_BACK",
	"key-power":       "KEYCODE_POWER",
	"key-app-switch":  "KEYCODE_APP_SWITCH",
	"key-mute":        "KEYCODE_VOLUME_MUTE",
	"key-volume-up":   "KEYCODE_VOLUME_UP",
	"key-volume-down": "KEYCODE_VOLUME_DOWN",
	"key-dpad-up":     "KEYCODE_DPAD_UP",
	"key-dpad-down":   "KEYCODE_DPAD_DOWN",
	"key-dpad-left":   "KEYCODE_DPAD_LEFT",
	"key-dpad-right":  "KEYCODE_DPAD_RIGHT",
	"key-wake-up":     "KEYCODE_WAKE_UP",
	"key-sleep":       "KEYCODE_SLEEP",
}

// ExecuteAction 执行快捷操作
func (a *App) ExecuteAction(ac Action) (result types.ExecResult) {
	action := ac.Action
	start := time.Now()
	applog.Infof(applog.CategoryAction, "action_started action=%s device=%s package=%s", action, ac.DeviceId, ac.TargetPackageName)
	defer func() {
		duration := time.Since(start).Milliseconds()
		if result.Error != "" {
			applog.Warnf(applog.CategoryAction, "action_failed action=%s device=%s package=%s duration_ms=%d err=%q", action, ac.DeviceId, ac.TargetPackageName, duration, result.Error)
			return
		}
		applog.Infof(applog.CategoryAction, "action_succeeded action=%s device=%s package=%s duration_ms=%d", action, ac.DeviceId, ac.TargetPackageName, duration)
	}()

	deviceName := adb.GetDeviceNameArray(a.adbPath)
	if len(deviceName) == 0 {
		result = types.NewExecResultErrorString("", "no devices，请使用数据线连接手机，并打开开发者模式")
		return
	}

	param := adb.ExecuteParams{
		Action:      action,
		PackageName: ac.TargetPackageName,
		Ctxt:        a.ctx,
		DeviceId:    ac.DeviceId,
		AdbPath:     a.adbPath,
	}
	if ac.TaskId != "" {
		param.OnStage = func(stage string) {
			runtime.EventsEmit(a.ctx, "action-stage", ActionStage{TaskId: ac.TaskId, Stage: stage})
		}
	}

	// 按键事件统一处理
	if keyCode, ok := keyActionMap[action]; ok {
		result = actions.SendKeyEvent(param, keyCode)
		return
	}

	switch action {
	case "view-current-activity":
		result = actions.GetCurrentPackageAndActivityName(param)
	case "view-current-fragment":
		result = a.getAllFragment(param)
	case "view-all-activities":
		result = actions.GetAllActivity(param)
	case "screenshot":
		result = actions.Screenshot(param)
	case "screenshot-clipboard":
		result = actions.ScreenshotToClipboard(param)
	case "reset-permissions":
		result = actions.RevokePermission(param)
	case "grant-permissions":
		result = actions.GrantAllPermission(param)
	case "force-stop":
		result = actions.KillApp(param)
	case "clear-data":
		result = actions.ClearApp(param)
	case "restart-app":
		result = actions.RestartApp(param)
	case "launch-app":
		result = actions.StartActivity(param)
	case "reboot-device":
		result = actions.Reboot(param)
	case "shutdown-device":
		result = actions.Shutdown(param)
	case "get-all-packages":
		result = actions.GetAllPackages(param)
	case "install-app":
		result = actions.InstallApp(param)
	case "install-apk-file":
		if len(ac.Files) != 1 {
			result = types.NewExecResultErrorString("install-apk-file", "需要且只能指定一个 APK 文件")
		} else {
			result = actions.InstallApkFile(param, ac.Files[0])
		}
	case "uninstall-app":
		result = actions.UninstallApp(param)
	case "get-system-info":
		result = actions.GetDeviceInfo(param)
	case "format-sys-info":
		result = actions.FormatSysMemInfo(param)
	case "get-system-property":
		result = actions.GetAllSystemProperties(param)
	case "export-app":
		result = actions.ExportAppPackagePath(param)
	case "install-app-path":
		result = actions.GetAppInstallPath(param)
	case "dump-pid":
		result = actions.PackagePid(param)
	case "dump-memory-info":
		result = actions.DumpSysMemInfo(param)
	case "dump-smaps":
		result = actions.SaveSmaps(param)
	case "dump-show-map":
		result = actions.SaveShowMap(param)
	case "dump-thread":
		result = actions.SaveThreadInfo(param)
	case "dump-hprof":
		result = actions.SaveHprof(param)
	case "get-package-info":
		result = actions.GetAppDesc(param)
	case "clear-restart-app":
		result = actions.ClearAndRestartApp(param)
	case "view-package":
		result = actions.GetCurrentPackageName(param)
	case "toggle-gpu-profile":
		result = actions.ToggleDevOption(param, "debug.hwui.profile", "visual_bars")
	case "toggle-gpu-overdraw":
		result = actions.ToggleDevOption(param, "debug.hwui.overdraw", "show")
	case "toggle-layout-bounds":
		result = actions.ToggleDevOption(param, "debug.layout", "true")
	case "jump-application-detail":
		result = actions.JumpToAppDetailSettings(param)
	case "jump-locale", "jump-developer", "jump-application", "jump-wifi-settings",
		"jump-notification", "jump-bluetooth", "jump-input", "jump-display":
		result = actions.JumpToSettings(param)
	default:
		result = types.NewExecResultFromString(action, "", fmt.Sprintf("不支持的操作: %s", action))
	}
	return
}

func (a *App) getAllFragment(param adb.ExecuteParams) types.ExecResult {
	activityResult := actions.GetCurrentPackageAndActivityName(param)
	res := activityResult.Res
	packageName := ""
	if res != "" && !strings.Contains(res, "no devices") && activityResult.Error == "" {
		parts := strings.Split(res, "/")
		packageName = strings.TrimSuffix(parts[0], "}")
	} else {
		return types.NewExecResultFromString("", "", res)
	}
	param.PackageName = packageName
	return actions.GetAllFragment(param)
}

// OpenDeepLink 在设备上打开 Deep Link；packageName 非空时只在该应用内解析
func (a *App) OpenDeepLink(deviceId string, link string, packageName string) actions.DeepLinkResult {
	param := a.buildParam(deviceId)
	param.AdbPath = a.adbBinary()
	return actions.OpenDeepLink(param, link, packageName)
}

func (a *App) SaveFile(content string, fileNamePrefix string) types.ExecResult {
	return actions.SaveFile(a.ctx, content, fileNamePrefix, "保存文件")
}

func (a *App) SaveFileAsCsv(content string, fileNamePrefix string) types.ExecResult {
	return actions.SaveFileAsCSV(a.ctx, content, fileNamePrefix, "保存文件")
}

// RevealPath 在系统文件管理器中显示并选中本地文件
func (a *App) RevealPath(path string) types.ExecResult {
	if _, err := os.Stat(path); err != nil {
		return types.NewExecResultError("reveal", err)
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", "/select,", path)
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	if err := cmd.Start(); err != nil {
		return types.NewExecResultError("reveal", err)
	}
	go func() { _ = cmd.Wait() }()
	return types.NewExecResultSuccess("reveal", path)
}
