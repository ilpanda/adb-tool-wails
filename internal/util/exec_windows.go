package util

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000

// ConfigureCommand 隐藏子进程窗口；保留已设置的 SysProcAttr（如 shellCommand 的原始命令行）
func ConfigureCommand(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}

// shellCommand 把命令行原样交给 cmd.exe。
// exec.Command("cmd", "/C", command) 会按 Go 的规则用反斜杠转义引号，cmd.exe 不认这种转义，
// 命令里带引号（如含空格的路径）时会解析错误；/S /C "..." 会去掉最外层引号后按原样执行
func shellCommand(command string) *exec.Cmd {
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `cmd.exe /S /C "` + command + `"`}
	return cmd
}
