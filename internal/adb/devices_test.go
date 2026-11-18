package adb

import (
	"slices"
	"testing"
)

func TestGetDevicesSelectsOnlyOnlineTransports(t *testing.T) {
	output := "List of devices attached\r\nold\toffline\r\nnew\tunauthorized\r\n" +
		"boot\trecovery\r\nphone\tdevice\r\n127.0.0.1:5555\tdevice\r\n\r\n"
	if got := GetDevices(output, nil); !slices.Equal(got, []string{"phone", "127.0.0.1:5555"}) {
		t.Fatalf("unexpected selectable devices: %v", got)
	}
}
