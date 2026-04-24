package adb

import (
	"adb-tool-wails/applog"
	"adb-tool-wails/util"
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
	knownStates  map[string]string
	callback     DeviceUpdateCallback
	AdbPath      string
}

func NewDeviceTracker(adbPath string, callback DeviceUpdateCallback) *DeviceTracker {
	return &DeviceTracker{
		knownDevices: make(map[string]string),
		knownStates:  make(map[string]string),
		callback:     callback,
		AdbPath:      adbPath,
	}
}

func (dt *DeviceTracker) Start(ctx context.Context) {
	applog.Infof(applog.CategoryADB, "device_tracker_loop_started adb_path=%s", dt.AdbPath)

	for {
		select {
		case <-ctx.Done():
			applog.Infof(applog.CategoryADB, "device_tracker_stopped reason=context_cancelled")
			return
		default:
		}

		applog.Infof(applog.CategoryADB, "track_devices_connecting adb_path=%s", dt.AdbPath)
		dt.runTrackDevices(ctx)

		applog.Warnf(applog.CategoryADB, "track_devices_connection_lost")
		dt.updateDevices(map[string]string{})

		applog.Infof(applog.CategoryADB, "track_devices_reconnect_wait delay_ms=3000")
		select {
		case <-ctx.Done():
			applog.Infof(applog.CategoryADB, "device_tracker_stopped reason=context_cancelled")
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (dt *DeviceTracker) runTrackDevices(ctx context.Context) {
	cmd := exec.CommandContext(ctx, dt.AdbPath, "track-devices")
	util.ConfigureCommand(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		applog.Errorf(applog.CategoryADB, "track_devices_stdout_pipe_failed err=%q", err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		applog.Errorf(applog.CategoryADB, "track_devices_start_failed err=%q", err.Error())
		return
	}
	applog.Infof(applog.CategoryADB, "track_devices_started pid=%d", cmd.Process.Pid)

	go dt.readDeviceUpdates(stdout)

	err = cmd.Wait()
	if err != nil {
		applog.Warnf(applog.CategoryADB, "track_devices_exited_with_error err=%q", err.Error())
	} else {
		applog.Infof(applog.CategoryADB, "track_devices_exited_cleanly")
	}
}

func (dt *DeviceTracker) readDeviceUpdates(stdout io.Reader) {
	reader := bufio.NewReader(stdout)

	for {
		lengthBytes := make([]byte, 4)
		_, err := io.ReadFull(reader, lengthBytes)
		if err != nil {
			applog.Warnf(applog.CategoryADB, "track_devices_read_length_failed err=%q", err.Error())
			return
		}

		length, err := strconv.ParseInt(string(lengthBytes), 16, 32)
		if err != nil {
			applog.Warnf(applog.CategoryADB, "track_devices_parse_length_failed raw=%q err=%q", string(lengthBytes), err.Error())
			continue
		}

		if length == 0 {
			dt.updateDevices(map[string]string{})
			continue
		}

		data := make([]byte, length)
		_, err = io.ReadFull(reader, data)
		if err != nil {
			applog.Warnf(applog.CategoryADB, "track_devices_read_payload_failed err=%q", err.Error())
			return
		}

		dt.updateDevices(parseDeviceStates(string(data)))
	}
}

func (dt *DeviceTracker) updateDevices(deviceStates map[string]string) {
	dt.logStateChanges(deviceStates)

	deviceInfos := []DeviceInfo{}
	for knownID := range dt.knownDevices {
		if _, ok := deviceStates[knownID]; !ok {
			delete(dt.knownDevices, knownID)
		}
	}

	for deviceId, state := range deviceStates {
		if state != "device" {
			continue
		}
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
				applog.Infof(applog.CategoryADB, "device_ready device_id=%s device_name=%q", deviceId, strings.TrimSpace(name))
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

func (dt *DeviceTracker) logStateChanges(deviceStates map[string]string) {
	for deviceID, newState := range deviceStates {
		oldState, existed := dt.knownStates[deviceID]
		if !existed {
			dt.logStateEvent("device_discovered", deviceID, "", newState)
			continue
		}
		if oldState != newState {
			dt.logStateEvent("device_state_changed", deviceID, oldState, newState)
		}
	}

	for deviceID, oldState := range dt.knownStates {
		if _, ok := deviceStates[deviceID]; !ok {
			applog.Infof(applog.CategoryADB, "device_disconnected device_id=%s previous_state=%s", deviceID, oldState)
		}
	}

	dt.knownStates = cloneStates(deviceStates)
}

func (dt *DeviceTracker) logStateEvent(event string, deviceID string, oldState string, newState string) {
	msg := fmt.Sprintf("%s device_id=%s state=%s", event, deviceID, newState)
	if oldState != "" {
		msg += fmt.Sprintf(" previous_state=%s", oldState)
	}
	if newState == "device" {
		applog.Infof(applog.CategoryADB, msg)
		return
	}
	applog.Warnf(applog.CategoryADB, msg)
}

func parseDeviceStates(data string) map[string]string {
	states := make(map[string]string)
	for _, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		states[fields[0]] = fields[1]
	}
	return states
}

func cloneStates(deviceStates map[string]string) map[string]string {
	cloned := make(map[string]string, len(deviceStates))
	for deviceID, state := range deviceStates {
		cloned[deviceID] = state
	}
	return cloned
}
