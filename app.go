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
		runtime.LogError(ctx, "Failed to initialize storage: "+err.Error())
	} else {
		a.store = store
	}

	if err := a.extractAyaDex(); err != nil {
		runtime.LogError(ctx, "Failed to extract aya.dex: "+err.Error())
	}

	a.setupEnv()
	saveAdbPath := ""
	if a.store != nil {
		saveAdbPath = a.store.GetString(storage.KeyAdbPath, "")
	}

	path, err := exec.LookPath("adb")
	if err == nil && path != "" {
		a.adbPath = "adb"
	} else if saveAdbPath != "" {
		a.adbPath = saveAdbPath
	}

	a.deviceTracker = adb.NewDeviceTracker(a.adbPath, func(devices []adb.DeviceInfo) {
		a.scheduleDeviceUpdate(devices)
	})
	// 启动跟踪
	go a.deviceTracker.Start(ctx)
}

func (a *App) shutdown(ctx context.Context) {
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
			runtime.LogError(ctx, "Failed to close Aya client: "+err.Error())
		}
		a.ayaClient = nil
	}

	if a.store != nil {
		if err := a.store.Close(); err != nil {
			runtime.LogError(ctx, "Failed to close storage: "+err.Error())
		}
		a.store = nil
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

	// 按键事件统一处理
	if keyCode, ok := keyActionMap[action]; ok {
		return adb.SendKeyEvent(param, keyCode)
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
	case "get-all-packages":
		return adb.GetAllPackages(param)
	case "install-app":
		return adb.InstallApp(param)
	case "uninstall-app":
		return adb.UninstallApp(param)
	case "get-system-info":
		return adb.GetDeviceInfo(param)
	case "format-sys-info":
		return adb.FormatSysMemInfo(param)
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
	case "dump-show-map":
		return adb.SaveShowMap(param)
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
		return adb.ToggleDevOption(param, "debug.hwui.profile", "visual_bars")
	case "toggle-gpu-overdraw":
		return adb.ToggleDevOption(param, "debug.hwui.overdraw", "show")
	case "toggle-layout-bounds":
		return adb.ToggleDevOption(param, "debug.layout", "true")
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
	if a.deviceTracker != nil {
		a.deviceTracker.AdbPath = path
	}
	if a.store != nil {
		if err := a.store.Set(storage.KeyAdbPath, path); err != nil {
			runtime.LogError(a.ctx, "Failed to save adb path: "+err.Error())
		}
	}
}

func (a *App) GetAutoOpenTerminal() bool {
	if a.store == nil {
		return true
	}
	return a.store.GetBool(storage.KeyAutoOpenTerminal, true)
}

func (a *App) SetAutoOpenTerminal(enabled bool) error {
	if a.store == nil {
		return fmt.Errorf("storage is not initialized")
	}
	return a.store.Set(storage.KeyAutoOpenTerminal, enabled)
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

func (a *App) SaveFile(content string, fileNamePrefix string) types.ExecResult {
	return adb.SaveFile(a.ctx, content, fileNamePrefix, "保存文件")
}

func (a *App) SaveFileAsCsv(content string, fileNamePrefix string) types.ExecResult {
	return adb.SaveFileAsCSV(a.ctx, content, fileNamePrefix, "保存文件")
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

// buildParam 构建 ADB 执行参数
func (a *App) buildParam(deviceId string) adb.ExecuteParams {
	return adb.ExecuteParams{
		Ctxt:     a.ctx,
		AdbPath:  a.adbPath,
		DeviceId: deviceId,
	}
}

// ListDirectory 列出设备目录内容
func (a *App) ListDirectory(deviceId string, path string) types.ExecResult {
	param := a.buildParam(deviceId)
	cmd := adb.BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("ls -la %s", path))
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}

// ReadFileContent 读取设备文件内容
func (a *App) ReadFileContent(deviceId string, path string) types.ExecResult {
	param := a.buildParam(deviceId)
	cmd := adb.BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("cat %s", path))
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, res)
}

// DeleteRemoteFile 删除设备文件
func (a *App) DeleteRemoteFile(deviceId string, path string) types.ExecResult {
	param := a.buildParam(deviceId)
	cmd := adb.BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("rm -rf %s", path))
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}

// UploadFile 上传本地文件到设备（adb push）
func (a *App) UploadFile(deviceId string, remotePath string) types.ExecResult {
	localPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
	if err != nil {
		return types.NewExecResultErrorString("upload", fmt.Sprintf("选择文件失败: %v", err))
	}
	if localPath == "" {
		return types.NewExecResultErrorString("upload", "已取消")
	}
	param := a.buildParam(deviceId)
	dest := remotePath
	if dest == "" {
		dest = "/sdcard/"
	}
	cmd := adb.BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("push %s %s", localPath, dest))
	res, err2 := util.Exec(cmd, true, nil)
	if err2 != nil {
		return types.NewExecResultFromError(cmd, "", err2)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}

// DownloadFile 从设备下载文件到本地（adb pull）
func (a *App) DownloadFile(deviceId string, remotePath string) types.ExecResult {
	fileName := filepath.Base(remotePath)
	localPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: fileName,
		Title:           "保存到本地",
	})
	if err != nil {
		return types.NewExecResultErrorString("download", fmt.Sprintf("选择保存路径失败: %v", err))
	}
	if localPath == "" {
		return types.NewExecResultErrorString("download", "已取消")
	}
	param := a.buildParam(deviceId)
	cmd := adb.BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pull %s %s", remotePath, localPath))
	res, err2 := util.Exec(cmd, true, nil)
	if err2 != nil {
		return types.NewExecResultFromError(cmd, "", err2)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
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
