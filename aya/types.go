package aya

import (
	"fmt"
	"time"
)

type PackageInfo struct {
	PackageName      string   `json:"packageName"`
	Label            string   `json:"label"`
	Icon             string   `json:"icon"` // Base64 data URL
	VersionName      string   `json:"versionName"`
	VersionCode      int      `json:"versionCode"`
	FirstInstallTime int64    `json:"firstInstallTime"`
	LastUpdateTime   int64    `json:"lastUpdateTime"`
	ApkPath          string   `json:"apkPath"`
	ApkSize          int64    `json:"apkSize"`
	AppSize          int64    `json:"appSize"`
	DataSize         int64    `json:"dataSize"`
	CacheSize        int64    `json:"cacheSize"`
	Enabled          bool     `json:"enabled"`
	System           bool     `json:"system"`
	MinSdkVersion    int      `json:"minSdkVersion"`
	TargetSdkVersion int      `json:"targetSdkVersion"`
	Signatures       []string `json:"signatures"`
}

func (p *PackageInfo) GetFirstInstallTimeFormatted() string {
	return time.Unix(p.FirstInstallTime/1000, 0).Format("2006-01-02 15:04:05")
}

func (p *PackageInfo) GetLastUpdateTimeFormatted() string {
	return time.Unix(p.LastUpdateTime/1000, 0).Format("2006-01-02 15:04:05")
}

func (p *PackageInfo) FormatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
