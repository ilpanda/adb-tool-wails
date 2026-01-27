package main

import (
	"adb-tool-wails/adb"
	"adb-tool-wails/aya"
	"adb-tool-wails/storage"
	"adb-tool-wails/types"
	"adb-tool-wails/util"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx               context.Context
	store             *storage.BadgerStore
	deviceTracker     *adb.DeviceTracker
	adbPath           string
	deviceUpdateTimer *time.Timer
	deviceUpdateMutex sync.Mutex
	pendingDevices    []adb.DeviceInfo
	ayaClient         *aya.Client
	ayaDexPath        string

	// 用于取消应用列表加载任务
	appListCancel context.CancelFunc
	appListMutex  sync.Mutex
	appListDone   chan struct{} // 新增：用于等待任务完成
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
	// 初始化存储
	store, err := storage.NewBadgerStore("config")
	if err != nil {
		panic(err)
	}

	if err := a.extractAyaDex(); err != nil {
		runtime.LogError(ctx, "Failed to extract aya.dex: "+err.Error())
	}

	a.store = store
	a.setupEnv()
	path, err := exec.LookPath("adb")
	if err == nil {
		saveAdbPath := store.GetString(storage.KeyAdbPath, "")
		if path == saveAdbPath && path != "" {
			a.adbPath = "adb"
		} else if path != "" {
			a.adbPath = "adb"
		} else if saveAdbPath != "" {
			a.adbPath = saveAdbPath
		}
	}

	a.deviceTracker = adb.NewDeviceTracker(a.adbPath, func(devices []adb.DeviceInfo) {
		a.scheduleDeviceUpdate(devices)
	})
	// 启动跟踪
	go a.deviceTracker.Start(ctx)
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

// ExecuteAction 执行快捷操作
func (a *App) ExecuteAction(ac Action) types.ExecResult {
	action := ac.Action
	fmt.Printf("execute action : %s\n", action)

	deviceName := adb.GetDeviceNameArray(a.adbPath)
	if len(deviceName) == 0 {
		return types.NewExecResultErrorString("", "no devices，请使用数据线连接手机，并打开开发者模式")
	}

	param := adb.ExecuteParams{
		Action:      action,
		PackageName: ac.TargetPackageName,
		Ctxt:        a.ctx,
		DeviceId:    ac.DeviceId,
		AdbPath:     a.adbPath,
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
	case "get-system-info":
		return adb.GetDeviceInfo(param)
	case "get-system-property":
		return adb.GetAllSystemProperties(param)
	case "export-app":
		return adb.ExportAppPackagePath(param)
	case "install-app-path":
		return adb.GetAppInstallPath(param)
	case "dump-pid":
		return adb.PackagePid(param)
	case "dump-memory-info":
		return adb.DumpSysMemInfo(param)
	case "dump-smaps":
		return adb.SaveSmaps(param)
	case "dump-thread":
		return adb.SaveThreadInfo(param)
	case "dump-hprof":
		return adb.SaveHprof(param)
	case "get-package-info":
		return adb.GetAppDesc(param)
	case "clear-restart-app":
		return adb.ClearAndRestartApp(param)
	case "view-package":
		return adb.GetCurrentPackageName(param)
	case "toggle-gpu-profile":
		return adb.ToggleGPUProfile(param)
	case "toggle-gpu-overdraw":
		return adb.ToggleGPUOverdraw(param)
	case "toggle-layout-bounds":
		return adb.ToggleLayoutBounds(param)
	case "jump-application-detail":
		return adb.JumpToAppDetailSettings(param)
	case "jump-locale", "jump-developer", "jump-application", "jump-wifi-settings",
		"jump-notification", "jump-bluetooth", "jump-input", "jump-display":
		return adb.JumpToSettings(param)
	}

	return types.NewExecResultFromString(action, "", fmt.Sprintf("不支持的操作: %s", action))
}

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
	a.deviceTracker.AdbPath = path
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

func (a *App) SaveFile(content string) types.ExecResult {
	return adb.SaveFile(a.ctx, content, "save_log", "保存日志")
}

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

	allPackagesRes := adb.GetAllPackages(param)
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
	log.Printf("Total packages to fetch: %d", totalPackages)

	// 发送开始事件
	emitProgress(totalPackages, 0, false)

	// 分批获取应用信息，每批50个
	batchSize := 50
	allApps := make([]aya.PackageInfo, 0, totalPackages)

	for i := 0; i < totalPackages; i += batchSize {
		// 检查是否已取消
		if isCancelled() {
			log.Println("App list loading cancelled")
			return nil, context.Canceled
		}

		end := i + batchSize
		if end > totalPackages {
			end = totalPackages
		}

		batch := packageNames[i:end]
		log.Printf("Fetching batch %d-%d of %d", i+1, end, totalPackages)

		// 批量获取当前批次的应用信息
		batchApps, err := client.GetPackageInfos(batch)
		if err != nil {
			if isCancelled() {
				return nil, context.Canceled
			}
			log.Printf("Failed to get batch %d-%d: %v", i+1, end, err)
			continue
		}

		allApps = append(allApps, batchApps...)

		// 发送进度更新
		emitProgress(totalPackages, len(allApps), false)

		log.Printf("Progress: %d/%d apps loaded", len(allApps), totalPackages)
	}

	// 检查是否已取消，取消则不发送完成事件
	if isCancelled() {
		return nil, context.Canceled
	}

	// 发送完成事件
	emitProgress(totalPackages, len(allApps), true)

	log.Printf("Completed: %d apps loaded", len(allApps))

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
		log.Println("Cancelling previous app list loading task...")
		cancel()

		// 等待前一个任务完成
		if done != nil {
			select {
			case <-done:
				log.Println("Previous task finished")
			case <-time.After(3 * time.Second):
				log.Println("Warning: previous task did not finish in time")
			}
		}
	}
}

func (a *App) LogMsg(msg string) {
	println(msg)
}
