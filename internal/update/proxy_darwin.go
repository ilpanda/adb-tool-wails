package update

import (
	"net"
	"net/url"
	"os/exec"
	"strings"
)

// systemProxy 读取「系统设置 → 网络 → 代理」中的 HTTPS 代理，其次 HTTP 代理
func systemProxy() *url.URL {
	out, err := exec.Command("scutil", "--proxy").Output()
	if err != nil {
		return nil
	}
	return parseScutilProxy(string(out))
}

func parseScutilProxy(out string) *url.URL {
	values := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(line, " : ")
		if ok {
			values[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	for _, scheme := range []string{"HTTPS", "HTTP"} {
		if values[scheme+"Enable"] == "1" && values[scheme+"Proxy"] != "" {
			return parseProxyAddr(net.JoinHostPort(values[scheme+"Proxy"], values[scheme+"Port"]))
		}
	}
	return nil
}
