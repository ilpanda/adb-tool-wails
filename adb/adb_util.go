package adb

import (
	"adb-tool-wails/types"
	"adb-tool-wails/util"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
		if line == "" || strings.Contains(line, "List of devices") {
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

	cmd := BuildAdbCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("install -d %s", filePath))
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
		"settings get secure android_id",
		"getprop ro.build.version.sdk",
		"ifconfig | grep Mask",
		`service call iphonesubinfo 1 s16 com.android.shell | cut -c 52-66 | tr -d '.[:space:]'`,
		"getprop ro.build.version.codename",
		"getprop ro.product.brand",
	}

	// 构建所有命令字符串（用于日志）
	var cmdStrs []string
	for _, cmd := range commands {
		cmdStrs = append(cmdStrs, BuildAdbShellCmd(param.AdbPath, param.DeviceId, cmd))
	}
	allCmds := strings.Join(cmdStrs, "\n")

	// 执行所有 ADB 命令
	model, _ := util.Exec(cmdStrs[0], false, nil)
	version, _ := util.Exec(cmdStrs[1], false, nil)
	density, _ := util.Exec(cmdStrs[2], false, nil)
	display, _ := util.Exec(cmdStrs[3], false, nil)
	androidID, _ := util.Exec(cmdStrs[4], false, nil)
	sdkVersion, _ := util.Exec(cmdStrs[5], false, nil)
	ipAddress, _ := util.Exec(cmdStrs[6], true, nil)
	imei, _ := util.Exec(cmdStrs[7], false, nil)
	codeName, _ := util.Exec(cmdStrs[8], false, nil)
	brand, _ := util.Exec(cmdStrs[9], false, nil)

	model = strings.TrimSpace(model)
	version = strings.TrimSpace(version)
	density = strings.TrimSpace(density)
	androidID = strings.TrimSpace(androidID)
	sdkVersion = strings.TrimSpace(sdkVersion)
	imei = strings.TrimSpace(imei)
	brand = strings.TrimSpace(brand)
	codeName = strings.ToUpper(strings.TrimSpace(codeName))

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

	// 解析 IP 地址
	ipAddressRes := ""
	permissionDeny := strings.Contains(ipAddress, "Permission denied")
	if !permissionDeny {
		ipAddressRes = fmt.Sprintf("ipAddress: %s", strings.TrimSpace(strings.ReplaceAll(ipAddress, "\n", "")))
	}

	// 解析密度
	var densityRes string
	var densityScale float64
	var overrideRes string

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
				overrideRes = fmt.Sprintf("Override density: %sdpi", overrideDensity)
			}
		}
	}

	// 获取版本构建信息
	versionBuild := util.GetVersionBuild(sdkVersion)
	if versionBuild == "" {
		versionBuild = fmt.Sprintf("Android %s", version)
	}

	// 格式化结果
	result := fmt.Sprintf(`brand: %s
model: %s
imei: %s
version: %s %s
display: %s
Physical density: %sdpi  %s
density scale: %.2f
android_id: %s
%s`,
		brand,
		model,
		imei,
		versionBuild,
		codeName,
		displayRes,
		densityRes,
		overrideRes,
		densityScale,
		androidID,
		ipAddressRes,
	)

	return types.NewExecResultSuccess(allCmds, result)
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
	packageName := param.PackageName
	cmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pidof %s", packageName))
	finalCmd := cmd
	pid, err := util.Exec(cmd, false, nil)
	if err != nil {
		return types.NewExecResultError(cmd, err)
	}

	if pid == "" {
		return types.NewExecResultErrorString(cmd, fmt.Sprintf("%s process not found", packageName))
	}

	smapsCmd := BuildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("run-as %s cat /proc/%s/smaps ", packageName, strings.TrimSpace(pid)))
	result := execCmd(smapsCmd)
	result.Cmd = finalCmd + "\n" + smapsCmd
	return result
}

func SaveSmaps(param ExecuteParams) types.ExecResult {

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
	saveFileName := fmt.Sprintf("%s_smaps.txt", timestamp)
	savePath, err := runtime.SaveFileDialog(param.Ctxt, runtime.SaveDialogOptions{
		DefaultDirectory: desktopDir,
		DefaultFilename:  saveFileName,
		Title:            "保存 smaps",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本文件 (*.txt)", Pattern: "*.txt"},
		},
	})

	result := dumpSmaps(param)
	if result.Error != "" {
		return result
	}

	if savePath == "" {
		return types.NewExecResultErrorString(result.Cmd, "用户取消保存")
	}

	if strings.Contains(result.Res, "not debuggable") {
		return types.NewExecResultFromString(result.Cmd, "应用不是 debuggable，无法导出 smaps"+"\n"+result.Res, result.Error)
	}

	saveError := os.WriteFile(savePath, []byte(result.Res), 0644)
	if saveError != nil {
		return types.NewExecResultError(result.Cmd, saveError)
	}
	return types.NewExecResultSuccess(result.Cmd, "success")
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

func execCmd(cmd string) types.ExecResult {
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}
