package update

import "testing"

func TestParseScutilProxy(t *testing.T) {
	out := `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
}`
	if proxy := parseScutilProxy(out); proxy == nil || proxy.String() != "http://127.0.0.1:7891" {
		t.Fatalf("proxy = %v", proxy)
	}
	if proxy := parseScutilProxy("<dictionary> {\n  HTTPEnable : 0\n}"); proxy != nil {
		t.Fatalf("expected no proxy, got %v", proxy)
	}
}
