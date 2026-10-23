// Package adb 负责 adb 命令的构建与执行、设备列表与设备跟踪，是其他功能包的基础。
package adb

import (
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"context"
	"fmt"
	"regexp"
	"strings"
)

type ExecuteParams struct {
	Action      string
	PackageName string
	Ctxt        context.Context
	DeviceId    string
	AdbPath     string
	// OnStage 上报执行阶段，供前端区分"等待用户选择文件"和"命令执行中"
	OnStage func(stage string)
}

const (
	StageDialog  = "dialog"
	StageRunning = "running"
	StagePulling = "pulling"
)

func (p ExecuteParams) Stage(stage string) {
	if p.OnStage != nil {
		p.OnStage(stage)
	}
}

// Command 拼出交给本机 shell 执行的 adb 命令；adb 路径与序列号会加引号，路径含空格时也能执行
func Command(adbPath string, deviceId string, shellCmd string) string {
	if deviceId != "" {
		return fmt.Sprintf("%s -s %s %s", util.QuoteHostArg(adbPath), util.QuoteHostArg(deviceId), shellCmd)
	}
	return fmt.Sprintf("%s %s", util.QuoteHostArg(adbPath), shellCmd)
}

func ShellCommand(adbPath string, deviceId string, shellCmd string) string {
	return Command(adbPath, deviceId, "shell "+shellCmd)
}

func Exec(cmd string) types.ExecResult {
	res, err := util.Exec(cmd, true, nil)
	if err != nil {
		return types.NewExecResultFromError(cmd, "", err)
	}
	return types.NewExecResultSuccess(cmd, strings.TrimSpace(res))
}

func ExecAll(cmds ...string) types.ExecResult {
	var allCmds []string
	for _, cmd := range cmds {
		result := Exec(cmd)
		allCmds = append(allCmds, cmd)
		if result.Error != "" {
			return types.NewExecResultFromString(strings.Join(allCmds, "\n"), result.Res, result.Error)
		}
	}
	finalCmd := strings.Join(allCmds, "\n")
	return types.NewExecResultSuccess(finalCmd, "success")
}

var rePackageName = regexp.MustCompile(`^[A-Za-z0-9._]+$`)

// ValidPackageName 包名只允许字母、数字、点和下划线，避免拼进 shell 命令时被注入
func ValidPackageName(name string) bool {
	return rePackageName.MatchString(name)
}

// Args 在参数前加上 -s <序列号>（单设备时不加），用于直接以参数列表执行 adb、不经过本机 shell
func (p ExecuteParams) Args(args ...string) []string {
	if p.DeviceId != "" {
		return append([]string{"-s", p.DeviceId}, args...)
	}
	return args
}

// CmdLine 展示给用户的命令行
func (p ExecuteParams) CmdLine(args ...string) string {
	return util.QuoteHostArg(p.AdbPath) + " " + strings.Join(p.Args(args...), " ")
}
