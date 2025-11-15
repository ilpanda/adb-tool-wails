package adb

import (
	"adb-tool-wails/types"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type AppDescInfo struct {
	PackageName      string `json:"packageName"`
	PrimaryCpuAbi    string `json:"primaryCpuAbi"`
	VersionName      string `json:"versionName"`
	VersionCode      string `json:"versionCode"`
	MinSdk           string `json:"minSdk"`
	TargetSdk        string `json:"targetSdk"`
	TimeStamp        string `json:"timeStamp"`
	FirstInstallTime string `json:"firstInstallTime"`
	LastUpdateTime   string `json:"lastUpdateTime"`
	SignVersion      string `json:"signVersion"`
	DataDir          string `json:"dataDir"`
	ExternalDataDir  string `json:"externalDataDir"`
	InstallPath      string `json:"installPath"`
	Size             string `json:"size"`
	IsSystem         bool   `json:"isSystem"`
}

func (a *AppDescInfo) String() string {
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("包名: %s\n", a.PackageName))
	builder.WriteString(fmt.Sprintf("CPU架构: %s\n", a.PrimaryCpuAbi))
	builder.WriteString(fmt.Sprintf("版本名称: %s\n", a.VersionName))
	builder.WriteString(fmt.Sprintf("版本号: %s\n", a.VersionCode))
	builder.WriteString(fmt.Sprintf("最小SDK: %s\n", a.MinSdk))
	builder.WriteString(fmt.Sprintf("目标SDK: %s\n", a.TargetSdk))
	builder.WriteString(fmt.Sprintf("时间戳: %s\n", a.TimeStamp))
	builder.WriteString(fmt.Sprintf("首次安装时间: %s\n", a.FirstInstallTime))
	builder.WriteString(fmt.Sprintf("最后更新时间: %s\n", a.LastUpdateTime))
	builder.WriteString(fmt.Sprintf("签名版本: v%s\n", a.SignVersion))
	builder.WriteString(fmt.Sprintf("数据目录: %s\n", a.DataDir))
	builder.WriteString(fmt.Sprintf("外部数据目录: %s\n", a.ExternalDataDir))
	builder.WriteString(fmt.Sprintf("安装路径: %s\n", a.InstallPath))
	builder.WriteString(fmt.Sprintf("应用大小: %s\n", a.Size))
	builder.WriteString(fmt.Sprintf("系统应用: %t\n", a.IsSystem))
	return builder.String()
}

func regexCaptureValue(content, pattern string, groupIndex int) string {
	re := regexp.MustCompile(pattern)
	matches := re.FindStringSubmatch(content)

	if len(matches) > groupIndex {
		return strings.TrimSpace(matches[groupIndex])
	}

	return ""
}

func parseAppDesc(content, packageName, installPath, size string) *AppDescInfo {
	versionName := regexCaptureValue(content, `versionName=(.*)\s`, 1)
	primaryCpuAbi := regexCaptureValue(content, `primaryCpuAbi=(.*)\s`, 1)
	timeStamp := regexCaptureValue(content, `timeStamp=(.*)\s`, 1)
	firstInstallTime := regexCaptureValue(content, `firstInstallTime=(.*)\s`, 1)
	lastUpdateTime := regexCaptureValue(content, `lastUpdateTime=(.*)\s`, 1)
	signVersion := regexCaptureValue(content, `apkSigningVersion=(.*)\s`, 1)
	dataDir := regexCaptureValue(content, `dataDir=(.*)\s`, 1)

	versionCode := regexCaptureValue(content, `versionCode=(.*?)\s`, 1)
	minSdk := regexCaptureValue(content, `minSdk=(.*?)\s`, 1)
	targetSdk := regexCaptureValue(content, `targetSdk=(.*?)\s`, 1)

	externalDataDir := fmt.Sprintf("/storage/emulated/0/Android/data/%s", packageName)
	isSystem := strings.HasPrefix(installPath, "/system")

	return &AppDescInfo{
		PackageName:      packageName,
		PrimaryCpuAbi:    primaryCpuAbi,
		VersionName:      versionName,
		VersionCode:      versionCode,
		MinSdk:           minSdk,
		TargetSdk:        targetSdk,
		TimeStamp:        timeStamp,
		FirstInstallTime: firstInstallTime,
		LastUpdateTime:   lastUpdateTime,
		SignVersion:      signVersion,
		DataDir:          dataDir,
		ExternalDataDir:  externalDataDir,
		InstallPath:      installPath,
		Size:             size,
		IsSystem:         isSystem,
	}
}

func GetAppDesc(param ExecuteParams) types.ExecResult {
	packageRes := execCmd(buildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("dumpsys package %s", param.PackageName)))
	finalCmd := packageRes.Cmd
	if packageRes.Error != "" {
		return packageRes
	}

	installPathRes := execCmd(buildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("pm path %s", param.PackageName)))
	finalCmd = finalCmd + "\n" + installPathRes.Cmd
	if installPathRes.Error != "" {
		return installPathRes
	}

	installPath := strings.TrimPrefix(strings.TrimSpace(installPathRes.Res), "package:")

	// 3. 获取应用大小
	size := "0"
	if installPath != "" {
		duRes := execCmd(buildAdbShellCmd(param.AdbPath, param.DeviceId, fmt.Sprintf("du -sh %s", installPath)))
		finalCmd = finalCmd + "\n" + duRes.Cmd
		if duRes.Error == "" {
			fields := strings.Fields(duRes.Res)
			if len(fields) > 0 {
				size = fields[0]
			}
		}
	}

	// 4. 解析应用描述
	appDesc := parseAppDesc(packageRes.Res, param.PackageName, installPath, size)
	file, _ := os.Create("/Users/apple/Desktop/output.txt")
	defer file.Close()
	file.WriteString(packageRes.Res)

	return types.NewExecResultSuccess(finalCmd, appDesc.String())
}
