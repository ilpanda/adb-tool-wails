package main

import (
	"embed"
	"os"
	"path/filepath"
	runtime "runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func setupEnv() {
	if runtime.GOOS == "darwin" {
		homeDir, _ := os.UserHomeDir()
		additionalPaths := []string{
			"/usr/local/bin",    // Homebrew (Intel)
			"/opt/homebrew/bin", // Homebrew (Apple Silicon)
			filepath.Join(homeDir, "Library/Android/sdk/platform-tools"), // Android SDK
			filepath.Join(homeDir, ".local/bin"),                         // 用户本地二进制
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
		}
		newPath := strings.Join(additionalPaths, ":")
		os.Setenv("PATH", newPath)
	}
}

func main() {
	setupEnv()
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "adb-tool-wails",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
