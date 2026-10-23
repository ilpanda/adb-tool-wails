package main

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/aya"
	"adb-tool-wails/internal/perf"
	"adb-tool-wails/internal/storage"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 是绑定给前端的对象：这里只放结构体与生命周期，各功能的方法按文件拆分在 app_*.go 中，具体实现在 internal/ 下

// App struct
type App struct {
	ctx               context.Context
	store             *storage.BadgerStore
	logManager        *applog.Manager
	deviceTracker     *adb.DeviceTracker
	adbPath           string
	deviceUpdateTimer *time.Timer
	deviceUpdateMutex sync.Mutex
	pendingDevices    []adb.DeviceInfo
	ayaClient         *aya.Client
	ayaDexPath        string
	perfMonitor       *perf.Monitor

	// 用于取消应用列表加载任务
	appListCancel context.CancelFunc
	appListMutex  sync.Mutex
	appListDone   chan struct{} // 新增：用于等待任务完成
}

// NewApp creates a new App application struct
func NewApp(logManager *applog.Manager) *App {
	return &App{logManager: logManager}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	applog.Infof(applog.CategoryStartup, "startup_begin version=%s", Version)
	// 初始化存储
	store, err := storage.NewBadgerStore("config")
	if err != nil {
		applog.Errorf(applog.CategoryStartup, "storage_init_failed err=%q", err.Error())
	} else {
		a.store = store
		applog.Infof(applog.CategoryStartup, "storage_ready namespace=config")
	}

	if err := a.extractAyaDex(); err != nil {
		applog.Errorf(applog.CategoryStartup, "aya_dex_extract_failed err=%q", err.Error())
	} else {
		applog.Infof(applog.CategoryStartup, "aya_dex_ready path=%s", a.ayaDexPath)
	}

	a.setupEnv()
	saveAdbPath := ""
	if a.store != nil {
		saveAdbPath = a.store.GetString(storage.KeyAdbPath, "")
	}

	path, err := exec.LookPath("adb")
	adbSource := "unset"
	if err == nil && path != "" {
		a.adbPath = "adb"
		adbSource = "system"
	} else if saveAdbPath != "" {
		a.adbPath = saveAdbPath
		adbSource = "saved"
	}
	applog.Infof(applog.CategoryStartup, "adb_path_selected source=%s path=%s", adbSource, a.adbPath)

	a.deviceTracker = adb.NewDeviceTracker(a.adbPath, func(devices []adb.DeviceInfo) {
		a.scheduleDeviceUpdate(devices)
	})
	a.perfMonitor = perf.NewMonitor(func(event string, data any) {
		runtime.EventsEmit(a.ctx, event, data)
	})

	// 启动跟踪
	go a.deviceTracker.Start(ctx)
	applog.Infof(applog.CategoryStartup, "device_tracker_started adb_path=%s", a.adbPath)
}

func (a *App) shutdown(ctx context.Context) {
	if a.deviceTracker != nil {
		a.deviceTracker.Stop(time.Second)
	}
	if a.perfMonitor != nil {
		a.perfMonitor.Stop(time.Second)
	}

	a.deviceUpdateMutex.Lock()
	if a.deviceUpdateTimer != nil {
		a.deviceUpdateTimer.Stop()
		a.deviceUpdateTimer = nil
	}
	a.deviceUpdateMutex.Unlock()

	a.appListMutex.Lock()
	if a.appListCancel != nil {
		a.appListCancel()
		a.appListCancel = nil
	}
	a.appListMutex.Unlock()

	if a.ayaClient != nil {
		if err := a.ayaClient.Close(); err != nil {
			applog.Warnf(applog.CategoryStartup, "aya_client_close_failed err=%q", err.Error())
		}
		a.ayaClient = nil
	}

	if a.store != nil {
		if err := a.store.Close(); err != nil {
			applog.Warnf(applog.CategoryStartup, "storage_close_failed err=%q", err.Error())
		}
		a.store = nil
	}
	applog.Infof(applog.CategoryStartup, "shutdown_completed")
	if a.logManager != nil {
		if err := a.logManager.Close(); err != nil {
			println("failed to close log manager:", err.Error())
		}
	}
}

func (a *App) setupEnv() {
	if goruntime.GOOS == "darwin" {
		homeDir, _ := os.UserHomeDir()
		additionalPaths := []string{
			"/usr/local/bin",    // Homebrew (Intel)`
			"/opt/homebrew/bin", // Homebrew (Apple Silicon)
			filepath.Join(homeDir, "Library/Android/sdk/platform-tools"), // Android SDK
			filepath.Join(homeDir, ".local/bin"),                         // 用户本地二进制
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
		}
		newPath := strings.Join(additionalPaths, ":")
		os.Setenv("PATH", newPath)
	}
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

func (a *App) GetDeviceNameArray() []adb.DeviceInfo {
	devices := adb.GetDeviceNameArray(a.adbPath)
	deviceNameArray := []adb.DeviceInfo{} // ✅ 空切片，不是 nil
	for _, deviceId := range devices {
		device := adb.GetDeviceNameByDeviceId(a.adbPath, deviceId)
		deviceNameArray = append(deviceNameArray, adb.DeviceInfo{
			ID:   deviceId,
			Name: device,
		})
	}
	return deviceNameArray
}

// buildParam 构建 ADB 执行参数
func (a *App) buildParam(deviceId string) adb.ExecuteParams {
	return adb.ExecuteParams{
		Ctxt:     a.ctx,
		AdbPath:  a.adbPath,
		DeviceId: deviceId,
	}
}

// adbBinary 未配置 adb 路径时使用 PATH 中的 adb
func (a *App) adbBinary() string {
	if a.adbPath != "" {
		return a.adbPath
	}
	return "adb"
}
