package adb

import (
	"adb-tool-wails/internal/types"
	"strings"
)

func GetDeviceNameArray(adbPath string) []string {
	devicesRes := Devices(adbPath)
	var devices []string
	if devicesRes.Error == "" {
		devices = GetDevices(devicesRes.Res, devices)
	}
	return devices
}

func GetDeviceNameByDeviceId(adbPath string, deviceId string) string {
	cmd := ShellCommand(adbPath, deviceId, "getprop ro.product.model")
	execResult := Exec(cmd)
	if execResult.Error != "" {
		return execResult.Error
	}
	return strings.TrimSpace(execResult.Res)
}

func GetDevices(data string, devices []string) []string {
	lines := strings.Split(data, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.Contains(line, "List of devices") || strings.Contains(line, "unauthorized") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) == 2 {
			devices = append(devices, fields[0])
		}
	}
	return devices
}

func Devices(adbPath string) types.ExecResult {
	cmd := Command(adbPath, "", "devices")
	return Exec(cmd)
}
