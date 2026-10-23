package util

import (
	"strings"
)

// MultiLine splits a string by newlines
func MultiLine(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
}
