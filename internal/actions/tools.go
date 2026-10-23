package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"bytes"
	"fmt"
	"image/png"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

// 以下命令直接以参数列表调用 adb，不经过本机 shell；需要设备端解析的参数用 deviceQuote 包裹

// deviceQuote 设备端 sh 的单引号转义
func deviceQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// ScreenshotToClipboard 截取当前屏幕并复制到系统剪贴板，不保存文件
func ScreenshotToClipboard(param adb.ExecuteParams) types.ExecResult {
	cmdLine := param.CmdLine("exec-out", "screencap", "-p")
	cmd := exec.Command(param.AdbPath, param.Args("exec-out", "screencap", "-p")...)
	util.ConfigureCommand(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return types.NewExecResultErrorString(cmdLine, "截图失败: "+msg)
	}

	data := stdout.Bytes()
	config, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return types.NewExecResultErrorString(cmdLine, "截图数据不是有效的 PNG，设备可能处于锁屏或安全页面")
	}

	file, err := os.CreateTemp("", "adb-tool-screenshot-*.png")
	if err != nil {
		return types.NewExecResultError(cmdLine, err)
	}
	path := file.Name()
	defer os.Remove(path)
	_, err = file.Write(data)
	file.Close()
	if err != nil {
		return types.NewExecResultError(cmdLine, err)
	}

	if err := copyImageToClipboard(path); err != nil {
		return types.NewExecResultErrorString(cmdLine, "复制到剪贴板失败: "+err.Error())
	}
	return types.NewExecResultSuccess(cmdLine, fmt.Sprintf("%d×%d，可直接粘贴", config.Width, config.Height))
}

// copyImageToClipboard 用各平台自带的工具把 PNG 写入系统剪贴板
func copyImageToClipboard(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`set the clipboard to (read (POSIX file %s) as «class PNGf»)`, strconv.Quote(path))
		cmd = exec.Command("osascript", "-e", script)
	case "windows":
		script := fmt.Sprintf(
			"Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; "+
				"$img = [System.Drawing.Image]::FromFile('%s'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose()",
			strings.ReplaceAll(path, "'", "''"))
		// 剪贴板需要 STA 线程
		cmd = exec.Command("powershell", "-NoProfile", "-STA", "-Command", script)
	default:
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		if os.Getenv("WAYLAND_DISPLAY") != "" {
			cmd = exec.Command("wl-copy", "--type", "image/png")
		} else {
			cmd = exec.Command("xclip", "-selection", "clipboard", "-t", "image/png")
		}
		cmd.Stdin = file
	}
	util.ConfigureCommand(cmd)
	if output, err := cmd.CombinedOutput(); err != nil {
		if msg := strings.TrimSpace(string(output)); msg != "" {
			return fmt.Errorf("%s", msg)
		}
		return err
	}
	return nil
}

// DeepLinkResult am start -W 的结果
type DeepLinkResult struct {
	Cmd       string `json:"cmd"`
	Output    string `json:"output"`
	Activity  string `json:"activity"`  // 打开的 Activity
	TotalTime int    `json:"totalTime"` // 启动耗时（毫秒），未知为 0
	Error     string `json:"error,omitempty"`
}

// OpenDeepLink 用 VIEW Intent 打开链接；packageName 非空时只在该应用内解析
func OpenDeepLink(param adb.ExecuteParams, link string, packageName string) DeepLinkResult {
	link = strings.TrimSpace(link)
	if link == "" || !strings.Contains(link, ":") {
		return DeepLinkResult{Error: "链接格式不正确，需要包含 scheme，例如 myapp://home 或 https://example.com"}
	}
	script := "am start -W -a android.intent.action.VIEW -d " + deviceQuote(link)
	if packageName != "" {
		if !adb.ValidPackageName(packageName) {
			return DeepLinkResult{Error: "包名不合法: " + packageName}
		}
		script += " " + packageName
	}

	result := DeepLinkResult{Cmd: param.CmdLine("shell", script)}
	cmd := exec.Command(param.AdbPath, param.Args("shell", script)...)
	util.ConfigureCommand(cmd)
	output, err := cmd.CombinedOutput()
	result.Output = strings.TrimSpace(string(output))
	parseDeepLinkOutput(&result)
	if err != nil && result.Error == "" {
		result.Error = result.Output
		if result.Error == "" {
			result.Error = err.Error()
		}
	}
	return result
}

func parseDeepLinkOutput(result *DeepLinkResult) {
	for _, line := range strings.Split(result.Output, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Error:"), strings.HasPrefix(line, "Exception"):
			if result.Error == "" {
				result.Error = line
				if strings.Contains(line, "unable to resolve Intent") {
					result.Error = "设备上没有应用能处理这个链接，请检查 scheme / host 是否已在 AndroidManifest 中声明"
				}
			}
		case strings.HasPrefix(line, "Activity:"):
			result.Activity = strings.TrimSpace(strings.TrimPrefix(line, "Activity:"))
		case strings.HasPrefix(line, "TotalTime:"):
			result.TotalTime, _ = strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(line, "TotalTime:")))
		case strings.HasPrefix(line, "Status:") && !strings.Contains(line, "ok"):
			if result.Error == "" {
				result.Error = line
			}
		}
	}
}
