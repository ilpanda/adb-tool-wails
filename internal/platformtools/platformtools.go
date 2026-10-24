// Package platformtools 本机没有 adb 时，在后台下载 Google 官方的 platform-tools 作为内置 adb。
// 程序自己下载的文件不带 macOS quarantine 标记，解压后可直接执行
package platformtools

import (
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/update"
	"adb-tool-wails/internal/util"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync/atomic"
	"time"
)

// 下载源，依次尝试：Google 官方、Google 国内域名、腾讯云镜像
var mirrors = []string{
	"https://dl.google.com/android/repository/",
	"https://googledownloads.cn/android/repository/",
	"https://mirrors.cloud.tencent.com/AndroidSDK/",
}

// 超过 stallTimeout 收不到数据视为卡住，换下一个下载源
const stallTimeout = 30 * time.Second

// archiveName 当前平台的 platform-tools 压缩包；Linux 只提供 x86_64 版本
func archiveName() string {
	switch {
	case goruntime.GOOS == "darwin":
		return "platform-tools-latest-darwin.zip"
	case goruntime.GOOS == "windows":
		return "platform-tools-latest-windows.zip"
	case goruntime.GOOS == "linux" && goruntime.GOARCH == "amd64":
		return "platform-tools-latest-linux.zip"
	}
	return ""
}

// Dir 内置 platform-tools 的解压目录，与配置存储放在同一目录下
func Dir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "config", "platform-tools"), nil
}

func adbIn(dir string) string {
	name := "adb"
	if goruntime.GOOS == "windows" {
		name = "adb.exe"
	}
	return filepath.Join(dir, "platform-tools", name)
}

// Installed 返回已下载的内置 adb 路径，没有时返回空
func Installed() string {
	dir, err := Dir()
	if err != nil {
		return ""
	}
	path := adbIn(dir)
	if _, err := exec.LookPath(path); err != nil {
		return ""
	}
	return path
}

// Supported 当前平台是否有官方 platform-tools
func Supported() bool {
	return archiveName() != ""
}

// Install 下载并解压 platform-tools，确认 adb 能执行后返回其路径
func Install(ctx context.Context) (string, error) {
	name := archiveName()
	if name == "" {
		return "", fmt.Errorf("没有 %s/%s 平台的 platform-tools", goruntime.GOOS, goruntime.GOARCH)
	}
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0755); err != nil {
		return "", err
	}

	archive := dir + ".zip"
	defer os.Remove(archive)
	var errs []error
	for _, mirror := range mirrors {
		url := mirror + name
		if err = download(ctx, url, archive); err == nil {
			break
		}
		applog.Warnf(applog.CategoryADB, "platform_tools_download_failed url=%s err=%q", url, err.Error())
		errs = append(errs, err)
		if ctx.Err() != nil {
			break
		}
	}
	if err != nil {
		return "", errors.Join(errs...)
	}

	// 先解压到临时目录并验证，成功后再替换，避免留下不完整的目录
	staging := dir + ".tmp"
	_ = os.RemoveAll(staging)
	defer os.RemoveAll(staging)
	if err := update.ExtractZip(archive, staging); err != nil {
		return "", fmt.Errorf("解压 platform-tools 失败：%w", err)
	}
	if err := verify(ctx, adbIn(staging)); err != nil {
		return "", err
	}
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	if err := os.Rename(staging, dir); err != nil {
		return "", err
	}
	return adbIn(dir), nil
}

// download 下载到 dst；超过 stallTimeout 收不到数据时中断
func download(ctx context.Context, url, dst string) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var stalled atomic.Bool
	watchdog := time.AfterFunc(stallTimeout, func() {
		stalled.Store(true)
		cancel()
	})
	defer watchdog.Stop()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := update.NewHTTPClient().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("服务器返回 %d", resp.StatusCode)
	}

	file, err := os.Create(dst)
	if err != nil {
		return err
	}
	size, err := io.Copy(file, &stallReader{r: resp.Body, watchdog: watchdog})
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if stalled.Load() {
		return fmt.Errorf("下载超时：%d 秒内没有收到数据", int(stallTimeout.Seconds()))
	}
	if err != nil {
		return err
	}
	if resp.ContentLength > 0 && size != resp.ContentLength {
		return fmt.Errorf("下载不完整：%d / %d 字节", size, resp.ContentLength)
	}
	return nil
}

// stallReader 每收到数据就重置无数据超时
type stallReader struct {
	r        io.Reader
	watchdog *time.Timer
}

func (s *stallReader) Read(p []byte) (int, error) {
	n, err := s.r.Read(p)
	if n > 0 {
		s.watchdog.Reset(stallTimeout)
	}
	return n, err
}

// verify 执行 adb version 确认下载的 adb 可用
func verify(ctx context.Context, adb string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, adb, "version")
	util.ConfigureCommand(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("内置 adb 无法执行：%w %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
