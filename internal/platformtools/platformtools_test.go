package platformtools

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	goruntime "runtime"
	"testing"
)

// fakeArchive 打包一个能执行 version 的假 adb 脚本
func fakeArchive(t *testing.T) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	header := &zip.FileHeader{Name: "platform-tools/adb", Method: zip.Deflate}
	header.SetMode(0755)
	f, err := w.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	f.Write([]byte("#!/bin/sh\necho 'Android Debug Bridge version 1.0.41'\n"))
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestInstallFallsBackToNextMirror(t *testing.T) {
	if goruntime.GOOS == "windows" || !Supported() {
		t.Skip("假 adb 是 shell 脚本")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)

	archive := fakeArchive(t)
	broken := httptest.NewServer(http.NotFoundHandler())
	defer broken.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+archiveName() {
			http.NotFound(w, r)
			return
		}
		w.Write(archive)
	}))
	defer good.Close()

	saved := mirrors
	mirrors = []string{broken.URL + "/", good.URL + "/"}
	defer func() { mirrors = saved }()

	if Installed() != "" {
		t.Fatal("下载前不应存在内置 adb")
	}
	path, err := Install(context.Background())
	if err != nil {
		t.Fatalf("Install 失败: %v", err)
	}
	if got := Installed(); got != path {
		t.Fatalf("Installed() = %q, want %q", got, path)
	}
	dir, _ := Dir()
	for _, leftover := range []string{dir + ".zip", dir + ".tmp"} {
		if _, err := os.Stat(leftover); !os.IsNotExist(err) {
			t.Errorf("临时文件未清理: %s", leftover)
		}
	}
}

func TestInstallFailsWhenAllMirrorsFail(t *testing.T) {
	if !Supported() {
		t.Skip("当前平台没有 platform-tools")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home)
	t.Setenv("AppData", home)

	broken := httptest.NewServer(http.NotFoundHandler())
	defer broken.Close()
	saved := mirrors
	mirrors = []string{broken.URL + "/", broken.URL + "/"}
	defer func() { mirrors = saved }()

	if _, err := Install(context.Background()); err == nil {
		t.Fatal("所有下载源失败时应返回错误")
	}
	if Installed() != "" {
		t.Fatal("下载失败时不应留下内置 adb")
	}
}
