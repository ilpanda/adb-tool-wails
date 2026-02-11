package adb

import (
	"adb-tool-wails/types"
	"adb-tool-wails/util"
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ExecuteParams struct {
	Action      string
	PackageName string
	Ctxt        context.Context
	DeviceId    string
	AdbPath     string
}

func BuildAdbCmd(adbPath string, deviceId string, shellCmd string) string {
	if deviceId != "" {
		return fmt.Sprintf("%s -s %s %s", adbPath, deviceId, shellCmd)
	}
	return fmt.Sprintf("%s %s", adbPath, shellCmd)
}

func BuildAdbShellCmd(adbPath string, deviceId string, shellCmd string) string {
	if deviceId != "" {
		return fmt.Sprintf("%s -s %s shell %s", adbPath, deviceId, shellCmd)
	}
	return fmt.Sprintf("%s shell %s", adbPath, shellCmd)
}

func GetCurrentPackageAndActivityName(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "dumpsys activity activities | grep mResumedActivity | awk '{print $4}'")
	result, err := util.Exec(cmd, true, nil)

	if err != nil || strings.TrimSpace(result) == "" {
		cmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "dumpsys activity activities | grep ResumedActivity | grep -v top | awk '{print $4}'")
		result, err = util.Exec(cmd, true, nil)
		if err != nil {
			return types.NewExecResultFromError(cmd, "", err)
		}
		return types.NewExecResultSuccess(cmd, strings.TrimSuffix(result, "}\n"))
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSuffix(result, "}\n"))
}

func GetCurrentPackageName(param ExecuteParams) types.ExecResult {
	res := GetCurrentPackageAndActivityName(param)
	if res.Error != "" {
		return res
	}
	packageName, _, found := strings.Cut(res.Res, "/")
	if !found {
		return types.NewExecResultErrorString(res.Cmd, "not found")
	}
	return types.NewExecResultSuccess(res.Cmd, packageName)
}

func GetAllActivity(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "dumpsys activity activities | grep -e 'Hist #' -e '* Hist'")
	return execCmd(cmd)
}

func GetAllFragment(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys activity %s | grep -E '^\\s*#\\d' | grep -v -E 'ReportFragment|plan'", param.PackageName))
	return execCmd(cmd)
}

func KillApp(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("am force-stop %s", param.PackageName))
	return execCmd(cmd)
}

func ClearApp(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm clear %s", param.PackageName))
	return execCmd(cmd)
}

// 定义危险权限列表（Android 常见的运行时权限）
var dangerousPermissions = map[string]bool{
	"android.permission.READ_CALENDAR":              true,
	"android.permission.WRITE_CALENDAR":             true,
	"android.permission.CAMERA":                     true,
	"android.permission.READ_CONTACTS":              true,
	"android.permission.WRITE_CONTACTS":             true,
	"android.permission.GET_ACCOUNTS":               true,
	"android.permission.ACCESS_FINE_LOCATION":       true,
	"android.permission.ACCESS_COARSE_LOCATION":     true,
	"android.permission.ACCESS_BACKGROUND_LOCATION": true,
	"android.permission.RECORD_AUDIO":               true,
	"android.permission.READ_PHONE_STATE":           true,
	"android.permission.READ_PHONE_NUMBERS":         true,
	"android.permission.CALL_PHONE":                 true,
	"android.permission.ANSWER_PHONE_CALLS":         true,
	"android.permission.READ_CALL_LOG":              true,
	"android.permission.WRITE_CALL_LOG":             true,
	"android.permission.ADD_VOICEMAIL":              true,
	"android.permission.USE_SIP":                    true,
	"android.permission.PROCESS_OUTGOING_CALLS":     true,
	"android.permission.BODY_SENSORS":               true,
	"android.permission.SEND_SMS":                   true,
	"android.permission.RECEIVE_SMS":                true,
	"android.permission.READ_SMS":                   true,
	"android.permission.RECEIVE_WAP_PUSH":           true,
	"android.permission.RECEIVE_MMS":                true,
	"android.permission.READ_EXTERNAL_STORAGE":      true,
	"android.permission.WRITE_EXTERNAL_STORAGE":     true,
	"android.permission.ACCESS_MEDIA_LOCATION":      true,
	"android.permission.ACTIVITY_RECOGNITION":       true,
	"android.permission.READ_MEDIA_IMAGES":          true,
	"android.permission.READ_MEDIA_VIDEO":           true,
	"android.permission.READ_MEDIA_AUDIO":           true,
	"android.permission.NEARBY_WIFI_DEVICES":        true,
	"android.permission.BLUETOOTH_SCAN":             true,
	"android.permission.BLUETOOTH_CONNECT":          true,
	"android.permission.BLUETOOTH_ADVERTISE":        true,
	"android.permission.POST_NOTIFICATIONS":         true,
}

func GrantAllPermission(param ExecuteParams) types.ExecResult {
	dumpCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
	dumpPackage := execCmd(dumpCmd)
	if dumpPackage.Error != "" {
		return types.NewExecResultErrorString(dumpCmd, dumpPackage.Error)
	}

	allPermissions := getRequestedPermissions(util.MultiLine(dumpPackage.Res))

	var grantablePermissions []string
	for _, perm := range allPermissions {
		if dangerousPermissions[perm] {
			grantablePermissions = append(grantablePermissions, perm)
		}
	}

	if len(grantablePermissions) == 0 {
		return types.NewExecResultSuccess(dumpCmd, "未找到需要授权的危险权限")
	}

	var grantCmdsForExec []string
	var grantCmdsForDisplay []string

	for _, perm := range grantablePermissions {
		grantCmdsForExec = append(grantCmdsForExec, fmt.Sprintf("pm grant %s %s 2>&1", param.PackageName, perm))
		displayCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm grant %s %s", param.PackageName, perm))
		grantCmdsForDisplay = append(grantCmdsForDisplay, displayCmd)
	}

	batchCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("'%s'", strings.Join(grantCmdsForExec, " ; ")))
	result := execCmd(batchCmd)

	successCount := len(grantablePermissions)
	if result.Res != "" {
		errorLines := strings.Split(result.Res, "\n")
		for _, line := range errorLines {
			if strings.Contains(line, "Exception") {
				successCount--
			}
		}
	}

	resMsg := fmt.Sprintf("授权完成: 成功 %d/%d 个危险权限", successCount, len(grantablePermissions))
	if result.Res != "" && strings.Contains(result.Res, "Exception") {
		resMsg += "\n部分权限授权失败（可能需要特殊处理）"
	}

	displayCmd := strings.Join(grantCmdsForDisplay, "\n")

	return types.ExecResult{
		Cmd:   displayCmd,
		Res:   resMsg,
		Error: "",
	}
}

func RevokePermission(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
	resCmd := cmd
	dumpPackage := execCmd(cmd)
	if dumpPackage.Error != "" {
		return types.NewExecResultErrorString(cmd, dumpPackage.Error)
	}

	lines := util.MultiLine(dumpPackage.Res)
	for _, line := range lines {
		if strings.Contains(line, "permission") && strings.Contains(line, "granted=true") {
			parts := strings.Split(line, ":")
			if len(parts) > 0 {
				permission := strings.TrimSpace(parts[0])
				revokeCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm revoke %s %s", param.PackageName, permission))
				resCmd = resCmd + "\n" + revokeCmd
				execCmd(revokeCmd)
			}
		}
	}
	return types.NewExecResultSuccess(resCmd, "")
}

func RestartApp(param ExecuteParams) types.ExecResult {
	killAppRes := KillApp(param)
	resCmd := killAppRes.Cmd
	if killAppRes.Error != "" {
		return killAppRes
	}
	startAppRes := StartActivity(param)
	resCmd = resCmd + "\n" + startAppRes.Cmd
	if startAppRes.Error != "" {
		return types.NewExecResultErrorString(resCmd, startAppRes.Error)
	}
	return types.NewExecResultSuccess(resCmd, "")
}

func ClearAndRestartApp(param ExecuteParams) types.ExecResult {
	clearAppRes := ClearApp(param)
	resCmd := clearAppRes.Cmd
	if clearAppRes.Error != "" {
		return clearAppRes
	}

	inputMethodCmd := IsInputMethod(param)

	if inputMethodCmd.Res != "" {
		resCmd = resCmd + "\n" + inputMethodCmd.Cmd
		changeInputMethodCmd := execCmd(BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("settings put secure default_input_method %s", inputMethodCmd.Res)))
		resCmd = resCmd + "\n" + changeInputMethodCmd.Cmd
		if changeInputMethodCmd.Error != "" {
			return types.NewExecResultErrorString(resCmd, changeInputMethodCmd.Error)
		}
		return types.NewExecResultSuccess(resCmd, "")
	}

	startAppRes := StartActivity(param)
	resCmd = resCmd + "\n" + startAppRes.Cmd
	if startAppRes.Error != "" {
		return types.NewExecResultErrorString(resCmd, startAppRes.Error)
	}
	return types.NewExecResultSuccess(resCmd, "")
}

func IsInputMethod(param ExecuteParams) types.ExecResult {
	inputMethodRes := listInputMethodService(param)
	if inputMethodRes.Error != "" {
		return inputMethodRes
	}
	array := util.MultiLine(inputMethodRes.Res)
	for _, s := range array {
		if strings.Contains(s, param.PackageName) {
			return types.NewExecResultSuccess(inputMethodRes.Cmd, strings.TrimSpace(s))
		}
	}
	return types.NewExecResultErrorString(inputMethodRes.Cmd, "")
}

func listInputMethodService(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "ime list -s")
	result := execCmd(cmd)
	if result.Res != "" {
		result.Res = strings.TrimSpace(result.Res)
	}
	return result
}

func StartActivity(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", param.PackageName))
	return execCmd(cmd)
}

func Shutdown(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "reboot -p")
	return execCmd(cmd)
}

func GetAppInstallPath(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
	return execCmd(cmd)
}

func ExportAppPackagePath(param ExecuteParams) types.ExecResult {
	pathCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
	pathResult := execCmd(pathCmd)
	if pathResult.Error != "" {
		return pathResult
	}
	dir, err := runtime.OpenDirectoryDialog(param.Ctxt, runtime.OpenDialogOptions{
		Title: "选择导出目录",
	})

	if err != nil {
		return types.NewExecResultErrorString(pathCmd, pathResult.Error)
	}

	if dir == "" {
		return types.NewExecResultErrorString(pathCmd, "用户取消选择导出目录")
	}
	path := strings.TrimPrefix(strings.TrimSpace(pathResult.Res), "package:")

	finalRes := pathCmd
	targetApkName := filepath.Join(strings.TrimSpace(dir), param.PackageName+".apk")
	cmd := BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pull %s %s", path, targetApkName))

	finalRes = finalRes + "\n" + cmd
	return execCmd(finalRes)
}

func GetDeviceNameArray(adbPath string) []string {
	devicesRes := Devices(adbPath)
	var devices []string
	if devicesRes.Error == "" {
		devices = GetDevices(devicesRes.Res, devices)
	}
	return devices
}

func GetDeviceNameByDeviceId(adbPath string, deviceId string) string {
	cmd := BuildAdbShellCmd(adbPath, deviceId, "getprop ro.product.model")
	execResult := execCmd(cmd)
	if execResult.Error != "" {
		return execResult.Error
	}
	return strings.TrimSpace(execResult.Res)
}

func GetDevices(data string, devices []string) []string {
	lines := strings.Split(data, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "List of devices") || strings.Contains(line, "unauthorized") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) == 2 {
			devices = append(devices, fields[0])
		}
	}
	return devices
}

func Devices(adbPath string) types.ExecResult {
	cmd := fmt.Sprintf("%s devices", adbPath)
	return execCmd(cmd)
}

func Reboot(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbCmd(param.AdbPath, param.DeviceId, "reboot")
	return execCmd(cmd)
}

func KeyHome(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_HOME")
	return execCmd(cmd)
}

func KeyBack(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_BACK")
	return execCmd(cmd)
}

func KeyPower(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_POWER")
	return execCmd(cmd)
}

func KeyAppSwitch(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_APP_SWITCH")
	return execCmd(cmd)
}

func KeyMenu(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_MENU")
	return execCmd(cmd)
}

func KeyVolumeUP(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_VOLUME_UP")
	return execCmd(cmd)
}

func KeyVolumeDown(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_VOLUME_DOWN")
	return execCmd(cmd)
}

func KeyVolumeMute(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_VOLUME_MUTE")
	return execCmd(cmd)
}

func KeyDpadUp(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_DPAD_UP")
	return execCmd(cmd)
}

func KeyDpadDown(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_DPAD_DWON")
	return execCmd(cmd)
}

func KeyDpadLeft(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_DPAD_LEFT")
	return execCmd(cmd)
}

func KeyDpadRight(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_DPAD_RIGHT")
	return execCmd(cmd)
}

func KeyScreenWakeUp(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_WAKE_UP")
	return execCmd(cmd)
}

func KeyScreenSleep(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.AdbPath, param.DeviceId, "KEYCODE_SLEEP")
	return execCmd(cmd)
}

func getKey(adbPath string, deviceId string, key string) string {
	return BuildAdbShellCmd(adbPath, deviceId, fmt.Sprintf("input keyevent %s", key))
}

func getRequestedPermissions(lines []string) []string {
	var permissions []string
	inPermissionSection := false

	for _, line := range lines {
		if !strings.Contains(line, ".permission.") {
			inPermissionSection = false
		}
		if strings.Contains(line, "requested permissions:") {
			inPermissionSection = true
			continue
		}
		if inPermissionSection {
			permissionName := strings.TrimSpace(strings.ReplaceAll(line, ":", ""))
			permissions = append(permissions, permissionName)
		}
	}
	return permissions
}

func GetAllPackages(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "pm list packages")
	execResult := execCmd(cmd)
	var packages []string
	if execResult.Error != "" {
		return types.NewExecResultErrorString(cmd, execResult.Error)
	}
	split := strings.Split(execResult.Res, "\n")
	for _, packageName := range split {
		packageName = strings.TrimSpace(packageName)
		if packageName != "" {
			packageName := strings.TrimPrefix(packageName, "package:")
			packages = append(packages, packageName)
		}
	}
	return types.NewExecResultSuccess(cmd, strings.Join(packages, "\n"))
}

func GetAllSystemProperties(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "getprop")
	return execCmd(cmd)
}

func InstallApp(param ExecuteParams) types.ExecResult {
	filePath, err := runtime.OpenFileDialog(param.Ctxt, runtime.OpenDialogOptions{
		Title: "选择 APK 文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Android APK (*.apk)",
				Pattern:     "*.apk",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})

	if err != nil {
		return types.NewExecResultError("installApp", err)
	}

	if filePath == "" {
		return types.NewExecResultErrorString("installApp", "用户取消安装")
	}

	cmd := BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("install -d -t %s", filePath))
	res := execCmd(cmd)

	return res
}

func UninstallApp(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("uninstall %s", param.PackageName))
	return execCmd(cmd)
}

func Screenshot(param ExecuteParams) types.ExecResult {
	// 1. 先获取保存路径
	timestamp := time.Now().Format("2006_01_02_15_04_05")
	defaultFilename := fmt.Sprintf("screenshot_%s.png", timestamp)

	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	desktopDir := filepath.Join(homeDir, "Desktop")

	// 确保桌面目录存在，如果不存在则使用主目录
	if _, err := os.Stat(desktopDir); os.IsNotExist(err) {
		desktopDir = homeDir
	}

	savePath, err := runtime.SaveFileDialog(param.Ctxt, runtime.SaveDialogOptions{
		DefaultDirectory: desktopDir,
		DefaultFilename:  defaultFilename,
		Title:            "保存截图",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PNG 图片 (*.png)",
				Pattern:     "*.png",
			},
			{
				DisplayName: "所有文件 (*.*)",
				Pattern:     "*.*",
			},
		},
	})

	if err != nil {
		return types.NewExecResultErrorString("screenshot", fmt.Sprintf("保存对话框错误: %v", err))
	}

	if savePath == "" {
		return types.NewExecResultErrorString("", "用户取消保存")
	}

	// 2. 执行截图命令
	// 方案：先保存到设备，再拉取（最稳定）
	devicePath := "/sdcard/screenshot_temp.png"

	// 步骤1: 截图到设备
	cmdScreencap := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("screencap -p %s", devicePath))
	res, err := util.Exec(cmdScreencap, false, nil)
	if err != nil {
		return types.NewExecResultErrorString(cmdScreencap, fmt.Sprintf("截图失败: %v, 输出: %s", err, res))
	}

	// 步骤2: 拉取到本地
	cmdPull := BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pull %s \"%s\"", devicePath, savePath))
	res, err = util.Exec(cmdPull, false, nil)
	if err != nil {
		return types.NewExecResultErrorString(cmdPull, fmt.Sprintf("拉取文件失败: %v, 输出: %s", err, res))
	}

	// 步骤3: 清理设备临时文件
	cmdRm := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("rm %s", devicePath))
	_, _ = util.Exec(cmdRm, false, nil) // 忽略删除错误

	finalCmd := cmdScreencap + "\n" + cmdPull + "\n" + cmdRm

	// 步骤4: 验证文件是否存在
	if _, err := os.Stat(savePath); os.IsNotExist(err) {
		return types.NewExecResultErrorString(finalCmd, "截图保存失败，文件不存在")
	}

	return types.NewExecResultSuccess(finalCmd, fmt.Sprintf("截图已保存到: %s", savePath))
}

func GetDeviceInfo(param ExecuteParams) types.ExecResult {
	// 定义所有命令
	commands := []string{
		"getprop ro.product.model",
		"getprop ro.build.version.release",
		"wm density",
		"dumpsys window displays",
		"getprop ro.build.version.ota",
		"getprop ro.build.version.sdk",
		"getprop ro.build.version.codename",
		"getprop ro.product.brand",
		"getprop ro.product.cpu.abi",
		"getprop ro.product.board",
		"cat /proc/stat",
		"settings get system font_scale",
		"settings get global device_name",
		"cat /proc/meminfo",
		"dumpsys diskstats",
		"dumpsys wifi",
		"ip addr show wlan0",
	}

	// 构建所有命令字符串
	var cmdStrs []string
	for _, cmd := range commands {
		cmdStrs = append(cmdStrs, BuildAdbShellCmd(param.AdbPath, param.DeviceId, cmd))
	}
	allCmds := strings.Join(cmdStrs, "\n")

	// 并发执行所有 ADB 命令
	results := make([]string, len(cmdStrs))
	var wg sync.WaitGroup
	wg.Add(len(cmdStrs))

	for i, cmd := range cmdStrs {
		go func(idx int, c string) {
			defer wg.Done()
			out, _ := util.Exec(c, false, nil)
			results[idx] = out
		}(i, cmd)
	}
	wg.Wait()

	// 提取结果
	model := strings.TrimSpace(results[0])
	version := strings.TrimSpace(results[1])
	density := strings.TrimSpace(results[2])
	display := results[3]
	otaVersion := strings.TrimSpace(results[4])
	sdkVersion := strings.TrimSpace(results[5])
	codeName := strings.ToUpper(strings.TrimSpace(results[6]))
	brand := strings.TrimSpace(results[7])
	abi := strings.ToUpper(strings.TrimSpace(results[8]))
	cpuModel := strings.ToUpper(strings.TrimSpace(results[9]))
	cpuInfo := strings.TrimSpace(results[10])
	fontScale := strings.TrimSpace(results[11])
	deviceName := strings.TrimSpace(results[12])
	memInfo := strings.TrimSpace(results[13])
	diskInfo := strings.TrimSpace(results[14])
	wifiInfo := strings.TrimSpace(results[15])
	ipInfo := strings.TrimSpace(results[16])

	if codeName == "REL" {
		codeName = ""
	}

	// 解析显示信息
	displayLines := util.MultiLine(display)
	var displayRes string
	for _, line := range displayLines {
		if strings.Contains(line, "init=") {
			displayRes = strings.TrimSpace(line)
			if idx := strings.Index(displayRes, "rng"); idx != -1 {
				displayRes = displayRes[:idx]
			}
			break
		}
	}

	re := regexp.MustCompile(`init=(\d+x\d+)`)
	match := re.FindStringSubmatch(displayRes)

	if len(match) > 1 {
		displayRes = match[1]
	}

	// 解析密度
	var densityRes string
	var densityScale float64

	if !strings.Contains(density, "Override density") {
		idx := strings.Index(density, ":")
		if idx != -1 {
			densityRes = strings.TrimSpace(density[idx+1:])
			if d, err := strconv.ParseFloat(densityRes, 64); err == nil {
				densityScale = d / 160
			}
		}
	} else {
		lines := util.MultiLine(density)
		if len(lines) >= 2 {
			idx := strings.Index(lines[0], ":")
			if idx != -1 {
				densityRes = strings.TrimSpace(lines[0][idx+1:])
			}

			idx = strings.Index(lines[1], ":")
			if idx != -1 {
				overrideDensity := strings.TrimSpace(lines[1][idx+1:])
				if d, err := strconv.ParseFloat(overrideDensity, 64); err == nil {
					densityScale = d / 160
				}
				densityRes = overrideDensity // 直接赋值
			}
		}
	}

	// 获取版本构建信息
	versionBuild := util.GetVersionBuild(sdkVersion)
	if versionBuild == "" {
		versionBuild = fmt.Sprintf("Android %s", version)
	}

	cpuCount := getFormatCpuCount(cpuInfo)
	totalMem := getFormatTotalMemInfo(memInfo)
	disk := getFormatDiskSize(diskInfo)
	wifiName := getFormatWIFIInfo(wifiInfo)
	ipAddress := getFormatIPAdress(ipInfo)

	// 格式化结果
	result := fmt.Sprintf(`
名称: %s
品牌: %s
产品型号: %s
安卓版本: %s %s
屏幕尺寸: %s
屏幕像素密度: %sdpi
密度: %.2f
CPU 架构: %s
CPU 型号: %s、%d 核
内存: %s
存储: %s
字体缩放：%sx
WIFI 名称：%s
IP 地址：%s
OTA 版本号: %s
`,
		deviceName,
		brand,
		model,
		versionBuild,
		codeName,
		displayRes,
		densityRes,
		densityScale,
		abi,
		cpuModel,
		cpuCount,
		totalMem,
		disk,
		fontScale,
		wifiName,
		ipAddress,
		otaVersion,
	)

	return types.NewExecResultSuccess(allCmds, result)
}

func getFormatCpuCount(msg string) int {
	var cpuCount = 0
	if len(msg) > 0 {
		scanner := bufio.NewScanner(strings.NewReader(msg))
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "cpu") {
				fields := strings.Fields(line)
				if len(fields) > 0 && fields[0] == "cpu" {
					continue
				} else if len(fields) > 0 {
					cpuCount++
				}
			}
		}
	}
	return cpuCount
}

func ExtractIPAddress(output string) string {
	re := regexp.MustCompile(`inet (\d+\.\d+\.\d+\.\d+)`)
	match := re.FindStringSubmatch(output)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func getFormatTotalMemInfo(msg string) string {
	var res = "0"
	scanner := bufio.NewScanner(strings.NewReader(msg))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal") {
			split := strings.Split(line, ":")
			if len(split) > 1 {
				kbStr := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(split[1]), "kB"))
				kb, err := strconv.ParseFloat(kbStr, 64)
				if err == nil {
					gb := kb / 1024 / 1024
					res = fmt.Sprintf("%.2f G", gb)
				}
			}
		}
	}
	return res
}

func getFormatDiskSize(msg string) string {
	var total = 0
	var free = 0
	var parseInt = 0
	scanner := bufio.NewScanner(strings.NewReader(msg))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Data-Free") {
			re := regexp.MustCompile(`Data-Free:\s*(\d+)K`)
			matches := re.FindStringSubmatch(line)
			if len(matches) > 1 {
				free, _ = strconv.Atoi(matches[1])
			}
		} else if strings.HasPrefix(line, "System Size") {
			split := strings.Split(line, ":")
			if len(split) == 2 {
				parseInt, _ = strconv.Atoi(strings.TrimSpace(split[1]))
				total = parseInt / (1000 * 1000 * 1000)
			}
		}
	}
	used := float64(parseInt/1000-free) / (1024 * 1024)
	return fmt.Sprintf("%.2f/%dG", used, total)
}

func getFormatWIFIInfo(msg string) string {
	scanner := bufio.NewScanner(strings.NewReader(msg))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "mWifiInfo") {
			return strings.TrimSpace(ExtractWiFiName(line))
		}
	}
	return ""
}

func getFormatIPAdress(msg string) string {
	scanner := bufio.NewScanner(strings.NewReader(msg))
	for scanner.Scan() {
		line := scanner.Text()
		name := strings.TrimSpace(ExtractIPAddress(line))
		if name != "" {
			return name
		}
	}
	return ""
}

func ExtractWiFiName(dumpsysOutput string) string {
	re := regexp.MustCompile(`mWifiInfo\s+SSID: "?(.+?)"?,`)
	match := re.FindStringSubmatch(dumpsysOutput)
	if len(match) < 2 {
		return ""
	}

	ssid := match[1]
	if ssid == "<unknown ssid>" {
		return ""
	}

	return ssid
}

// MemInfo 内存信息结构体（带时间戳）
type MemInfo struct {
	Timestamp    int64  `json:"timestamp"`
	JavaHeap     int64  `json:"javaHeap"`
	NativeHeap   int64  `json:"nativeHeap"`
	Code         int64  `json:"code"`
	Stack        int64  `json:"stack"`
	Graphics     int64  `json:"graphics"`
	PrivateOther int64  `json:"privateOther"`
	System       int64  `json:"system"`
	Unknown      int64  `json:"unknown"`
	TotalPSS     int64  `json:"totalPss"`
	RawMemInfo   string `json:"rawMemInfo"`
}

func FormatSysMemInfo(param ExecuteParams) types.ExecResult {
	result := DumpSysMemInfo(param)
	if result.Error != "" || result.Res == "" {
		return result
	}

	memInfo := parseMemInfo(result.Res)
	memInfo.Timestamp = time.Now().UnixMilli() // 添加毫秒级时间戳
	memInfo.RawMemInfo = result.Res

	jsonBytes, err := json.Marshal(memInfo)
	if err != nil {
		return types.NewExecResultError(result.Cmd, err)
	}
	return types.NewExecResultSuccess(result.Cmd, string(jsonBytes))
}

// parseMemInfo 解析 dumpsys meminfo 输出
func parseMemInfo(output string) MemInfo {
	memInfo := MemInfo{}
	lines := strings.Split(output, "\n")

	// 用于匹配 App Summary 部分的数据
	// 格式示例:
	//  App Summary
	//                        Pss(KB)                        Rss(KB)
	//                         ------                         ------
	//            Java Heap:    12345                          23456
	//          Native Heap:    23456                          34567
	//                 Code:     3456                           4567
	//                Stack:      234                            345
	//             Graphics:    45678                          56789
	//        Private Other:     1234                           2345
	//               System:     2345
	//              Unknown:      567
	//
	//            TOTAL PSS:    89012                         123456

	inAppSummary := false

	for _, line := range lines {
		trimmedLine := strings.TrimSpace(line)

		// 检测进入 App Summary 部分
		if strings.Contains(trimmedLine, "App Summary") {
			inAppSummary = true
			continue
		}

		// 如果遇到空行或其他部分，且已经在 App Summary 中，检查是否结束
		if inAppSummary {
			// 解析各个内存区域
			if strings.HasPrefix(trimmedLine, "Java Heap:") {
				memInfo.JavaHeap = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Native Heap:") {
				memInfo.NativeHeap = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Code:") {
				memInfo.Code = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Stack:") {
				memInfo.Stack = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Graphics:") {
				memInfo.Graphics = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Private Other:") {
				memInfo.PrivateOther = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "System:") {
				memInfo.System = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "Unknown:") {
				memInfo.Unknown = extractFirstNumber(trimmedLine)
			} else if strings.HasPrefix(trimmedLine, "TOTAL PSS:") {
				memInfo.TotalPSS = extractFirstNumber(trimmedLine)
				// TOTAL PSS 是最后一项，解析完成后退出
				break
			}
		}
	}

	return memInfo
}

// extractFirstNumber 从字符串中提取第一个数字
func extractFirstNumber(line string) int64 {
	// 使用正则匹配第一个数字（可能带逗号的数字格式）
	re := regexp.MustCompile(`:\s*([\d,]+)`)
	matches := re.FindStringSubmatch(line)
	if len(matches) >= 2 {
		// 移除逗号
		numStr := strings.ReplaceAll(matches[1], ",", "")
		num, err := strconv.ParseInt(numStr, 10, 64)
		if err != nil {
			return 0
		}
		return num
	}
	return 0
}

func DumpSysMemInfo(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys meminfo %s", param.PackageName))
	return execCmd(cmd)
}

func dumpSmaps(param ExecuteParams) types.ExecResult {
	result := PackagePid(param)
	if result.Error != "" {
		return result
	}

	smapsCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("run-as %s cat /proc/%s/smaps ", param.PackageName, result.Res))
	if isRoot(param) {
		smapsCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("cat /proc/%s/smaps ", result.Res))
	}

	finalResult := execCmd(smapsCmd)
	finalResult.Cmd = result.Cmd + "\n" + smapsCmd
	return finalResult
}

func dumpShowMap(param ExecuteParams) types.ExecResult {
	result := PackagePid(param)
	if result.Error != "" {
		return result
	}

	showMapCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("run-as %s showmap %s ", param.PackageName, result.Res))
	if isRoot(param) {
		showMapCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("showmap %s", result.Res))
	}

	finalResult := execCmd(showMapCmd)
	finalResult.Cmd = result.Cmd + "\n" + showMapCmd
	return finalResult
}

func isRoot(param ExecuteParams) bool {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "whoami")
	result := execCmd(cmd)
	if result.Error == "" && strings.TrimSpace(result.Res) == "root" {
		return true
	}
	return false
}

// SaveFileOptions 保存文件的选项
type SaveFileOptions struct {
	Ctxt          context.Context
	FilePrefix    string // 文件名前缀，如 "smaps", "debuggerd"
	DialogTitle   string // 对话框标题
	FileExtension string // 文件扩展名，如 ".txt"
	FilterDisplay string // 过滤器显示名，如 "文本文件 (*.txt)"
	FilterPattern string // 过滤器模式，如 "*.txt"
}

// SaveFileResult 保存文件的中间结果
type SaveFileResult struct {
	SavePath string
	Canceled bool
	Error    types.ExecResult
}

// PrepareFileSave 准备文件保存，返回用户选择的保存路径
func PrepareFileSave(opts SaveFileOptions) SaveFileResult {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	desktopDir := filepath.Join(homeDir, "Desktop")

	// 确保桌面目录存在，如果不存在则使用主目录
	if _, err := os.Stat(desktopDir); os.IsNotExist(err) {
		desktopDir = homeDir
	}

	timestamp := time.Now().Format("2006_01_02_15_04_05")
	saveFileName := fmt.Sprintf("%s_%s%s", timestamp, opts.FilePrefix, opts.FileExtension)

	savePath, _ := runtime.SaveFileDialog(opts.Ctxt, runtime.SaveDialogOptions{
		DefaultDirectory: desktopDir,
		DefaultFilename:  saveFileName,
		Title:            opts.DialogTitle,
		Filters: []runtime.FileFilter{
			{DisplayName: opts.FilterDisplay, Pattern: opts.FilterPattern},
		},
	})

	if savePath == "" {
		return SaveFileResult{Canceled: true}
	}

	return SaveFileResult{SavePath: savePath}
}

// writeResultToFile 将执行结果写入文件
func writeResultToFile(savePath string, content string, cmd string) types.ExecResult {
	err := os.WriteFile(savePath, []byte(content), 0644)
	if err != nil {
		return types.NewExecResultError(cmd, err)
	}
	return types.NewExecResultSuccess(cmd, "success")
}

// SaveSmaps 保存 smaps 信息
func SaveSmaps(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		FilePrefix:    "smaps",
		DialogTitle:   "保存 smaps",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultErrorString("", "用户取消保存")
	}

	result := dumpSmaps(param)
	if result.Error != "" {
		return result
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 smaps\n"+result.Res, result.Error)
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

func SaveShowMap(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		FilePrefix:    "show_map",
		DialogTitle:   "保存 show_map",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultErrorString("", "用户取消保存")
	}

	result := dumpShowMap(param)
	if result.Error != "" {
		return result
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 showmap\n"+result.Res, result.Error)
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

func SaveThreadInfo(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	if !isRoot(param) {
		return types.NewExecResultErrorString(packageIdResult.Cmd, "应用不是 root，无法导出线程信息")
	}

	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          param.Ctxt,
		FilePrefix:    "thread_info",
		DialogTitle:   "保存 thread",
		FileExtension: ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	})

	if saveResult.Canceled {
		return types.NewExecResultErrorString("", "用户取消保存")
	}

	result := doSaveThreadInfo(param)
	if result.Error != "" {
		return result
	}

	return writeResultToFile(saveResult.SavePath, result.Res, result.Cmd)
}

type SaveFileConfig struct {
	Extension     string // ".txt", ".csv", ".json" 等
	FilterDisplay string // "CSV 文件 (*.csv)"
	FilterPattern string // "*.csv"
}

// 预定义配置
var (
	SaveConfigTxt = SaveFileConfig{
		Extension:     ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	}
	SaveConfigCsv = SaveFileConfig{
		Extension:     ".csv",
		FilterDisplay: "CSV 文件 (*.csv)",
		FilterPattern: "*.csv",
	}
	SaveConfigJson = SaveFileConfig{
		Extension:     ".json",
		FilterDisplay: "JSON 文件 (*.json)",
		FilterPattern: "*.json",
	}
)

func SaveFile(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string) types.ExecResult {
	return saveFileAs(Ctxt, content, fileNamePrefix, dialogTitle, SaveConfigTxt)
}

func SaveFileAsCSV(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string) types.ExecResult {
	return saveFileAs(Ctxt, content, fileNamePrefix, dialogTitle, SaveConfigCsv)
}

func saveFileAs(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string, config SaveFileConfig) types.ExecResult {
	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          Ctxt,
		FilePrefix:    fileNamePrefix,
		DialogTitle:   dialogTitle,
		FileExtension: config.Extension,
		FilterDisplay: config.FilterDisplay,
		FilterPattern: config.FilterPattern,
	})

	if saveResult.Canceled {
		return types.NewExecResultErrorString("", "用户取消保存")
	}
	return writeResultToFile(saveResult.SavePath, content, "")
}

func doSaveThreadInfo(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	if isRoot(param) {
		cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("debuggerd -b %s", packageIdResult.Res))
		return execCmd(cmd)
	}
	return types.NewExecResultErrorString(packageIdResult.Cmd, "应用不是 debuggable，无法导出 hprof")
}

func SaveHprof(param ExecuteParams) types.ExecResult {
	packageIdResult := PackagePid(param)
	if packageIdResult.Error != "" {
		return packageIdResult
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	desktopDir := filepath.Join(homeDir, "Desktop")

	// 确保桌面目录存在，如果不存在则使用主目录
	if _, err := os.Stat(desktopDir); os.IsNotExist(err) {
		desktopDir = homeDir
	}
	timestamp := time.Now().Format("2006_01_02_15_04_05")
	saveFileName := fmt.Sprintf("%s", timestamp)
	savePath, err := runtime.SaveFileDialog(param.Ctxt, runtime.SaveDialogOptions{
		DefaultDirectory: desktopDir,
		DefaultFilename:  saveFileName,
		Title:            "保存 hprof",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本文件 (*.hprof)", Pattern: "*.hprof"},
		},
	})

	hprofSdcardPath := fmt.Sprintf("/data/local/tmp/%s.hprof", saveFileName)
	result := execCmd(BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("am dumpheap %s %s ", param.PackageName, hprofSdcardPath)))
	if result.Error != "" {
		return result
	}

	if savePath == "" {
		return types.NewExecResultErrorString(result.Cmd, "用户取消保存")
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 hprof"+"\n"+result.Res, result.Error)
	}

	pullCmd := fmt.Sprintf("pull %s  %s ", hprofSdcardPath, savePath)
	pullResult := execCmd(BuildAdbCmd(param.AdbPath, param.DeviceId, pullCmd))
	if pullResult.Error != "" {
		return pullResult
	}
	finalCmd := result.Cmd + "\n" + pullResult.Cmd

	rmResult := execCmd(BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("rm %s  ", hprofSdcardPath)))
	finalCmd = finalCmd + "\n" + rmResult.Cmd

	return types.NewExecResultSuccess(finalCmd, "success")
}

func PackagePid(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pidof %s", param.PackageName))
	result := execCmd(cmd)
	if result.Error == "" && result.Res == "" {
		result.Error = "pid is null，请检测应用是否运行。"
	}
	result.Res = strings.TrimSpace(result.Res)
	return result
}

// JumpToSettings 跳转到指定设置页面
func JumpToSettings(param ExecuteParams) types.ExecResult {
	var intent string

	switch param.Action {
	case "jump-locale":
		intent = "android.settings.LOCALE_SETTINGS"
	case "jump-developer":
		intent = "android.settings.APPLICATION_DEVELOPMENT_SETTINGS"
	case "jump-application":
		intent = "android.settings.APPLICATION_SETTINGS"
	case "jump-notification":
		intent = "android.settings.NOTIFICATION_SETTINGS"
	case "jump-bluetooth":
		intent = "android.settings.BLUETOOTH_SETTINGS"
	case "jump-input":
		intent = "android.settings.INPUT_METHOD_SETTINGS"
	case "jump-display":
		intent = "android.settings.DISPLAY_SETTINGS"
	case "jump-wifi-settings":
		intent = "android.settings.WIFI_SETTINGS"
	default:
		return types.NewExecResultErrorString(param.Action, "未知的跳转操作")
	}

	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("am start -a %s", intent))
	res, err := util.Exec(cmd, false, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, res, err)
	}

	return types.NewExecResultSuccess(cmd, res)
}

// 跳转到 App 详情页
func JumpToAppDetailSettings(param ExecuteParams) types.ExecResult {
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:%s", param.PackageName))
	return execCmd(cmd)
}

func ToggleGPUProfile(param ExecuteParams) types.ExecResult {
	// 获取当前状态
	getCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "getprop debug.hwui.profile")
	result := execCmd(getCmd)
	if result.Error != "" {
		return result
	}

	// 根据当前状态切换
	var setCmd string
	if strings.TrimSpace(result.Res) == "visual_bars" {
		// 当前是开启状态，关闭它
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.hwui.profile false")
	} else {
		// 当前是关闭状态，开启它
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.hwui.profile visual_bars")
	}

	// 刷新界面
	refreshCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "service call activity 1599295570")

	return execCmds(setCmd, refreshCmd)
}

func ToggleGPUOverdraw(param ExecuteParams) types.ExecResult {
	getCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "getprop debug.hwui.overdraw")
	result := execCmd(getCmd)
	if result.Error != "" {
		return result
	}

	var setCmd string
	if strings.TrimSpace(result.Res) == "show" {
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.hwui.overdraw false")
	} else {
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.hwui.overdraw show")
	}

	refreshCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "service call activity 1599295570")
	return execCmds(setCmd, refreshCmd)
}

func ToggleLayoutBounds(param ExecuteParams) types.ExecResult {
	getCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "getprop debug.layout")
	result := execCmd(getCmd)
	if result.Error != "" {
		return result
	}

	var setCmd string
	if strings.TrimSpace(result.Res) == "true" {
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.layout false")
	} else {
		setCmd = BuildAdbShellCmd(param.AdbPath, param.DeviceId, "setprop debug.layout true")
	}

	refreshCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, "service call activity 1599295570")
	return execCmds(setCmd, refreshCmd)
}

func execCmd(cmd string) types.ExecResult {
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}

func execCmds(cmds ...string) types.ExecResult {
	var allCmds []string
	for _, cmd := range cmds {
		result := execCmd(cmd)
		allCmds = append(allCmds, cmd)
		if result.Error != "" {
			return types.NewExecResultFromError(strings.Join(allCmds, "\n"), result.Res, fmt.Errorf(result.Error))
		}
	}
	finalCmd := strings.Join(allCmds, "\n")
	return types.NewExecResultSuccess(finalCmd, "success")
}
