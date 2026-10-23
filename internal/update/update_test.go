package update

import "testing"

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.5.0", "v1.4.3", 1},
		{"v1.4.3", "1.4.3", 0},
		{"v1.4.10", "v1.4.9", 1},
		{"v1.5.0", "v1.10.0", -1},
		{"v2.0.0-beta.1", "v1.9.9", 1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}
