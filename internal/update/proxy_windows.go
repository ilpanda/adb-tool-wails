package update

import (
	"net/url"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// systemProxy 读取「设置 → 网络和 Internet → 代理」中的手动代理
func systemProxy() *url.URL {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer key.Close()
	if enabled, _, err := key.GetIntegerValue("ProxyEnable"); err != nil || enabled == 0 {
		return nil
	}
	server, _, err := key.GetStringValue("ProxyServer")
	if err != nil {
		return nil
	}
	return parseWindowsProxy(server)
}

// parseWindowsProxy 解析 ProxyServer：可能是 host:port，也可能是 http=host:port;https=host:port
func parseWindowsProxy(server string) *url.URL {
	if !strings.Contains(server, "=") {
		return parseProxyAddr(server)
	}
	byScheme := map[string]string{}
	for _, part := range strings.Split(server, ";") {
		if scheme, addr, ok := strings.Cut(part, "="); ok {
			byScheme[strings.ToLower(strings.TrimSpace(scheme))] = addr
		}
	}
	for _, scheme := range []string{"https", "http"} {
		if addr := byScheme[scheme]; addr != "" {
			return parseProxyAddr(addr)
		}
	}
	return nil
}
