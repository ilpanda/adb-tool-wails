package adb

import (
	"adb-tool-wails/types"
	"adb-tool-wails/util"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type ExecuteParams struct {
	PackageName string
	Ctxt        context.Context
	DeviceId    string
}

// ✅ 新增：构建 adb 命令的辅助函数
func buildAdbCmd(deviceId string, shellCmd string) string {
	if deviceId != "" {
		return fmt.Sprintf("adb -s %s %s", deviceId, shellCmd)
	}
	return fmt.Sprintf("adb %s", shellCmd)
}

// ✅ 新增：构建 adb shell 命令的辅助函数
func buildAdbShellCmd(deviceId string, shellCmd string) string {
	if deviceId != "" {
		return fmt.Sprintf("adb -s %s shell %s", deviceId, shellCmd)
	}
	return fmt.Sprintf("adb shell %s", shellCmd)
}

// ✅ 修改：接受 ExecuteParams 参数
func GetCurrentPackageAndActivityName(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, "dumpsys activity activities | grep mResumedActivity | awk '{print $4}'")
	result, err := util.Exec(cmd, true, nil)

	if err != nil || strings.TrimSpace(result) == "" {
		cmd = buildAdbShellCmd(param.DeviceId, "dumpsys activity activities | grep ResumedActivity | grep -v top | awk '{print $4}'")
		result, err = util.Exec(cmd, true, nil)
		if err != nil {
			return types.NewExecResultFromError(cmd, "", err)
		}
		return types.NewExecResultSuccess(cmd, strings.TrimSuffix(result, "}\n"))
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSuffix(result, "}\n"))
}

func GetAllActivity(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, "dumpsys activity activities | grep -e 'Hist #' -e '* Hist'")
	return execCmd(cmd)
}

func GetAllFragment(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("dumpsys activity %s | grep -E '^\\s*#\\d' | grep -v -E 'ReportFragment|plan'", param.PackageName))
	return execCmd(cmd)
}

func KillApp(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("am force-stop %s", param.PackageName))
	return execCmd(cmd)
}

func ClearApp(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("pm clear %s", param.PackageName))
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
	dumpCmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
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
		displayCmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("pm grant %s %s", param.PackageName, perm))
		grantCmdsForDisplay = append(grantCmdsForDisplay, displayCmd)
	}

	batchCmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("'%s'", strings.Join(grantCmdsForExec, " ; ")))
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
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
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
				revokeCmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("pm revoke %s %s", param.PackageName, permission))
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
		return types.NewExecResultErrorString(resCmd, killAppRes.Error)
	}
	startAppRes := StartActivity(param)
	resCmd = resCmd + "\n" + startAppRes.Cmd
	if startAppRes.Error != "" {
		return types.NewExecResultErrorString(resCmd, startAppRes.Error)
	}
	return types.NewExecResultSuccess(resCmd, "")
}

func StartActivity(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", param.PackageName))
	return execCmd(cmd)
}

func Shutdown(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, "reboot -p")
	return execCmd(cmd)
}

func GetAppInstallPath(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
	return execCmd(cmd)
}

func ExportAppPackagePath(param ExecuteParams) types.ExecResult {
	pathCmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
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
	cmd := buildAdbCmd(param.DeviceId, fmt.Sprintf("pull %s %s", path, targetApkName))

	finalRes = finalRes + "\n" + cmd
	return execCmd(finalRes)
}

func GetDeviceNameArray() []string {
	devicesRes := Devices(ExecuteParams{})
	var devices []string
	if devicesRes.Error == "" {
		devices = GetDevices(devicesRes.Res, devices)
	}
	return devices
}

func GetDeviceNameByDeviceId(deviceId string) string {
	cmd := buildAdbShellCmd(deviceId, "getprop ro.product.model")
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

func Devices(param ExecuteParams) types.ExecResult {
	// devices 命令不需要指定设备
	cmd := "adb devices"
	return execCmd(cmd)
}

func Reboot(param ExecuteParams) types.ExecResult {
	cmd := buildAdbCmd(param.DeviceId, "reboot")
	return execCmd(cmd)
}

func KeyHome(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_HOME")
	return execCmd(cmd)
}

func KeyBack(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_BACK")
	return execCmd(cmd)
}

func KeyPower(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_POWER")
	return execCmd(cmd)
}

func KeyAppSwitch(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_APP_SWITCH")
	return execCmd(cmd)
}

func KeyMenu(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_MENU")
	return execCmd(cmd)
}

func KeyVolumeUP(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_VOLUME_UP")
	return execCmd(cmd)
}

func KeyVolumeDown(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_VOLUME_DOWN")
	return execCmd(cmd)
}

func KeyVolumeMute(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_VOLUME_MUTE")
	return execCmd(cmd)
}

func KeyDpadUp(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_DPAD_UP")
	return execCmd(cmd)
}

func KeyDpadDown(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_DPAD_DWON")
	return execCmd(cmd)
}

func KeyDpadLeft(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_DPAD_LEFT")
	return execCmd(cmd)
}

func KeyDpadRight(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_DPAD_RIGHT")
	return execCmd(cmd)
}

func KeyScreenWakeUp(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_WAKE_UP")
	return execCmd(cmd)
}

func KeyScreenSleep(param ExecuteParams) types.ExecResult {
	cmd := getKey(param.DeviceId, "KEYCODE_SLEEP")
	return execCmd(cmd)
}

func getKey(deviceId string, key string) string {
	return buildAdbShellCmd(deviceId, fmt.Sprintf("input keyevent %s", key))
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
	cmd := buildAdbShellCmd(param.DeviceId, "pm list packages -3")
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
	cmd := buildAdbShellCmd(param.DeviceId, "getprop")
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

	cmd := buildAdbCmd(param.DeviceId, fmt.Sprintf("install -d %s", filePath))
	res := execCmd(cmd)

	return res
}

func UninstallApp(param ExecuteParams) types.ExecResult {
	cmd := buildAdbShellCmd(param.DeviceId, fmt.Sprintf("uninstall %s", param.PackageName))
	return execCmd(cmd)
}

func Screenshot(param ExecuteParams) types.ExecResult {
	timestamp := time.Now().Format("2006_01_02_15_04_05")
	defaultFilename := fmt.Sprintf("screenshot_%s.png", timestamp)

	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = ""
	}
	desktopDir := filepath.Join(homeDir, "Desktop")

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
		return types.NewExecResultError("screenshot", err)
	}

	if savePath == "" {
		return types.NewExecResultErrorString("screenshot", "用户取消保存")
	}

	// ✅ 修改：支持指定设备的截图
	var cmd *exec.Cmd
	if param.DeviceId != "" {
		cmd = exec.Command("adb", "-s", param.DeviceId, "exec-out", "screencap", "-p")
	} else {
		cmd = exec.Command("adb", "exec-out", "screencap", "-p")
	}

	output, err := cmd.Output()
	if err != nil {
		return types.NewExecResultError("screenshot", err)
	}

	err = os.WriteFile(savePath, output, 0644)
	if err != nil {
		return types.NewExecResultError("screenshot", err)
	}

	return types.NewExecResultSuccess("screenshot", fmt.Sprintf("截图已保存到: %s", savePath))
}

func execCmd(cmd string) types.ExecResult {
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, res)
}
