package util

import (
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func normalizeCommandOutput(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	if utf8.Valid(data) {
		return string(data)
	}
	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(data)
	if err != nil {
		return string(data)
	}
	return string(decoded)
}
