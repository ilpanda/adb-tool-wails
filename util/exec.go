package util

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
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

	if stdoutStr != "" && stderrStr == "" {
		return stdoutStr, nil
	}

	// stdout 有内容但 stderr 也有内容 → 合并打印
	if stdoutStr != "" && stderrStr != "" {
		if strings.HasSuffix(stdoutStr, "\n") {
			return stdoutStr + stderrStr, nil
		}
		return stdoutStr + "\n" + stderrStr, nil
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

func ExecBackground(command string) error {
	cmd := exec.Command("/bin/sh", "-c", command)

	// 不捕获输出，让它在后台运行
	cmd.Stdout = nil
	cmd.Stderr = nil

	// Start 只启动进程，不等待结束
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start command failed: %w", err)
	}

	// 可选：在 goroutine 中等待进程，防止僵尸进程
	go func() {
		_ = cmd.Wait()
	}()

	return nil
}

func Log(msg string) {
	fmt.Println(msg)
}

func LogE(msg string) {
	fmt.Printf("[Error] : %s\n", msg)
}
