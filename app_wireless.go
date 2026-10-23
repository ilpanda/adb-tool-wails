package main

import (
	"adb-tool-wails/adb"
	"adb-tool-wails/applog"
	"context"
	"sync"
	"time"
)

// 二维码配对会一直等待手机扫码，关闭弹窗时需要能取消
var (
	qrPairMutex  sync.Mutex
	qrPairCancel context.CancelFunc
)

// WirelessConnect 通过 IP 连接已配对或已开启 tcpip 的设备
func (a *App) WirelessConnect(address string) adb.WirelessResult {
	result := adb.WirelessConnect(a.adbBinary(), address)
	applog.Infof(applog.CategoryADB, "wireless_connect address=%s connected=%s err=%q", address, result.Connected, result.Error)
	return result
}

// WirelessPair 配对码配对，成功后自动连接
func (a *App) WirelessPair(address string, code string) adb.WirelessResult {
	result := adb.WirelessPair(a.adbBinary(), address, code)
	applog.Infof(applog.CategoryADB, "wireless_pair address=%s connected=%s err=%q", address, result.Connected, result.Error)
	return result
}

// WirelessPairByQR 等待手机扫描二维码后配对并连接，最多等待 2 分钟
func (a *App) WirelessPairByQR(serviceName string, password string) adb.WirelessResult {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	qrPairMutex.Lock()
	if qrPairCancel != nil {
		qrPairCancel()
	}
	qrPairCancel = cancel
	qrPairMutex.Unlock()
	defer cancel()

	result := adb.WirelessPairByQR(ctx, a.adbBinary(), serviceName, password)
	applog.Infof(applog.CategoryADB, "wireless_pair_qr service=%s connected=%s err=%q", serviceName, result.Connected, result.Error)
	return result
}

// CancelWirelessPairByQR 关闭二维码弹窗时停止等待
func (a *App) CancelWirelessPairByQR() {
	qrPairMutex.Lock()
	defer qrPairMutex.Unlock()
	if qrPairCancel != nil {
		qrPairCancel()
		qrPairCancel = nil
	}
}

// WirelessFromUSB 让当前 USB 设备切换到无线调试（adb tcpip 5555）
func (a *App) WirelessFromUSB(deviceId string) adb.WirelessResult {
	result := adb.WirelessFromUSB(a.adbBinary(), deviceId)
	applog.Infof(applog.CategoryADB, "wireless_from_usb device=%s connected=%s err=%q", deviceId, result.Connected, result.Error)
	return result
}

// WirelessDisconnect 断开无线设备
func (a *App) WirelessDisconnect(serial string) adb.WirelessResult {
	return adb.WirelessDisconnect(a.adbBinary(), serial)
}

// WirelessMdnsSupported 当前 adb 是否支持 mDNS（二维码配对需要）
func (a *App) WirelessMdnsSupported() bool {
	ok, _ := adb.MdnsSupported(a.adbBinary())
	return ok
}
