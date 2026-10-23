package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"bufio"
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

// 设备相关操作：设备信息、截图、按键、系统设置跳转、开发者选项开关、重启与关机

var reInitDisplay = regexp.MustCompile(`init=(\d+x\d+)`)

var reInetAddr = regexp.MustCompile(`inet (\d+\.\d+\.\d+\.\d+)`)

var reWifiSSID = regexp.MustCompile(`mWifiInfo\s+SSID: "?(.+?)"?,`)

var reDataFree = regexp.MustCompile(`Data-Free:\s*(\d+)K\s*/\s*(\d+)K`)

func Shutdown(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "reboot -p")
	return execCmd(cmd)
}

func Reboot(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.Command(param.AdbPath, param.DeviceId, "reboot")
	return execCmd(cmd)
}

func SendKeyEvent(param adb.ExecuteParams, keyCode string) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("input keyevent %s", keyCode))
	return execCmd(cmd)
}

func GetAllSystemProperties(param adb.ExecuteParams) types.ExecResult {
	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "getprop")
	return execCmd(cmd)
}

func Screenshot(param adb.ExecuteParams) types.ExecResult {
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

	param.Stage(adb.StageDialog)
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

	param.Stage(adb.StageRunning)
	if savePath == "" {
		return types.NewExecResultCanceled("", "用户取消保存")
	}

	// 2. 执行截图命令
	// 方案：先保存到设备，再拉取（最稳定）
	devicePath := "/sdcard/screenshot_temp.png"

	// 步骤1: 截图到设备
	cmdScreencap := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("screencap -p %s", devicePath))
	res, err := util.Exec(cmdScreencap, false, nil)
	if err != nil {
		return types.NewExecResultErrorString(cmdScreencap, fmt.Sprintf("截图失败: %v, 输出: %s", err, res))
	}

	// 步骤2: 拉取到本地
	param.Stage(adb.StagePulling)
	cmdPull := adb.Command(param.AdbPath, param.DeviceId, fmt.Sprintf("pull %s %s", devicePath, util.QuoteHostArg(savePath)))
	res, err = util.Exec(cmdPull, false, nil)
	if err != nil {
		return types.NewExecResultErrorString(cmdPull, fmt.Sprintf("拉取文件失败: %v, 输出: %s", err, res))
	}

	// 步骤3: 清理设备临时文件
	cmdRm := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("rm %s", devicePath))
	_, _ = util.Exec(cmdRm, false, nil) // 忽略删除错误

	finalCmd := cmdScreencap + "\n" + cmdPull + "\n" + cmdRm

	// 步骤4: 验证文件是否存在
	if _, err := os.Stat(savePath); os.IsNotExist(err) {
		return types.NewExecResultErrorString(finalCmd, "截图保存失败，文件不存在")
	}

	result := types.NewExecResultSuccess(finalCmd, fmt.Sprintf("截图已保存到: %s", savePath))
	result.LocalPath = savePath
	return result
}

func GetDeviceInfo(param adb.ExecuteParams) types.ExecResult {
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
		cmdStrs = append(cmdStrs, adb.ShellCommand(param.AdbPath, param.DeviceId, cmd))
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

	match := reInitDisplay.FindStringSubmatch(displayRes)

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
IP 地址：%s`,
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
	)

	if otaVersion != "" {
		result += fmt.Sprintf("\nOTA 版本号: %s", otaVersion)
	}
	result += "\n"

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
	match := reInetAddr.FindStringSubmatch(output)
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
	var systemSize = 0 // System Size 行的值 (Bytes)
	var dataFree = 0   // Data-Free 中的 free 值 (KB)
	var dataTotal = 0  // Data-Free 中的 total 值 (KB)
	scanner := bufio.NewScanner(strings.NewReader(msg))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Data-Free") {
			// 匹配: Data-Free: 28221744K / 110366412K total = 25% free
			matches := reDataFree.FindStringSubmatch(line)
			if len(matches) > 2 {
				dataFree, _ = strconv.Atoi(matches[1])
				dataTotal, _ = strconv.Atoi(matches[2])
			}
		} else if strings.HasPrefix(line, "System Size") {
			// 匹配: System Size: 128000000000
			split := strings.Split(line, ":")
			if len(split) == 2 {
				systemSize, _ = strconv.Atoi(strings.TrimSpace(split[1]))
			}
		}
	}

	// 优先使用 System Size，否则使用 Data-Free 中的 total
	if systemSize > 0 {
		totalGB := systemSize / (1000 * 1000 * 1000)
		usedGB := float64(systemSize/1000-dataFree) / (1024 * 1024)
		return fmt.Sprintf("%.2f/%dG", usedGB, totalGB)
	} else if dataTotal > 0 {
		usedGB := float64(dataTotal-dataFree) / (1024 * 1024)
		totalGB := float64(dataTotal) / (1024 * 1024)
		return fmt.Sprintf("%.2f/%.0fG", usedGB, totalGB)
	}
	return "N/A"
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
	match := reWifiSSID.FindStringSubmatch(dumpsysOutput)
	if len(match) < 2 {
		return ""
	}

	ssid := match[1]
	if ssid == "<unknown ssid>" {
		return ""
	}

	return ssid
}

// JumpToSettings 跳转到指定设置页面
func JumpToSettings(param adb.ExecuteParams) types.ExecResult {
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

	cmd := adb.ShellCommand(param.AdbPath, param.DeviceId, fmt.Sprintf("am start -a %s", intent))
	res, err := util.Exec(cmd, false, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, res, err)
	}

	return types.NewExecResultSuccess(cmd, res)
}

func ToggleDevOption(param adb.ExecuteParams, prop string, onValue string) types.ExecResult {
	getCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "getprop "+prop)
	result := execCmd(getCmd)
	if result.Error != "" {
		return result
	}

	var setCmd string
	if strings.TrimSpace(result.Res) == onValue {
		setCmd = adb.ShellCommand(param.AdbPath, param.DeviceId, "setprop "+prop+" false")
	} else {
		setCmd = adb.ShellCommand(param.AdbPath, param.DeviceId, "setprop "+prop+" "+onValue)
	}

	refreshCmd := adb.ShellCommand(param.AdbPath, param.DeviceId, "service call activity 1599295570")
	return execCmds(setCmd, refreshCmd)
}
