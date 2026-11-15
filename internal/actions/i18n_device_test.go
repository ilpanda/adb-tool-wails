package actions

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/i18n"
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Optional read-only integration check against an explicitly selected device.
func TestDeviceInfoTranslations(t *testing.T) {
	serial := os.Getenv("ADB_I18N_TEST_DEVICE")
	if serial == "" {
		t.Skip("set ADB_I18N_TEST_DEVICE for the read-only device integration check")
	}
	binary, err := exec.LookPath("adb")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { i18n.SetLanguage("zh-CN") })
	for _, tc := range []struct{ locale, label string }{{"en", "CPU model:"}, {"zh-CN", "CPU 型号:"}} {
		i18n.SetLanguage(tc.locale)
		result := GetDeviceInfo(adb.ExecuteParams{Ctxt: context.Background(), AdbPath: binary, DeviceId: serial})
		if result.Error != "" {
			t.Fatal(result.Error)
		}
		if !strings.Contains(result.Res, tc.label) {
			t.Fatalf("missing localized field for %s", tc.locale)
		}
		if strings.Contains(result.Res, "%!") {
			t.Fatal("invalid printf formatting in device information")
		}
	}
}
