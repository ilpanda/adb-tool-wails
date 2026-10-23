package update

// 应用内更新：把当前平台的安装包下载到临时目录并解压，用户确认后替换当前应用并重启。
// 程序自己下载的文件不带浏览器加的隔离标记（macOS quarantine / Windows Mark of the Web），
// 更新后的应用打开时不会再被 Gatekeeper / SmartScreen 拦截

import (
	"adb-tool-wails/internal/applog"
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// 下载状态
const (
	StateIdle        = "idle"
	StateDownloading = "downloading"
	StateReady       = "ready"
	StateError       = "error"
)

// Status 新版本的下载状态，变化时通过 onStatus 推送
type Status struct {
	State      string `json:"state"`
	Version    string `json:"version"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Error      string `json:"error,omitempty"`
}

// 解压完成后写入的标记文件，内容为新版本相对下载目录的路径；下次启动可直接复用
const readyMarker = ".ready"

// 下载进度推送的最小间隔
const progressInterval = 150 * time.Millisecond

// 下载失败时的总尝试次数；超过 stallTimeout 收不到数据视为卡住，断开后续传
const downloadAttempts = 3

var stallTimeout = 30 * time.Second

// Updater 检查、下载并安装新版本
type Updater struct {
	current  string
	devBuild bool
	onStatus func(Status)

	mu     sync.Mutex
	latest Info
	status Status
	staged string // 解压后的新版本：macOS 为 .app，Linux 为可执行文件，Windows 为安装程序
}

func NewUpdater(current string, devBuild bool, onStatus func(Status)) *Updater {
	return &Updater{current: current, devBuild: devBuild, onStatus: onStatus, status: Status{State: StateIdle}}
}

// Check 查询最新版本，并记下结果供 Download 使用
func (u *Updater) Check() Info {
	info := Check(u.current, u.devBuild)
	if info.Error == "" {
		u.mu.Lock()
		u.latest = info
		u.mu.Unlock()
	}
	return info
}

func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

func (u *Updater) setStatus(status Status) {
	u.mu.Lock()
	u.status = status
	u.mu.Unlock()
	if u.onStatus != nil {
		u.onStatus(status)
	}
}

// Download 在后台下载最近一次检查到的新版本，进度通过 onStatus 推送；该版本正在下载或已下载完成时直接返回
func (u *Updater) Download(ctx context.Context) error {
	u.mu.Lock()
	info := u.latest
	if !info.CanInstall {
		u.mu.Unlock()
		return errors.New("没有可在应用内安装的新版本")
	}
	if u.status.Version == info.Latest && (u.status.State == StateDownloading || u.status.State == StateReady) {
		u.mu.Unlock()
		return nil
	}
	u.status = Status{State: StateDownloading, Version: info.Latest, Total: info.asset.Size}
	status := u.status
	u.mu.Unlock()
	if u.onStatus != nil {
		u.onStatus(status)
	}

	go func() {
		staged, err := u.download(ctx, info)
		if err != nil {
			applog.Warnf(applog.CategoryStartup, "update_download_failed version=%s err=%q", info.Latest, err.Error())
			u.setStatus(Status{State: StateError, Version: info.Latest, Error: err.Error()})
			return
		}
		u.mu.Lock()
		u.staged = staged
		u.mu.Unlock()
		applog.Infof(applog.CategoryStartup, "update_downloaded version=%s path=%s", info.Latest, staged)
		u.setStatus(Status{State: StateReady, Version: info.Latest, Downloaded: info.asset.Size, Total: info.asset.Size})
	}()
	return nil
}

func stagingRoot() string {
	return filepath.Join(os.TempDir(), "adb-tool-update")
}

func (u *Updater) download(ctx context.Context, info Info) (string, error) {
	dir := filepath.Join(stagingRoot(), info.Latest)
	marker := filepath.Join(dir, readyMarker)
	if rel, err := os.ReadFile(marker); err == nil {
		staged := filepath.Join(dir, string(rel))
		if _, err := os.Stat(staged); err == nil {
			return staged, nil
		}
	}

	// 只保留这一个版本：清掉上次未完成的下载，以及之前下载过但没有安装的其他版本
	if err := os.RemoveAll(stagingRoot()); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	archive := filepath.Join(dir, info.asset.Name)
	if err := u.fetch(ctx, info, archive); err != nil {
		return "", err
	}

	pkg := filepath.Join(dir, "pkg")
	var err error
	if strings.HasSuffix(info.asset.Name, ".zip") {
		err = extractZip(archive, pkg)
	} else {
		err = extractTarGz(archive, pkg)
	}
	if err != nil {
		return "", fmt.Errorf("解压失败：%w", err)
	}
	staged, err := findStaged(pkg, goruntime.GOOS)
	if err != nil {
		return "", err
	}
	_ = os.Remove(archive)
	rel, _ := filepath.Rel(dir, staged)
	if err := os.WriteFile(marker, []byte(rel), 0644); err != nil {
		return "", err
	}
	return staged, nil
}

// fetch 下载安装包，失败时自动重试并从已下载的位置续传，最后按 Release 提供的大小与 sha256 校验
func (u *Updater) fetch(ctx context.Context, info Info, dst string) error {
	var err error
	for attempt := 1; attempt <= downloadAttempts; attempt++ {
		if attempt > 1 {
			applog.Warnf(applog.CategoryStartup, "update_download_retry version=%s attempt=%d err=%q", info.Latest, attempt, err.Error())
			select {
			case <-time.After(time.Duration(attempt-1) * 2 * time.Second):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if err = u.fetchOnce(ctx, info, dst); err == nil || ctx.Err() != nil {
			break
		}
	}
	if err != nil {
		return err
	}
	return verifyFile(dst, info.asset)
}

// fetchOnce 下载一次；文件已有部分内容时用 Range 续传，超过 stallTimeout 收不到数据视为卡住
func (u *Updater) fetchOnce(ctx context.Context, info Info, dst string) error {
	var offset int64
	if stat, err := os.Stat(dst); err == nil {
		offset = stat.Size()
	}
	total := info.asset.Size
	if total > 0 && offset >= total {
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var stalled atomic.Bool
	watchdog := time.AfterFunc(stallTimeout, func() {
		stalled.Store(true)
		cancel()
	})
	defer watchdog.Stop()
	wrap := func(err error) error {
		if stalled.Load() {
			return fmt.Errorf("下载超时：%d 秒内没有收到数据", int(stallTimeout.Seconds()))
		}
		return fmt.Errorf("下载失败：%w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, info.asset.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "adb-tool-wails/"+u.current)
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	resp, err := newHTTPClient().Do(req)
	if err != nil {
		return wrap(err)
	}
	defer resp.Body.Close()

	flags := os.O_CREATE | os.O_WRONLY
	switch {
	case resp.StatusCode == http.StatusPartialContent && offset > 0:
		flags |= os.O_APPEND
	case resp.StatusCode == http.StatusOK:
		// 服务器不支持续传，从头下载
		flags |= os.O_TRUNC
		offset = 0
	default:
		return fmt.Errorf("下载失败：服务器返回 %d", resp.StatusCode)
	}
	if total <= 0 && resp.ContentLength > 0 {
		total = offset + resp.ContentLength
	}

	file, err := os.OpenFile(dst, flags, 0644)
	if err != nil {
		return err
	}
	progress := &progressWriter{written: offset, report: func(n int64) {
		watchdog.Reset(stallTimeout)
		u.setStatus(Status{State: StateDownloading, Version: info.Latest, Downloaded: n, Total: total})
	}}
	_, err = io.Copy(io.MultiWriter(file, progress), resp.Body)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return wrap(err)
	}
	return nil
}

// verifyFile 校验下载结果的大小与 sha256；校验失败时删除文件，下次重新下载
func verifyFile(path string, asset releaseAsset) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	hash := sha256.New()
	size, err := io.Copy(hash, file)
	file.Close()
	if err != nil {
		return err
	}
	if asset.Size > 0 && size != asset.Size {
		_ = os.Remove(path)
		return fmt.Errorf("下载不完整：%d / %d 字节", size, asset.Size)
	}
	if want, ok := strings.CutPrefix(asset.Digest, "sha256:"); ok && !strings.EqualFold(want, hex.EncodeToString(hash.Sum(nil))) {
		_ = os.Remove(path)
		return errors.New("安装包校验失败，请重试")
	}
	return nil
}

// progressWriter 统计已下载字节数，按 progressInterval 节流回调
type progressWriter struct {
	written int64
	last    time.Time
	report  func(int64)
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.written += int64(len(p))
	if now := time.Now(); now.Sub(w.last) >= progressInterval {
		w.last = now
		w.report(w.written)
	}
	return len(p), nil
}

// safeJoin 拼接解压路径，拒绝跳出目标目录的条目
func safeJoin(dst, name string) (string, error) {
	target := filepath.Join(dst, name)
	if target != filepath.Clean(dst) && !strings.HasPrefix(target, filepath.Clean(dst)+string(os.PathSeparator)) {
		return "", fmt.Errorf("非法路径：%s", name)
	}
	return target, nil
}

func extractTarGz(src, dst string) error {
	file, err := os.Open(src)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()

	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			// 读完 gzip 尾部才会校验 CRC，没有 sha256 时靠它发现下载损坏
			_, err = io.Copy(io.Discard, gz)
			return err
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(dst, header.Name)
		if err != nil {
			return err
		}
		mode := header.FileInfo().Mode()
		switch header.Typeflag {
		case tar.TypeDir:
			err = os.MkdirAll(target, mode.Perm()|0700)
		case tar.TypeReg:
			err = writeFile(target, reader, mode.Perm())
		case tar.TypeSymlink:
			if filepath.IsAbs(header.Linkname) {
				return fmt.Errorf("非法链接：%s", header.Name)
			}
			if err = os.MkdirAll(filepath.Dir(target), 0755); err == nil {
				err = os.Symlink(header.Linkname, target)
			}
		}
		if err != nil {
			return err
		}
	}
}

func extractZip(src, dst string) error {
	reader, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer reader.Close()
	for _, entry := range reader.File {
		target, err := safeJoin(dst, entry.Name)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		rc, err := entry.Open()
		if err != nil {
			return err
		}
		err = writeFile(target, rc, entry.Mode().Perm()|0600)
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func writeFile(path string, src io.Reader, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	_, err = io.Copy(file, src)
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	return err
}

// findStaged 在解压目录中找到新版本：macOS 为 .app，Windows 为安装程序，Linux 为可执行文件
func findStaged(pkg, goos string) (string, error) {
	entries, err := os.ReadDir(pkg)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		name := entry.Name()
		switch goos {
		case "darwin":
			if entry.IsDir() && strings.HasSuffix(name, ".app") {
				return filepath.Join(pkg, name), nil
			}
		case "windows":
			if !entry.IsDir() && strings.HasSuffix(strings.ToLower(name), ".exe") {
				return filepath.Join(pkg, name), nil
			}
		default:
			if entry.Type().IsRegular() {
				return filepath.Join(pkg, name), nil
			}
		}
	}
	return "", errors.New("安装包中没有找到应用")
}

// Install 用已下载的新版本替换当前应用，并安排在当前进程退出后启动新版本；成功后调用方应退出应用
func (u *Updater) Install() error {
	u.mu.Lock()
	staged, ready := u.staged, u.status.State == StateReady
	u.mu.Unlock()
	if !ready || staged == "" {
		return errors.New("新版本尚未下载完成")
	}

	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		return fmt.Errorf("无法定位当前应用：%w", err)
	}
	switch goruntime.GOOS {
	case "darwin":
		err = installApp(exe, staged)
	case "windows":
		// NSIS 安装程序会覆盖安装，安装界面由用户确认
		err = exec.Command(staged).Start()
	default:
		err = installBinary(exe, staged)
	}
	if err != nil {
		applog.Warnf(applog.CategoryStartup, "update_install_failed err=%q", err.Error())
		return err
	}
	applog.Infof(applog.CategoryStartup, "update_installed version=%s", u.Status().Version)
	return nil
}

// installApp 替换 macOS 的 .app：先把旧版本改名留作回滚，复制新版本到原位置，退出后删除旧版本并打开新版本
func installApp(exe, staged string) error {
	bundle := exe
	for !strings.HasSuffix(bundle, ".app") {
		parent := filepath.Dir(bundle)
		if parent == bundle {
			return errors.New("无法定位当前应用的 .app 目录")
		}
		bundle = parent
	}
	if strings.Contains(bundle, "/AppTranslocation/") {
		return errors.New("应用正从系统隔离位置运行，请先把它移到「应用程序」文件夹后再更新")
	}

	backup := bundle + ".old"
	_ = os.RemoveAll(backup)
	if err := os.Rename(bundle, backup); err != nil {
		return fmt.Errorf("没有权限替换应用：%w", err)
	}
	if out, err := exec.Command("ditto", staged, bundle).CombinedOutput(); err != nil {
		_ = os.RemoveAll(bundle)
		_ = os.Rename(backup, bundle)
		return fmt.Errorf("复制新版本失败：%s", strings.TrimSpace(string(out)))
	}
	// 新版本由本程序复制，正常不带隔离标记，这里再清一次以防万一
	_ = exec.Command("xattr", "-dr", "com.apple.quarantine", bundle).Run()
	return relaunch(`while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; rm -rf "$2"; open "$3"`, backup, bundle)
}

// installBinary 替换 Linux 的可执行文件，退出后删除旧文件并启动新版本
func installBinary(exe, staged string) error {
	backup := exe + ".old"
	_ = os.Remove(backup)
	if err := os.Rename(exe, backup); err != nil {
		return fmt.Errorf("没有权限替换应用：%w", err)
	}
	src, err := os.Open(staged)
	if err == nil {
		err = writeFile(exe, src, 0755)
		src.Close()
	}
	if err != nil {
		_ = os.Remove(exe)
		_ = os.Rename(backup, exe)
		return fmt.Errorf("复制新版本失败：%w", err)
	}
	return relaunch(`while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; rm -f "$2"; "$3" >/dev/null 2>&1 &`, backup, exe)
}

// relaunch 启动一个等待当前进程退出的 shell 脚本，脚本参数依次为当前进程号与 args
func relaunch(script string, args ...string) error {
	argv := append([]string{"-c", script, "sh", strconv.Itoa(os.Getpid())}, args...)
	if err := exec.Command("/bin/sh", argv...).Start(); err != nil {
		return fmt.Errorf("已更新，但无法自动重启，请手动打开应用：%w", err)
	}
	return nil
}

// CleanStaged 删除不比当前版本新的下载残留，启动时调用：更新完成后，新版本启动时删掉它自己的下载目录
func CleanStaged(current string) {
	entries, err := os.ReadDir(stagingRoot())
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() && compareVersions(entry.Name(), current) <= 0 {
			_ = os.RemoveAll(filepath.Join(stagingRoot(), entry.Name()))
		}
	}
}
