//go:build !windows

package util

import "os/exec"

func ConfigureCommand(cmd *exec.Cmd) {
}

func shellCommand(command string) *exec.Cmd {
	return exec.Command("/bin/sh", "-c", command)
}
