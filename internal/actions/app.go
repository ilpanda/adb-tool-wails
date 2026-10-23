// Package actions 实现快捷功能：每个函数对应前端的一个操作，结果统一返回 types.ExecResult。
package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 应用相关操作：当前页面、启动 / 结束 / 清除数据、权限、包信息、导出与卸载

var reFragmentRow = regexp.MustCompile(`^\s*#\d+`)

func GetCurrentPackageAndActivityName(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "dumpsys activity activities")
	result, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}

	for _, line := range util.MultiLine(result) {
		if !strings.Contains(line, "mResumedActivity") && !strings.Contains(line, "ResumedActivity") {
			continue
		}
		component := extractActivityComponent(line)
		if component != "" {
			return types.NewExecResultSuccess(cmd, component)
		}
	}

	return types.NewExecResultErrorString(cmd, "not found")
}

func GetCurrentPackageName(param adb.ExecuteParams) types.ExecResult {
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

func GetAllActivity(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "dumpsys activity activities")
	result, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}

	lines := filterActivityHistoryLines(result)
	return types.NewExecResultSuccess(cmd, strings.Join(lines, "\n"))
}

func GetAllFragment(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys activity %s", param.PackageName))
	result, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}

	lines := filterFragmentLines(result)
	return types.NewExecResultSuccess(cmd, strings.Join(lines, "\n"))
}

func extractActivityComponent(line string) string {
	for _, field := range strings.Fields(line) {
		if !strings.Contains(field, "/") {
			continue
		}
		return strings.Trim(field, "{}")
	}
	return ""
}

func filterActivityHistoryLines(content string) []string {
	lines := util.MultiLine(content)
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.Contains(line, "Hist #") || strings.Contains(line, "* Hist") {
			result = append(result, line)
		}
	}
	return result
}

func filterFragmentLines(content string) []string {
	lines := util.MultiLine(content)
	result := make([]string, 0, len(lines))
	for _, line := range lines {
		if !reFragmentRow.MatchString(line) {
			continue
		}
		if strings.Contains(line, "ReportFragment") || strings.Contains(line, "plan") {
			continue
		}
		result = append(result, line)
	}
	return result
}

func KillApp(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("am force-stop %s", param.PackageName))
	return execCmd(cmd)
}

func ClearApp(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pm clear %s", param.PackageName))
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

func GrantAllPermission(param adb.ExecuteParams) types.ExecResult {
	dumpCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
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
		displayCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pm grant %s %s", param.PackageName, perm))
		grantCmdsForDisplay = append(grantCmdsForDisplay, displayCmd)
	}

	batchCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, strings.Join(grantCmdsForExec, " ; "))
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

func RevokePermission(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName))
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
				revokeCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pm revoke %s %s", param.PackageName, permission))
				resCmd = resCmd + "\n" + revokeCmd
				execCmd(revokeCmd)
			}
		}
	}
	return types.NewExecResultSuccess(resCmd, "")
}

func RestartApp(param adb.ExecuteParams) types.ExecResult {
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

func ClearAndRestartApp(param adb.ExecuteParams) types.ExecResult {
	clearAppRes := ClearApp(param)
	resCmd := clearAppRes.Cmd
	if clearAppRes.Error != "" {
		return clearAppRes
	}

	inputMethodCmd := IsInputMethod(param)

	if inputMethodCmd.Res != "" {
		resCmd = resCmd + "\n" + inputMethodCmd.Cmd
		changeInputMethodCmd := execCmd(adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("settings put secure default_input_method %s", inputMethodCmd.Res)))
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

func IsInputMethod(param adb.ExecuteParams) types.ExecResult {
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

func listInputMethodService(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "ime list -s")
	result := execCmd(cmd)
	if result.Res != "" {
		result.Res = strings.TrimSpace(result.Res)
	}
	return result
}

// StartActivity 打开应用的启动页；monkey 的原始输出很长，这里只返回结论
func StartActivity(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("monkey -p %s -c android.intent.category.LAUNCHER 1", param.PackageName))
	result := execCmd(cmd)
	switch {
	case result.Error != "":
		return result
	case strings.Contains(result.Res, "No activities found"):
		result.Error = "该应用没有可启动的页面（没有声明 LAUNCHER Activity）"
	case strings.Contains(result.Res, "Events injected"):
		result.Res = "已启动"
	}
	return result
}

func GetAppInstallPath(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
	return execCmd(cmd)
}

func ExportAppPackagePath(param adb.ExecuteParams) types.ExecResult {
	pathCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName))
	pathResult := execCmd(pathCmd)
	if pathResult.Error != "" {
		return pathResult
	}
	param.Stage(adb.StageDialog)
	dir, err := runtime.OpenDirectoryDialog(param.Ctxt, runtime.OpenDialogOptions{
		Title: "选择导出目录",
	})
	param.Stage(adb.StageRunning)

	if err != nil {
		return types.NewExecResultErrorString(pathCmd, err.Error())
	}

	if dir == "" {
		return types.NewExecResultCanceled(pathCmd, "用户取消选择导出目录")
	}
	// 分包应用会返回多行 package:，基础包在第一行
	path := strings.TrimPrefix(strings.TrimSpace(strings.Split(strings.TrimSpace(pathResult.Res), "\n")[0]), "package:")

	targetApkName := filepath.Join(strings.TrimSpace(dir), param.PackageName+".apk")
	param.Stage(adb.StagePulling)
	// 以参数列表执行，导出目录含空格时也能正确拉取
	result := runAPKCommand(param, "pull", path, targetApkName)
	if result.Error == "" {
		result.LocalPath = targetApkName
		result.Res = fmt.Sprintf("APK 已导出到: %s", targetApkName)
	}
	return result
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

func GetAllPackages(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "pm list packages")
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

func UninstallApp(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("uninstall %s", param.PackageName))
	return execCmd(cmd)
}

func PackagePid(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("pidof %s", param.PackageName))
	result := execCmd(cmd)
	if result.Error == "" && result.Res == "" {
		result.Error = "pid is null，请检测应用是否运行。"
	}
	result.Res = strings.TrimSpace(result.Res)
	return result
}

// 跳转到 App 详情页
func JumpToAppDetailSettings(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:%s", param.PackageName))
	return execCmd(cmd)
}
