package main

import (
	"adb-tool-wails/internal/applog"
	"adb-tool-wails/internal/types"
	"fmt"
	"os/exec"
	goruntime "runtime"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 诊断日志：查看、导出与清理应用自身的运行日志

func (a *App) LogMsg(msg string) {
	applog.Infof(applog.CategoryLog, "%s", msg)
}

func (a *App) GetLogStatus() applog.StatusDTO {
	if a.logManager == nil {
		return applog.StatusDTO{}
	}

	status, err := a.logManager.Status()
	if err != nil {
		applog.Warnf(applog.CategoryLog, "log_status_failed err=%q", err.Error())
		return applog.StatusDTO{}
	}

	return applog.StatusDTO{
		Directory:   status.Directory,
		CurrentFile: status.CurrentFile,
		CurrentSize: status.CurrentSize,
		FileCount:   status.FileCount,
		TotalSize:   status.TotalSize,
	}
}

func (a *App) ListLogFiles() []applog.FileDTO {
	if a.logManager == nil {
		return []applog.FileDTO{}
	}

	files, err := a.logManager.ListFiles()
	if err != nil {
		applog.Warnf(applog.CategoryLog, "log_list_failed err=%q", err.Error())
		return []applog.FileDTO{}
	}

	result := make([]applog.FileDTO, 0, len(files))
	for _, file := range files {
		result = append(result, applog.FileDTO{
			Name:       file.Name,
			Size:       file.Size,
			ModifiedAt: file.Modified.Format(time.RFC3339),
			IsCurrent:  file.IsCurrent,
		})
	}

	return result
}

func (a *App) ReadLogChunk(fileName string, cursor int64, maxBytes int64) (applog.ChunkDTO, error) {
	if a.logManager == nil {
		return applog.ChunkDTO{}, fmt.Errorf("log manager is not initialized")
	}

	chunk, err := a.logManager.ReadChunk(fileName, cursor, maxBytes)
	if err != nil {
		return applog.ChunkDTO{}, err
	}

	return applog.ChunkDTO{
		FileName:   chunk.FileName,
		Content:    chunk.Content,
		NextCursor: chunk.NextCursor,
		HasMore:    chunk.HasMore,
		FileSize:   chunk.FileSize,
	}, nil
}

func (a *App) ExportLogs() types.ExecResult {
	if a.logManager == nil {
		return types.NewExecResultErrorString("export_logs", "日志管理器未初始化")
	}

	savePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: fmt.Sprintf("adb-tool-wails-logs-%s.zip", time.Now().Format("20060102-150405")),
		Title:           "导出日志",
	})
	if err != nil {
		return types.NewExecResultErrorString("export_logs", fmt.Sprintf("选择导出路径失败: %v", err))
	}
	if savePath == "" {
		return types.NewExecResultErrorString("export_logs", "已取消")
	}

	if err := a.logManager.ExportZip(savePath); err != nil {
		applog.Warnf(applog.CategoryLog, "log_export_failed path=%s err=%q", savePath, err.Error())
		return types.NewExecResultErrorString("export_logs", err.Error())
	}
	applog.Infof(applog.CategoryLog, "log_exported path=%s", savePath)

	return types.NewExecResultSuccess("export_logs", savePath)
}

func (a *App) ClearLogFile(fileName string) types.ExecResult {
	if a.logManager == nil {
		return types.NewExecResultErrorString("clear_log_file", "日志管理器未初始化")
	}

	if err := a.logManager.ClearFile(fileName); err != nil {
		applog.Warnf(applog.CategoryLog, "log_clear_failed file=%s err=%q", fileName, err.Error())
		return types.NewExecResultErrorString("clear_log_file", err.Error())
	}

	return types.NewExecResultSuccess("clear_log_file", fileName)
}

func (a *App) OpenLogDirectory() types.ExecResult {
	if a.logManager == nil {
		return types.NewExecResultErrorString("open_log_directory", "日志目录不可用")
	}

	logDir := a.logManager.Directory()
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", logDir)
	case "darwin":
		cmd = exec.Command("open", logDir)
	default:
		cmd = exec.Command("xdg-open", logDir)
	}

	if err := cmd.Start(); err != nil {
		applog.Warnf(applog.CategoryLog, "log_directory_open_failed path=%s err=%q", logDir, err.Error())
		return types.NewExecResultError("open_log_directory", err)
	}
	applog.Infof(applog.CategoryLog, "log_directory_opened path=%s", logDir)

	return types.NewExecResultSuccess("open_log_directory", logDir)
}
