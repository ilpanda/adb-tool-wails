package aya

import (
	"adb-tool-wails/internal/i18n"
	"errors"
	"os"
	"testing"
)

func TestClipboardWatchErrorFollowsLanguage(t *testing.T) {
	t.Cleanup(func() { i18n.SetLanguage("zh-CN") })
	err := errors.Join(clipboardStatusError("screen_state_unknown"), nil)
	i18n.SetLanguage("en")
	if err.Error() != "Could not determine whether this phone is locked" {
		t.Fatal(err)
	}
	i18n.SetLanguage("zh-CN")
	if err.Error() != "无法确认这台手机的锁屏状态" {
		t.Fatal(err)
	}
}

func TestExtractDexIsolatedPerAppInstance(t *testing.T) {
	extract := func(data string) string {
		t.Helper()
		path, err := ExtractDex([]byte(data))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.Remove(path) })
		return path
	}
	first := extract("first")
	if first == extract("second") {
		t.Fatal("app instances share a DEX file")
	}
	data, err := os.ReadFile(first)
	if err != nil || string(data) != "first" {
		t.Fatal("a second instance changed the first DEX", err)
	}
}
