//go:build !darwin && !windows

package update

import "net/url"

// systemProxy Linux 桌面的代理设置没有统一来源，只使用环境变量
func systemProxy() *url.URL {
	return nil
}
