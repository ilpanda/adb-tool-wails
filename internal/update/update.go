// Package update 查询 GitHub Releases 判断是否有新版本，并在应用内下载、安装新版本。
package update

import (
	"adb-tool-wails/internal/applog"
	"encoding/json"
	"fmt"
	"net/http"
	goruntime "runtime"
	"strconv"
	"strings"
	"time"
)

const (
	latestReleaseAPI = "https://api.github.com/repos/ilpanda/adb-tool-wails/releases/latest"
	releasesPage     = "https://github.com/ilpanda/adb-tool-wails/releases"
)

// Info 版本检查结果
type Info struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	HasUpdate   bool   `json:"hasUpdate"`
	URL         string `json:"url"`
	Notes       string `json:"notes"`
	PublishedAt string `json:"publishedAt"`
	// CanInstall 发布中有当前平台的安装包，可在应用内下载并更新
	CanInstall bool   `json:"canInstall"`
	Error      string `json:"error,omitempty"`

	asset releaseAsset
}

// releaseAsset 当前平台对应的发布文件
type releaseAsset struct {
	Name   string `json:"name"`
	URL    string `json:"browser_download_url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"` // 形如 sha256:<hex>
}

// platformAssetName 各平台在 Release 中的安装包名，与 .github/workflows/release.yml 的打包产物一致
func platformAssetName() string {
	switch {
	case goruntime.GOOS == "darwin":
		return "adb-tool-macos-universal.tar.gz"
	case goruntime.GOOS == "linux" && goruntime.GOARCH == "amd64":
		return "adb-tool-linux-amd64.tar.gz"
	case goruntime.GOOS == "windows" && goruntime.GOARCH == "amd64":
		return "adb-tool-windows-amd64-installer.zip"
	}
	return ""
}

// latestRelease Releases API 返回的最新发布
type latestRelease struct {
	TagName     string         `json:"tag_name"`
	HTMLURL     string         `json:"html_url"`
	Body        string         `json:"body"`
	PublishedAt string         `json:"published_at"`
	Assets      []releaseAsset `json:"assets"`
}

// Check 查询 GitHub Releases 的最新版本；开发版本（devBuild）只返回最新版本号，不提示更新
func Check(current string, devBuild bool) Info {
	info := Info{Current: current}
	release, err := fetchLatestRelease(current)
	if err != nil {
		// API 未登录时每个 IP 每小时限 60 次，共用出口 IP 的代理很容易超限；连接失败时也再试一次发布页
		applog.Warnf(applog.CategoryStartup, "update_api_failed err=%q", err.Error())
		fallback, fallbackErr := latestReleaseFromRedirect(current)
		if fallbackErr != nil {
			info.Error = err.Error()
			return info
		}
		release = fallback
	}

	info.Latest = release.TagName
	info.URL = release.HTMLURL
	info.Notes = release.Body
	info.PublishedAt = release.PublishedAt
	info.HasUpdate = !devBuild && compareVersions(release.TagName, current) > 0
	if name := platformAssetName(); name != "" {
		for _, asset := range release.Assets {
			if asset.Name == name {
				info.asset = asset
				info.CanInstall = info.HasUpdate
				break
			}
		}
	}
	applog.Infof(applog.CategoryStartup, "update_checked current=%s latest=%s has_update=%t", current, release.TagName, info.HasUpdate)
	return info
}

// fetchLatestRelease 通过 Releases API 查询最新发布，网络错误时重试一次
func fetchLatestRelease(current string) (*latestRelease, error) {
	client := newHTTPClient()
	client.Timeout = 15 * time.Second
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Second)
		}
		req, err := http.NewRequest(http.MethodGet, latestReleaseAPI, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/vnd.github+json")
		req.Header.Set("User-Agent", "adb-tool-wails/"+current)
		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("无法连接 GitHub：%w", err)
			continue
		}
		var release latestRelease
		if resp.StatusCode == http.StatusOK {
			err = json.NewDecoder(resp.Body).Decode(&release)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("GitHub 返回 %d", resp.StatusCode)
		}
		if err != nil {
			return nil, fmt.Errorf("解析版本信息失败：%w", err)
		}
		return &release, nil
	}
	return nil, lastErr
}

// latestReleaseFromRedirect 从发布页 /releases/latest 的跳转地址取得最新版本号，按 Release 的命名规则拼出安装包地址。
// 这条路不受 API 限流影响，但拿不到安装包的大小与 sha256，下载后靠 gzip / zip 自带的 CRC 校验发现损坏
func latestReleaseFromRedirect(current string) (*latestRelease, error) {
	client := newHTTPClient()
	client.Timeout = 15 * time.Second
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	req, err := http.NewRequest(http.MethodHead, releasesPage+"/latest", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "adb-tool-wails/"+current)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	location := resp.Header.Get("Location")
	_, tag, ok := strings.Cut(location, "/releases/tag/")
	if !ok || tag == "" {
		return nil, fmt.Errorf("发布页返回 %d，没有跳转到最新版本", resp.StatusCode)
	}

	release := &latestRelease{TagName: tag, HTMLURL: releasesPage + "/tag/" + tag}
	if name := platformAssetName(); name != "" {
		release.Assets = []releaseAsset{{Name: name, URL: releasesPage + "/download/" + tag + "/" + name}}
	}
	return release, nil
}

// compareVersions 比较 v1.2.3 形式的版本号，忽略前缀 v 与预发布后缀
func compareVersions(a, b string) int {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func versionParts(v string) [3]int {
	var parts [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if idx := strings.IndexAny(v, "-+"); idx >= 0 {
		v = v[:idx]
	}
	for i, field := range strings.SplitN(v, ".", 3) {
		parts[i], _ = strconv.Atoi(field)
	}
	return parts
}
