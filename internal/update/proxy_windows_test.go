package update

import "testing"

func TestParseWindowsProxy(t *testing.T) {
	cases := map[string]string{
		"127.0.0.1:7890": "http://127.0.0.1:7890",
		"http=127.0.0.1:7890;https=127.0.0.1:7891": "http://127.0.0.1:7891",
		"http=127.0.0.1:7890":                      "http://127.0.0.1:7890",
	}
	for server, want := range cases {
		if proxy := parseWindowsProxy(server); proxy == nil || proxy.String() != want {
			t.Errorf("parseWindowsProxy(%q) = %v, want %s", server, proxy, want)
		}
	}
}
