package main

import (
	"adb-tool-wails/adb"
	"adb-tool-wails/types"
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx           context.Context
	deviceTracker *adb.DeviceTracker

	deviceUpdateTimer *time.Timer
	deviceUpdateMutex sync.Mutex
	pendingDevices    []adb.DeviceInfo
}

type Action struct {
	Action            string `json:"action"`
	TargetPackageName string `json:"targetPackageName"`
	DeviceId          string `json:"deviceId"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.deviceTracker = adb.NewDeviceTracker(func(devices []adb.DeviceInfo) {
		a.scheduleDeviceUpdate(devices)
	})
	// 启动跟踪
	go a.deviceTracker.Start(ctx)
}

func (a *App) scheduleDeviceUpdate(devices []adb.DeviceInfo) {
	a.deviceUpdateMutex.Lock()
	defer a.deviceUpdateMutex.Unlock()

	a.pendingDevices = devices

	if a.deviceUpdateTimer != nil {
		a.deviceUpdateTimer.Stop()
	}

	a.deviceUpdateTimer = time.AfterFunc(500*time.Millisecond, func() {
		a.deviceUpdateMutex.Lock()
		devicesToSend := a.pendingDevices
		a.deviceUpdateMutex.Unlock()
		runtime.EventsEmit(a.ctx, "adb_update", devicesToSend)
	})
}

// ExecuteAction 执行快捷操作
func (a *App) ExecuteAction(ac Action) types.ExecResult {
	action := ac.Action
	fmt.Printf("execute action : %s\n", action)

	deviceName := adb.GetDeviceNameArray()
	if len(deviceName) == 0 {
		return types.NewExecResultErrorString("", "no devices，请连接手机")
	}

	param := adb.ExecuteParams{
		PackageName: ac.TargetPackageName,
		Ctxt:        a.ctx,
		DeviceId:    ac.DeviceId,
	}

	switch action {
	case "view-current-activity":
		return adb.GetCurrentPackageAndActivityName(param)
	case "view-current-fragment":
		return a.getAllFragment(param)
	case "view-all-activities":
		return adb.GetAllActivity(param)
	case "screenshot":
		return adb.Screenshot(param)
	case "reset-permissions":
		return adb.RevokePermission(param)
	case "grant-permissions":
		return adb.GrantAllPermission(param)
	case "force-stop":
		return adb.KillApp(param)
	case "clear-data":
		return adb.ClearApp(param)
	case "restart-app":
		return adb.RestartApp(param)
	case "reboot-device":
		return adb.Reboot(param)
	case "shutdown-device":
		return adb.Shutdown(param)
	case "key-menu":
		return adb.KeyMenu(param)
	case "key-home":
		return adb.KeyHome(param)
	case "key-back":
		return adb.KeyBack(param)
	case "key-power":
		return adb.KeyPower(param)
	case "key-app-switch":
		return adb.KeyAppSwitch(param)
	case "key-mute":
		return adb.KeyVolumeMute(param)
	case "key-volume-up":
		return adb.KeyVolumeUP(param)
	case "key-volume-down":
		return adb.KeyVolumeDown(param)
	case "get-all-packages":
		return adb.GetAllPackages(param)
	case "install-app":
		return adb.InstallApp(param)
	case "uninstall-app":
		return adb.UninstallApp(param)
	case "get-system-property":
		return adb.GetAllSystemProperties(param)
	case "export-app":
		return adb.ExportAppPackagePath(param)
	case "install-app-path":
		return adb.GetAppInstallPath(param)
	}

	return types.NewExecResultFromString(action, "", fmt.Sprintf("不支持的操作: %s", action))
}

func (a *App) getAllFragment(param adb.ExecuteParams) types.ExecResult {
	activityResult := adb.GetCurrentPackageAndActivityName(param)
	res := activityResult.Res
	packageName := ""
	if res != "" && !strings.Contains(res, "no devices") && activityResult.Error == "" {
		parts := strings.Split(res, "/")
		packageName = strings.TrimSuffix(parts[0], "}")
	} else {
		return types.NewExecResultFromString("", "", res)
	}
	param.PackageName = packageName
	return adb.GetAllFragment(param)
}

func (a *App) GetDeviceNameArray() []adb.DeviceInfo {
	devices := adb.GetDeviceNameArray()
	deviceNameArray := []adb.DeviceInfo{} // ✅ 空切片，不是 nil
	for _, deviceId := range devices {
		device := adb.GetDeviceNameByDeviceId(deviceId)
		deviceNameArray = append(deviceNameArray, adb.DeviceInfo{
			ID:   deviceId,
			Name: device,
		})
	}
	return deviceNameArray
}
