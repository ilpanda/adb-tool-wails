// Package update 查询 GitHub Releases 判断是否有新版本。
package update

import (
	"adb-tool-wails/internal/applog"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const latestReleaseAPI = "https://api.github.com/repos/ilpanda/adb-tool-wails/releases/latest"

// Info 版本检查结果
type Info struct {
	Current     string `json:"current"`
	Latest      string `json:"latest"`
	HasUpdate   bool   `json:"hasUpdate"`
	URL         string `json:"url"`
	Notes       string `json:"notes"`
	PublishedAt string `json:"publishedAt"`
	Error       string `json:"error,omitempty"`
}

// Check 查询 GitHub Releases 的最新版本；开发版本（devBuild）只返回最新版本号，不提示更新
func Check(current string, devBuild bool) Info {
	info := Info{Current: current}
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest(http.MethodGet, latestReleaseAPI, nil)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "adb-tool-wails/"+current)

	resp, err := client.Do(req)
	if err != nil {
		info.Error = "无法连接 GitHub：" + err.Error()
		return info
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		info.Error = fmt.Sprintf("GitHub 返回 %d", resp.StatusCode)
		return info
	}

	var release struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		info.Error = "解析版本信息失败：" + err.Error()
		return info
	}
	info.Latest = release.TagName
	info.URL = release.HTMLURL
	info.Notes = release.Body
	info.PublishedAt = release.PublishedAt
	info.HasUpdate = !devBuild && compareVersions(release.TagName, current) > 0
	applog.Infof(applog.CategoryStartup, "update_checked current=%s latest=%s has_update=%t", current, release.TagName, info.HasUpdate)
	return info
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
