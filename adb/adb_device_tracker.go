package adb

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type DeviceInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type DeviceUpdateCallback func(devices []DeviceInfo)

type DeviceTracker struct {
	knownDevices map[string]string
	callback     DeviceUpdateCallback
	AdbPath      string
}

func NewDeviceTracker(adbPath string, callback DeviceUpdateCallback) *DeviceTracker {
	return &DeviceTracker{
		knownDevices: make(map[string]string),
		callback:     callback,
		AdbPath:      adbPath,
	}
}

func (dt *DeviceTracker) Start(ctx context.Context) {
	dt.printMsg("DeviceTracker: Service started.")

	for {
		select {
		case <-ctx.Done():
			dt.printMsg("DeviceTracker: Stopping due to context cancellation.")
			return
		default:
		}

		dt.printMsg("DeviceTracker: Attempting to start a new adb track-devices connection...")
		dt.runTrackDevices(ctx)

		dt.printMsg("DeviceTracker: Connection lost. Clearing device list.")
		dt.updateDevices([]string{})

		dt.printMsg("DeviceTracker: Waiting 3 seconds before reconnecting...")
		select {
		case <-ctx.Done():
			dt.printMsg("DeviceTracker: Stopping during sleep.")
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (dt *DeviceTracker) runTrackDevices(ctx context.Context) {
	cmd := exec.CommandContext(ctx, dt.AdbPath, "track-devices")

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		dt.printMsg("runTrackDevices: Failed to get stdout pipe: %v\n", err)
		return
	}

	if err := cmd.Start(); err != nil {
		dt.printMsg("runTrackDevices: Failed to start adb command: %v\n", err)
		return
	}
	dt.printMsg("runTrackDevices: adb process started with PID %d.\n", cmd.Process.Pid)

	go dt.readDeviceUpdates(stdout)

	dt.printMsg("runTrackDevices: Now waiting for adb process to exit...")
	err = cmd.Wait()
	if err != nil {
		dt.printMsg("runTrackDevices: adb process exited with an error: %v\n", err)
	} else {
		dt.printMsg("runTrackDevices: adb process exited cleanly.")
	}
}

func (dt *DeviceTracker) readDeviceUpdates(stdout io.Reader) {
	dt.printMsg("readDeviceUpdates: Goroutine started, listening for device updates.")
	reader := bufio.NewReader(stdout)

	for {
		lengthBytes := make([]byte, 4)
		dt.printMsg("readDeviceUpdates: Waiting to read data length...")
		_, err := io.ReadFull(reader, lengthBytes)
		if err != nil {
			dt.printMsg("readDeviceUpdates: Failed to read length, connection likely lost. Error: %v. Goroutine is terminating.\n", err)
			return
		}

		length, err := strconv.ParseInt(string(lengthBytes), 16, 32)
		if err != nil {
			dt.printMsg("readDeviceUpdates: Failed to parse length from '%s'. Error: %v. Skipping.\n", string(lengthBytes), err)
			continue
		}

		dt.printMsg("readDeviceUpdates: Received data length: %d\n", length)

		if length == 0 {
			dt.printMsg("readDeviceUpdates: Received empty device list.")
			dt.updateDevices([]string{})
			continue
		}

		data := make([]byte, length)
		_, err = io.ReadFull(reader, data)
		if err != nil {
			dt.printMsg("readDeviceUpdates: Failed to read data payload. Error: %v. Goroutine is terminating.\n", err)
			return
		}

		deviceListStr := string(data)
		var devices []string
		devices = GetDevices(deviceListStr, devices)

		dt.printMsg("readDeviceUpdates: Device list updated: %v\n", devices)
		dt.updateDevices(devices)
	}
}

func (dt *DeviceTracker) updateDevices(devs []string) {
	deviceInfos := []DeviceInfo{}

	for _, deviceId := range devs {
		if name, exists := dt.knownDevices[deviceId]; exists {
			deviceInfos = append(deviceInfos, DeviceInfo{
				ID:   deviceId,
				Name: name,
			})
		} else {

			name := GetDeviceNameByDeviceId(dt.AdbPath, deviceId)

			// 首次失败，1.5s 后重试一次
			if name == "" || strings.Contains(name, "authorizing") || strings.Contains(name, "unauthorized") || strings.Contains(name, "offline") {
				time.Sleep(1500 * time.Millisecond)
				name = GetDeviceNameByDeviceId(dt.AdbPath, deviceId)
			}

			// 判断最终结果
			if name != "" && !strings.Contains(name, "authorizing") && !strings.Contains(name, "unauthorized") && !strings.Contains(name, "offline") {
				dt.knownDevices[deviceId] = strings.TrimSpace(name)
				deviceInfos = append(deviceInfos, DeviceInfo{
					ID:   deviceId,
					Name: strings.TrimSpace(name),
				})
			}
		}
	}

	if dt.callback != nil {
		dt.callback(deviceInfos)
	}
}

func (dt *DeviceTracker) printMsg(format string, v ...any) {
	logEnable := false
	if logEnable {
		println(fmt.Sprintln(format, v))
	}
}
