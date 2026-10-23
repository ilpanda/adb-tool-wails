package update

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// 从 Finder / 开始菜单启动的应用拿不到终端里的 *_PROXY 环境变量，Go 也不读系统代理设置。
// 国内用户通常靠系统代理（如 Clash 的系统代理模式）访问 GitHub，这里在没有环境变量时读取系统代理

var (
	proxyOnce sync.Once
	sysProxy  *url.URL
)

// proxyFor 优先使用环境变量中的代理，其次使用系统代理
func proxyFor(req *http.Request) (*url.URL, error) {
	if proxy, err := http.ProxyFromEnvironment(req); proxy != nil || err != nil {
		return proxy, err
	}
	proxyOnce.Do(func() { sysProxy = systemProxy() })
	return sysProxy, nil
}

// newHTTPClient 访问 GitHub 用的客户端。不设整体超时：下载大小与网速不定，卡住由下载侧的无数据超时判断
func newHTTPClient() *http.Client {
	return &http.Client{Transport: &http.Transport{
		Proxy:                 proxyFor,
		DialContext:           (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 30 * time.Second,
		ForceAttemptHTTP2:     true,
	}}
}

// parseProxyAddr 解析 host:port 形式的代理地址
func parseProxyAddr(addr string) *url.URL {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return nil
	}
	if !strings.Contains(addr, "://") {
		addr = "http://" + addr
	}
	proxy, err := url.Parse(addr)
	if err != nil || proxy.Host == "" {
		return nil
	}
	return proxy
}
