package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"archive/zip"
	"bytes"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestAPKInstaller(t *testing.T) {
	downgrade := types.NewExecResultFromString("install", "Failure ["+versionDowngradeError+"]", versionDowngradeError)
	success := types.NewExecResultSuccess("command", "Success")
	failure := types.NewExecResultFromString("command", "Failure [blocked]", "blocked")
	for _, tc := range []struct {
		name        string
		results     []types.ExecResult
		packageName string
		readErr     error
		confirm     bool
		confirmErr  error
		wantCalls   int
		wantPrompts int
		wantError   string
	}{
		{name: "normal install", results: []types.ExecResult{success}, wantCalls: 1},
		{name: "other failure", results: []types.ExecResult{failure}, wantCalls: 1, wantError: "blocked"},
		{name: "cancel", results: []types.ExecResult{downgrade}, packageName: "com.example.apk", wantCalls: 1, wantPrompts: 1, wantError: "已取消卸载"},
		{name: "invalid package", results: []types.ExecResult{downgrade}, packageName: "", wantCalls: 1, wantError: "无法读取 APK 包名"},
		{name: "unreadable APK", results: []types.ExecResult{downgrade}, readErr: fmt.Errorf("bad APK"), wantCalls: 1, wantError: "bad APK"},
		{name: "dialog failure", results: []types.ExecResult{downgrade}, packageName: "com.example.apk", confirmErr: fmt.Errorf("dialog failed"), wantCalls: 1, wantPrompts: 1, wantError: "未完成卸载确认"},
		{name: "uninstall failure", results: []types.ExecResult{downgrade, failure}, packageName: "com.example.apk", confirm: true, wantCalls: 2, wantPrompts: 1, wantError: "卸载失败"},
		{name: "retry failure", results: []types.ExecResult{downgrade, success, failure}, packageName: "com.example.apk", confirm: true, wantCalls: 3, wantPrompts: 1, wantError: "原应用已卸载，但重新安装失败"},
		{name: "retry success", results: []types.ExecResult{downgrade, success, success}, packageName: "com.example.apk", confirm: true, wantCalls: 3, wantPrompts: 1},
		{name: "downgrade only in output", results: []types.ExecResult{types.NewExecResultSuccess("install", downgrade.Res)}, packageName: "com.example.apk", wantCalls: 1, wantPrompts: 1, wantError: versionDowngradeError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls [][]string
			prompts := 0
			installer := apkInstaller{
				run: func(args ...string) types.ExecResult {
					calls = append(calls, args)
					if len(calls) > len(tc.results) {
						t.Fatalf("unexpected command: %v", args)
					}
					return tc.results[len(calls)-1]
				},
				readPackage: func(path string) (string, error) {
					if path != "selected app.apk" {
						t.Fatalf("wrong APK: %q", path)
					}
					return tc.packageName, tc.readErr
				},
				confirm: func(pkg string) (bool, error) {
					prompts++
					if pkg != "com.example.apk" {
						t.Fatalf("wrong uninstall target: %q", pkg)
					}
					return tc.confirm, tc.confirmErr
				},
			}
			result := installer.install("selected app.apk")
			if len(calls) != tc.wantCalls || prompts != tc.wantPrompts {
				t.Fatalf("commands=%d prompts=%d; want %d, %d", len(calls), prompts, tc.wantCalls, tc.wantPrompts)
			}
			if tc.wantError == "" && result.Error != "" || tc.wantError != "" && !strings.Contains(result.Error, tc.wantError) {
				t.Fatalf("error=%q; want %q", result.Error, tc.wantError)
			}
			if len(calls) > 1 && !reflect.DeepEqual(calls[1], []string{"uninstall", "com.example.apk"}) {
				t.Fatalf("wrong uninstall command: %v", calls[1])
			}
			if len(calls) > 2 && !reflect.DeepEqual(calls[0], calls[2]) {
				t.Fatalf("retry changed APK or options: %v", calls)
			}
		})
	}
}

func TestRunAPKCommand(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake ADB uses a POSIX script")
	}
	dir := t.TempDir()
	adbPath := filepath.Join(dir, "fake adb")
	for _, tc := range []struct {
		name, script, wantError string
	}{
		{"arguments", "printf '%s\\n' \"$@\"", ""},
		{"failure output", "printf 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]\\n'", versionDowngradeError},
		{"nonzero exit", "printf 'device offline\\n' >&2\nexit 1", "device offline"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(adbPath, []byte("#!/bin/sh\n"+tc.script+"\n"), 0700); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, "app $(touch unwanted); file.apk")
			result := runAPKCommand(adb.ExecuteParams{AdbPath: adbPath, DeviceId: "serial-123"}, "install", "-d", "-t", path)
			if tc.wantError == "" {
				want := strings.Join([]string{"-s", "serial-123", "install", "-d", "-t", path}, "\n")
				if result.Error != "" || result.Res != want {
					t.Fatalf("arguments were changed: %+v", result)
				}
			} else if !strings.Contains(result.Error, tc.wantError) {
				t.Fatalf("failure not reported: %+v", result)
			}
		})
	}
}

func TestReadAPKPackage(t *testing.T) {
	// Minimal binary AndroidManifest.xml with a UTF-8 string pool and package attribute.
	var pool bytes.Buffer
	var offsets []uint32
	for _, s := range []string{"manifest", "package", "com.example.apk"} {
		offsets = append(offsets, uint32(pool.Len()))
		pool.Write([]byte{byte(len(s)), byte(len(s))})
		pool.WriteString(s)
		pool.WriteByte(0)
	}
	for pool.Len()%4 != 0 {
		pool.WriteByte(0)
	}
	var body bytes.Buffer
	write := func(value any) {
		t.Helper()
		if err := binary.Write(&body, binary.LittleEndian, value); err != nil {
			t.Fatal(err)
		}
	}
	write([]uint16{1, 28})
	write([]uint32{uint32(40 + pool.Len()), 3, 0, 0x100, 40, 0})
	write(offsets)
	body.Write(pool.Bytes())
	write([]uint16{0x102, 16})
	write([]uint32{56, 1, 0xffffffff, 0xffffffff, 0})
	write([]uint16{20, 20, 1, 0, 0, 0})
	write([]uint32{0xffffffff, 1, 2})
	write([]uint16{8, 0x0300})
	write(uint32(2))
	write([]uint16{0x103, 16})
	write([]uint32{24, 1, 0xffffffff, 0xffffffff, 0})
	var manifest bytes.Buffer
	binary.Write(&manifest, binary.LittleEndian, []uint16{3, 8})
	binary.Write(&manifest, binary.LittleEndian, uint32(8+body.Len()))
	manifest.Write(body.Bytes())

	path := filepath.Join(t.TempDir(), "selected.apk")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("AndroidManifest.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write(manifest.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	file.Close()
	pkg, err := readAPKPackage(path)
	if err != nil || pkg != "com.example.apk" {
		t.Fatalf("package=%q err=%v", pkg, err)
	}
	if _, err := readAPKPackage(filepath.Join(t.TempDir(), "missing.apk")); err == nil {
		t.Fatal("missing APK must fail")
	}
}
