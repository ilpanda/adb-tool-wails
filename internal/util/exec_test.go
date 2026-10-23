package util

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestQuoteHostArg(t *testing.T) {
	if got := QuoteHostArg("/usr/local/bin/adb"); got != "/usr/local/bin/adb" {
		t.Fatalf("safe path should stay unquoted, got %s", got)
	}
	if got := QuoteHostArg("192.168.1.5:5555"); got != "192.168.1.5:5555" {
		t.Fatalf("device serial should stay unquoted, got %s", got)
	}
	if runtime.GOOS == "windows" {
		if got := QuoteHostArg(`C:\Program Files\adb.exe`); got != `"C:\Program Files\adb.exe"` {
			t.Fatalf("got %s", got)
		}
		return
	}
	if got := QuoteHostArg("/a b/it's"); got != `'/a b/it'\''s'` {
		t.Fatalf("got %s", got)
	}
}

// 路径含空格、单引号时，拼进命令行后仍能被 shell 正确执行
func TestQuoteHostArgExec(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("covered by cmd.exe on Windows")
	}
	dir := filepath.Join(t.TempDir(), "with space's dir")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(dir, "fake adb")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho ok \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	out, err := Exec(QuoteHostArg(script)+" -s "+QuoteHostArg("emulator-5554")+" shell echo", false, nil)
	if err != nil || strings.TrimSpace(out) != "ok -s emulator-5554 shell echo" {
		t.Fatalf("out=%q err=%v", out, err)
	}
}
