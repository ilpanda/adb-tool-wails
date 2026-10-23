// Package files 设备文件管理：列目录、预览、上传、下载与删除。
package files

import (
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/types"
	"adb-tool-wails/internal/util"
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 文件管理相关命令直接调用 adb 可执行文件，不经过本机 shell：
// 本机 sh 会剥掉一层引号，导致含空格的路径到设备端被拆开。
// 需要设备端解析的命令只作为 adb shell 的单个参数传入，路径用 shellQuote 包裹。

const (
	dirLinksMarker    = "__ADB_TOOL_DIR_LINKS__"
	previewTextLimit  = 512 * 1024
	previewImageLimit = 20 * 1024 * 1024
)

var previewImageMimes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".bmp":  "image/bmp",
}

// DirListing 目录列表结果，DirLinks 为指向目录的符号链接名
type DirListing struct {
	Output   string   `json:"output"`
	DirLinks []string `json:"dirLinks"`
	Error    string   `json:"error,omitempty"`
}

// FilePreview 文件预览结果，Kind 为 text / image / binary，图片内容为 base64
type FilePreview struct {
	Kind      string `json:"kind"`
	Content   string `json:"content"`
	Mime      string `json:"mime,omitempty"`
	Size      int64  `json:"size"`
	Truncated bool   `json:"truncated"`
	Error     string `json:"error,omitempty"`
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

// Client 文件管理操作。Ctx 用于弹出文件选择 / 保存对话框
type Client struct {
	Ctx     context.Context
	AdbPath string
}

func (c Client) adbBinary() string {
	if c.AdbPath != "" {
		return c.AdbPath
	}
	return "adb"
}

func (c Client) adbArgs(deviceId string, args ...string) []string {
	if deviceId == "" {
		return args
	}
	return append([]string{"-s", deviceId}, args...)
}

func (c Client) adbCmdLine(deviceId string, args ...string) string {
	return strings.Join(append([]string{c.adbBinary()}, c.adbArgs(deviceId, args...)...), " ")
}

func (c Client) runAdb(deviceId string, args ...string) ([]byte, []byte, error) {
	cmd := exec.Command(c.adbBinary(), c.adbArgs(deviceId, args...)...)
	util.ConfigureCommand(cmd)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.Bytes(), stderr.Bytes(), err
}

func adbError(stdout, stderr []byte, err error) error {
	if msg := strings.TrimSpace(string(stderr)); msg != "" {
		return errors.New(msg)
	}
	// adb shell 会把设备端的错误输出合并到 stdout
	if msg := strings.TrimSpace(string(stdout)); msg != "" {
		return errors.New(msg)
	}
	return err
}

// List 列出设备目录内容，同时找出其中指向目录的符号链接（如 /sdcard）
func (c Client) List(deviceId string, dir string) DirListing {
	target := dir
	if target != "/" {
		// 末尾加 / 使 ls 跟随指向目录的符号链接
		target = strings.TrimRight(target, "/") + "/"
	}
	q := shellQuote(target)
	script := fmt.Sprintf(
		`ls -lan -- %s; s=$?; echo %s; for f in %s* %s.*; do [ -L "$f" ] && [ -d "$f" ] && echo "${f##*/}"; done; exit $s`,
		q, dirLinksMarker, q, q,
	)

	stdout, stderr, err := c.runAdb(deviceId, "shell", script)
	listing, links, _ := strings.Cut(string(stdout), dirLinksMarker)
	listing = strings.TrimSpace(listing)

	// 部分条目无权限时 ls 也会返回非 0，只要有输出就视为成功
	if listing == "" && err != nil {
		return DirListing{Error: adbError(nil, stderr, err).Error()}
	}

	dirLinks := []string{}
	for _, name := range strings.Split(links, "\n") {
		if name = strings.TrimSpace(name); name != "" && name != "." && name != ".." {
			dirLinks = append(dirLinks, name)
		}
	}
	return DirListing{Output: listing, DirLinks: dirLinks}
}

// Preview 读取设备文件用于预览：图片返回 base64，文本只读取开头部分，二进制文件不返回内容
func (c Client) Preview(deviceId string, remotePath string) FilePreview {
	q := shellQuote(remotePath)

	stdout, stderr, err := c.runAdb(deviceId, "shell", "stat -c %s -- "+q)
	if err != nil {
		return FilePreview{Error: adbError(stdout, stderr, err).Error()}
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(stdout)), 10, 64)
	if err != nil {
		return FilePreview{Error: fmt.Sprintf("无法读取文件大小: %s", strings.TrimSpace(string(stdout)))}
	}

	if mime, ok := previewImageMimes[strings.ToLower(path.Ext(remotePath))]; ok {
		if size > previewImageLimit {
			return FilePreview{Kind: "image", Size: size, Error: fmt.Sprintf("图片超过 %d MB，请下载后查看", previewImageLimit/1024/1024)}
		}
		data, stderr, err := c.runAdb(deviceId, "exec-out", "cat -- "+q)
		if err != nil {
			return FilePreview{Kind: "image", Size: size, Error: adbError(nil, stderr, err).Error()}
		}
		return FilePreview{Kind: "image", Mime: mime, Size: size, Content: base64.StdEncoding.EncodeToString(data)}
	}

	data, stderr, err := c.runAdb(deviceId, "exec-out", fmt.Sprintf("head -c %d -- %s", previewTextLimit, q))
	if err != nil {
		return FilePreview{Size: size, Error: adbError(data, stderr, err).Error()}
	}
	truncated := size > int64(len(data))
	if isBinary(data, truncated) {
		return FilePreview{Kind: "binary", Size: size}
	}
	return FilePreview{Kind: "text", Size: size, Content: string(data), Truncated: truncated}
}

func isBinary(data []byte, truncated bool) bool {
	if bytes.IndexByte(data, 0) >= 0 {
		return true
	}
	// 截断处可能落在多字节字符中间，校验前去掉末尾不完整的字符
	if truncated {
		for i := 0; i < utf8.UTFMax && len(data) > 0 && !utf8.Valid(data); i++ {
			data = data[:len(data)-1]
		}
	}
	return !utf8.Valid(data)
}

// Delete 删除设备文件或目录
func (c Client) Delete(deviceId string, remotePath string) types.ExecResult {
	cleaned := path.Clean(remotePath)
	if cleaned == "/" || cleaned == "." {
		return types.NewExecResultErrorString("rm", "不允许删除根目录")
	}

	script := "rm -rf -- " + shellQuote(cleaned)
	cmdLine := c.adbCmdLine(deviceId, "shell", script)
	stdout, stderr, err := c.runAdb(deviceId, "shell", script)
	if err != nil {
		applog.Warnf(applog.CategoryADB, "file_delete_failed device=%s path=%s err=%q", deviceId, cleaned, adbError(stdout, stderr, err).Error())
		return types.NewExecResultFromError(cmdLine, "", adbError(stdout, stderr, err))
	}
	applog.Infof(applog.CategoryADB, "file_deleted device=%s path=%s", deviceId, cleaned)
	return types.NewExecResultSuccess(cmdLine, strings.TrimSpace(string(stdout)))
}

// UploadWithDialog 选择本地文件上传到设备目录（adb push）
func (c Client) UploadWithDialog(deviceId string, remoteDir string) types.ExecResult {
	localPath, err := runtime.OpenFileDialog(c.Ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的文件",
	})
	if err != nil {
		return types.NewExecResultErrorString("upload", fmt.Sprintf("选择文件失败: %v", err))
	}
	if localPath == "" {
		return types.NewExecResultErrorString("upload", "已取消")
	}

	dest := remoteDir
	if dest == "" {
		dest = "/sdcard/"
	}
	if !strings.HasSuffix(dest, "/") {
		dest += "/"
	}

	cmdLine := c.adbCmdLine(deviceId, "push", localPath, dest)
	stdout, stderr, err := c.runAdb(deviceId, "push", localPath, dest)
	if err != nil {
		applog.Warnf(applog.CategoryADB, "file_upload_failed device=%s local=%s dest=%s err=%q", deviceId, localPath, dest, adbError(stdout, stderr, err).Error())
		return types.NewExecResultFromError(cmdLine, "", adbError(stdout, stderr, err))
	}
	applog.Infof(applog.CategoryADB, "file_uploaded device=%s local=%s dest=%s", deviceId, localPath, dest)
	return types.NewExecResultSuccess(cmdLine, strings.TrimSpace(string(stdout)))
}

// Upload 把本地文件或目录上传到设备目录（拖入文件管理时使用）
func (c Client) Upload(deviceId string, remoteDir string, localPaths []string) types.ExecResult {
	if len(localPaths) == 0 {
		return types.NewExecResultErrorString("upload", "没有要上传的文件")
	}
	dest := remoteDir
	if dest == "" {
		dest = "/sdcard/"
	}
	if !strings.HasSuffix(dest, "/") {
		dest += "/"
	}

	args := append(append([]string{"push"}, localPaths...), dest)
	cmdLine := c.adbCmdLine(deviceId, args...)
	stdout, stderr, err := c.runAdb(deviceId, args...)
	if err != nil {
		applog.Warnf(applog.CategoryADB, "file_upload_failed device=%s count=%d dest=%s err=%q", deviceId, len(localPaths), dest, adbError(stdout, stderr, err).Error())
		return types.NewExecResultFromError(cmdLine, "", adbError(stdout, stderr, err))
	}
	applog.Infof(applog.CategoryADB, "files_uploaded device=%s count=%d dest=%s", deviceId, len(localPaths), dest)
	return types.NewExecResultSuccess(cmdLine, strings.TrimSpace(string(stdout)))
}

// DownloadWithDialog 从设备下载文件或目录到本地（adb pull）
func (c Client) DownloadWithDialog(deviceId string, remotePath string) types.ExecResult {
	localPath, err := runtime.SaveFileDialog(c.Ctx, runtime.SaveDialogOptions{
		DefaultFilename: filepath.Base(remotePath),
		Title:           "保存到本地",
	})
	if err != nil {
		return types.NewExecResultErrorString("download", fmt.Sprintf("选择保存路径失败: %v", err))
	}
	if localPath == "" {
		return types.NewExecResultErrorString("download", "已取消")
	}

	cmdLine := c.adbCmdLine(deviceId, "pull", remotePath, localPath)
	stdout, stderr, err := c.runAdb(deviceId, "pull", remotePath, localPath)
	if err != nil {
		applog.Warnf(applog.CategoryADB, "file_download_failed device=%s path=%s err=%q", deviceId, remotePath, adbError(stdout, stderr, err).Error())
		return types.NewExecResultFromError(cmdLine, "", adbError(stdout, stderr, err))
	}
	applog.Infof(applog.CategoryADB, "file_downloaded device=%s path=%s local=%s", deviceId, remotePath, localPath)
	return types.NewExecResultSuccess(cmdLine, strings.TrimSpace(string(stdout)))
}
