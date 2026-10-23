package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
)

func execCmd(cmd string) types.ExecResult {
	return adb.Exec(cmd)
}

func execCmds(cmds ...string) types.ExecResult {
	return adb.ExecAll(cmds...)
}
