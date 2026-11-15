// Package i18n localizes application-owned messages. Device command output is
// deliberately left intact. The frontend synchronizes the resolved language
// before mounting the application and whenever the user's preference changes.
package i18n

import (
	_ "embed"
	"encoding/json"
	"sync/atomic"
)

//go:embed en.json
var catalog []byte
var english map[string]string
var useEnglish atomic.Bool

func init() {
	if err := json.Unmarshal(catalog, &english); err != nil {
		panic(err)
	}
}

func SetLanguage(locale string) {
	useEnglish.Store(locale != "zh-CN")
}

func T(source string) string {
	if useEnglish.Load() {
		if translated, ok := english[source]; ok {
			return translated
		}
	}
	return source
}
