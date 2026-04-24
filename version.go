package main

import "strings"

const debugVersion = "dev"

func IsDebugBuild() bool {
	return strings.TrimSpace(Version) == debugVersion
}
