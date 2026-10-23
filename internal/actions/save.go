package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/types"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// 保存文件：弹出保存对话框并写入结果

// 预定义配置
var (
	SaveConfigTxt = SaveFileConfig{
		Extension:     ".txt",
		FilterDisplay: "文本文件 (*.txt)",
		FilterPattern: "*.txt",
	}
	SaveConfigCsv = SaveFileConfig{
		Extension:     ".csv",
		FilterDisplay: "CSV 文件 (*.csv)",
		FilterPattern: "*.csv",
	}
	SaveConfigJson = SaveFileConfig{
		Extension:     ".json",
		FilterDisplay: "JSON 文件 (*.json)",
		FilterPattern: "*.json",
	}
)

// SaveFileOptions 保存文件的选项
type SaveFileOptions struct {
	Ctxt          context.Context
	OnStage       func(stage string)
	FilePrefix    string // 文件名前缀，如 "smaps", "debuggerd"
	DialogTitle   string // 对话框标题
	FileExtension string // 文件扩展名，如 ".txt"
	FilterDisplay string // 过滤器显示名，如 "文本文件 (*.txt)"
	FilterPattern string // 过滤器模式，如 "*.txt"
}

// SaveFileResult 保存文件的中间结果
type SaveFileResult struct {
	SavePath string
	Canceled bool
	Error    types.ExecResult
}

// PrepareFileSave 准备文件保存，返回用户选择的保存路径
func PrepareFileSave(opts SaveFileOptions) SaveFileResult {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	desktopDir := filepath.Join(homeDir, "Desktop")

	// 确保桌面目录存在，如果不存在则使用主目录
	if _, err := os.Stat(desktopDir); os.IsNotExist(err) {
		desktopDir = homeDir
	}

	timestamp := time.Now().Format("2006_01_02_15_04_05")
	saveFileName := fmt.Sprintf("%s_%s%s", timestamp, opts.FilePrefix, opts.FileExtension)

	if opts.OnStage != nil {
		opts.OnStage(adb.StageDialog)
	}
	savePath, _ := runtime.SaveFileDialog(opts.Ctxt, runtime.SaveDialogOptions{
		DefaultDirectory: desktopDir,
		DefaultFilename:  saveFileName,
		Title:            opts.DialogTitle,
		Filters: []runtime.FileFilter{
			{DisplayName: opts.FilterDisplay, Pattern: opts.FilterPattern},
		},
	})
	if opts.OnStage != nil {
		opts.OnStage(adb.StageRunning)
	}

	if savePath == "" {
		return SaveFileResult{Canceled: true}
	}

	return SaveFileResult{SavePath: savePath}
}

// writeResultToFile 将执行结果写入文件
func writeResultToFile(savePath string, content string, cmd string) types.ExecResult {
	err := os.WriteFile(savePath, []byte(content), 0644)
	if err != nil {
		return types.NewExecResultError(cmd, err)
	}
	result := types.NewExecResultSuccess(cmd, fmt.Sprintf("已保存到: %s", savePath))
	result.LocalPath = savePath
	return result
}

type SaveFileConfig struct {
	Extension     string // ".txt", ".csv", ".json" 等
	FilterDisplay string // "CSV 文件 (*.csv)"
	FilterPattern string // "*.csv"
}

func SaveFile(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string) types.ExecResult {
	return saveFileAs(Ctxt, content, fileNamePrefix, dialogTitle, SaveConfigTxt)
}

func SaveFileAsCSV(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string) types.ExecResult {
	return saveFileAs(Ctxt, content, fileNamePrefix, dialogTitle, SaveConfigCsv)
}

func saveFileAs(Ctxt context.Context, content string, fileNamePrefix string, dialogTitle string, config SaveFileConfig) types.ExecResult {
	saveResult := PrepareFileSave(SaveFileOptions{
		Ctxt:          Ctxt,
		FilePrefix:    fileNamePrefix,
		DialogTitle:   dialogTitle,
		FileExtension: config.Extension,
		FilterDisplay: config.FilterDisplay,
		FilterPattern: config.FilterPattern,
	})

	if saveResult.Canceled {
		return types.NewExecResultCanceled("", "用户取消保存")
	}
	return writeResultToFile(saveResult.SavePath, content, "")
}
