//go:build !windows

package util

func normalizeCommandOutput(data []byte) string {
	return string(data)
}
