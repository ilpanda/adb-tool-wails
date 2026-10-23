package main

import (
	"adb-tool-wails/internal/files"
	"adb-tool-wails/internal/types"
)

// 文件管理：逻辑在 internal/files，这里只做转发

func (a *App) files() files.Client {
	return files.Client{Ctx: a.ctx, AdbPath: a.adbBinary()}
}

// ListDirectory 列出设备目录内容
func (a *App) ListDirectory(deviceId string, dir string) files.DirListing {
	return a.files().List(deviceId, dir)
}

// PreviewFile 读取设备文件用于预览
func (a *App) PreviewFile(deviceId string, remotePath string) files.FilePreview {
	return a.files().Preview(deviceId, remotePath)
}

// DeleteRemoteFile 删除设备上的文件或目录
func (a *App) DeleteRemoteFile(deviceId string, remotePath string) types.ExecResult {
	return a.files().Delete(deviceId, remotePath)
}

// UploadFile 选择本地文件上传到设备目录
func (a *App) UploadFile(deviceId string, remoteDir string) types.ExecResult {
	return a.files().UploadWithDialog(deviceId, remoteDir)
}

// UploadLocalFiles 把本地文件或目录上传到设备目录（拖入文件管理时使用）
func (a *App) UploadLocalFiles(deviceId string, remoteDir string, localPaths []string) types.ExecResult {
	return a.files().Upload(deviceId, remoteDir, localPaths)
}

// DownloadFile 从设备下载文件或目录到本地
func (a *App) DownloadFile(deviceId string, remotePath string) types.ExecResult {
	return a.files().DownloadWithDialog(deviceId, remotePath)
}
