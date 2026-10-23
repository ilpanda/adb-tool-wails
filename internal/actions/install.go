package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shogo82148/androidbinary"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const versionDowngradeError = "INSTALL_FAILED_VERSION_DOWNGRADE"

var apkPackagePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$`)

func InstallApp(param adb.ExecuteParams) types.ExecResult {
	param.Stage(adb.StageDialog)
	filePath, err := runtime.OpenFileDialog(param.Ctxt, runtime.OpenDialogOptions{
		Title: "选择 APK 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Android APK (*.apk)", Pattern: "*.apk"},
			{DisplayName: "所有文件 (*.*)", Pattern: "*.*"},
		},
	})
	param.Stage(adb.StageRunning)
	if err != nil {
		return types.NewExecResultError("installApp", err)
	}
	if filePath == "" {
		return types.NewExecResultCanceled("installApp", "用户取消安装")
	}
	return InstallApkFile(param, filePath)
}

// InstallApkFile 安装本地 APK（选择文件或拖入窗口）；版本降级时弹窗确认后卸载重装
func InstallApkFile(param adb.ExecuteParams, filePath string) types.ExecResult {
	if !strings.EqualFold(filepath.Ext(filePath), ".apk") {
		return types.NewExecResultErrorString("installApp", "不是 APK 文件: "+filepath.Base(filePath))
	}

	// 未指定序列号时先固定设备，避免确认期间连接变化后操作其他设备。
	if param.DeviceId == "" {
		device := runAPKCommand(param, "get-serialno")
		if device.Error != "" {
			return device
		}
		param.DeviceId = strings.TrimSpace(device.Res)
		if param.DeviceId == "" || param.DeviceId == "unknown" {
			return types.NewExecResultErrorString(device.Cmd, "无法确定安装设备，请重新连接设备后重试")
		}
	}

	installer := apkInstaller{
		run:         func(args ...string) types.ExecResult { return runAPKCommand(param, args...) },
		readPackage: readAPKPackage,
		confirm: func(packageName string) (bool, error) {
			requestID := uuid.NewString()
			answer := make(chan bool, 1)
			cancel := runtime.EventsOnce(param.Ctxt, "apk-downgrade-response:"+requestID, func(data ...interface{}) {
				confirmed := false
				if len(data) == 1 {
					confirmed, _ = data[0].(bool)
				}
				answer <- confirmed
			})
			defer cancel()
			defer runtime.EventsEmit(param.Ctxt, "apk-downgrade-confirm-closed", requestID)
			// 等待用户确认期间不计入执行耗时
			param.Stage(adb.StageDialog)
			defer param.Stage(adb.StageRunning)
			runtime.EventsEmit(param.Ctxt, "apk-downgrade-confirm", map[string]string{
				"requestId": requestID, "packageName": packageName,
				"fileName": filepath.Base(filePath),
			})
			timer := time.NewTimer(5 * time.Minute)
			defer timer.Stop()
			select {
			case confirmed := <-answer:
				return confirmed, nil
			case <-param.Ctxt.Done():
				return false, param.Ctxt.Err()
			case <-timer.C:
				return false, fmt.Errorf("确认已超时，未执行卸载，请重新安装")
			}
		},
	}
	return installer.install(filePath)
}

type apkInstaller struct {
	run         func(...string) types.ExecResult
	readPackage func(string) (string, error)
	confirm     func(string) (bool, error)
}

func (i apkInstaller) install(filePath string) types.ExecResult {
	result := i.run("install", "-d", "-t", filePath)
	if !strings.Contains(result.Error+"\n"+result.Res, versionDowngradeError) {
		return result
	}
	// 即使 ADB 仅在输出中报告失败，也必须把失败返回给前端。
	if result.Error == "" {
		result.Error = result.Res
	}
	packageName, err := i.readPackage(filePath)
	if err != nil || !apkPackagePattern.MatchString(packageName) {
		result.Error += "\n无法读取 APK 包名，已停止卸载。"
		if err != nil {
			result.Error += " " + err.Error()
		}
		return result
	}
	confirmed, err := i.confirm(packageName)
	if err != nil {
		result.Error += "\n未完成卸载确认：" + err.Error()
		return result
	}
	if !confirmed {
		result.Error += "\n已取消卸载，原应用和数据未更改。"
		return result
	}

	uninstall := i.run("uninstall", packageName)
	commands := result.Cmd + "\n" + uninstall.Cmd
	output := "首次安装：\n" + result.Res + "\n卸载：\n" + uninstall.Res
	if uninstall.Error != "" {
		return types.NewExecResultFromString(commands, output, "卸载失败，已停止安装："+uninstall.Error)
	}

	retry := i.run("install", "-d", "-t", filePath)
	retry.Cmd = commands + "\n" + retry.Cmd
	retry.Res = output + "\n重新安装：\n" + retry.Res
	if retry.Error != "" {
		retry.Error = "原应用已卸载，但重新安装失败：" + retry.Error
	}
	return retry
}

// 使用参数列表执行，避免 APK 路径中的空格或特殊字符被 shell 解释。
// 安装和卸载独立检查退出码与输出，不改变其他快捷操作的执行行为。
func runAPKCommand(param adb.ExecuteParams, args ...string) types.ExecResult {
	if param.DeviceId != "" {
		args = append([]string{"-s", param.DeviceId}, args...)
	}
	parts := append([]string{param.AdbPath}, args...)
	for n, part := range parts {
		parts[n] = strconv.Quote(part)
	}
	command := strings.Join(parts, " ")
	cmd := exec.Command(param.AdbPath, args...)
	util.ConfigureCommand(cmd)
	output, err := cmd.CombinedOutput()
	res := strings.TrimSpace(string(output))
	if err != nil {
		message := res
		if message == "" {
			message = err.Error()
		}
		return types.NewExecResultFromString(command, res, message)
	}
	if strings.Contains(res, "Failure [") || strings.Contains(res, "INSTALL_FAILED_") || strings.HasPrefix(res, "Failure") {
		return types.NewExecResultFromString(command, res, res)
	}
	return types.NewExecResultSuccess(command, res)
}

// readAPKPackage 从所选 APK 读取真实包名，避免误用页面当前选中的包名。
// 使用纯 Go 解析器，使发布后的应用无需额外安装 aapt 或 Android SDK。
func readAPKPackage(filePath string) (string, error) {
	file, err := zip.OpenReader(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()
	manifest, err := file.Open("AndroidManifest.xml")
	if err != nil {
		return "", err
	}
	defer manifest.Close()
	const maxManifestSize = 4 << 20
	data, err := io.ReadAll(io.LimitReader(manifest, maxManifestSize+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxManifestSize {
		return "", fmt.Errorf("AndroidManifest.xml 过大")
	}
	binaryXML, err := androidbinary.NewXMLFile(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	var info struct {
		XMLName xml.Name `xml:"manifest"`
		Package string   `xml:"package,attr"`
	}
	if err := xml.NewDecoder(binaryXML.Reader()).Decode(&info); err != nil {
		return "", err
	}
	return info.Package, nil
}
