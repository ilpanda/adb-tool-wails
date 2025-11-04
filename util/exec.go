package util

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
)

// Exec executes a shell command
func Exec(command string, ignoreError bool, exitWhen func(string) bool) (string, error) {
	cmd := exec.Command("/bin/sh", "-c", command)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()

	stdoutStr := stdout.String()
	stderrStr := stderr.String()

	if stdoutStr != "" {
		return stdoutStr, nil
	}

	if stderrStr != "" {
		shouldExit := false

		if exitWhen != nil {
			shouldExit = exitWhen(stderrStr)
		}

		if shouldExit || !ignoreError {
			Log(stderrStr)
			os.Exit(1)
		}
	}

	if err != nil && !ignoreError {
		return "", err
	}

	return stderrStr, nil
}

func Log(msg string) {
	fmt.Println(msg)
}

func LogE(msg string) {
	fmt.Printf("[Error] : %s\n", msg)
}
