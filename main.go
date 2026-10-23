package main

import (
	"adb-tool-wails/internal/applog"
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

// Version 版本号，通过编译时 -ldflags 注入
var Version = "dev"

//go:embed all:frontend/dist
var assets embed.FS

//go:embed resources/aya.dex
var ayaDexData []byte

func main() {
	mirrorStdout := IsDebugBuild()
	logManager, err := applog.NewManager("adb-tool-wails", mirrorStdout)
	if err != nil {
		println("failed to initialize log manager:", err.Error())
	} else {
		applog.Infof(applog.CategoryStartup, "logger_ready dir=%s mirror_stdout=%t", logManager.Directory(), mirrorStdout)
	}

	// Create an instance of the app structure
	app := NewApp(logManager)
	applog.Infof(applog.CategoryStartup, "app_bootstrap version=%s os=%s arch=%s", Version, goruntime.GOOS, goruntime.GOARCH)

	// Create application with options
	err = wails.Run(&options.App{
		Title:  "adb-tool-wails",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// 拖入文件：APK 安装、文件管理上传；关闭 WebView 自身的拖放，避免拖入文件时页面被替换
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		applog.Errorf(applog.CategoryStartup, "app_start_failed err=%q", err.Error())
	}
}
