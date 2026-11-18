package main

import (
	"adb-tool-wails/internal/clipboard"
	"adb-tool-wails/internal/storage"
)

func (a *App) ReadPhoneClipboard(serial string) (clipboard.Transfer, error) {
	return a.clipboard.Read(a.buildParam(serial))
}

func (a *App) SendPhoneClipboard(serial, text string, sensitive bool) (clipboard.Transfer, error) {
	return a.clipboard.Send(a.buildParam(serial), text, sensitive)
}

func (a *App) GetClipboardHistory(serial string) ([]storage.ClipboardEntry, error) {
	return a.clipboard.Store.ClipboardHistory(serial)
}

func (a *App) GetClipboardHistoryDevices() ([]string, error) {
	return a.clipboard.Store.ClipboardDevices()
}

func (a *App) TouchClipboardEntry(serial, id string) error {
	return a.clipboard.Store.TouchClipboard(serial, id)
}

func (a *App) DeleteClipboardEntry(serial, id string) error {
	return a.clipboard.Store.RemoveClipboard(serial, id)
}

func (a *App) ClearClipboardHistory(serial string) error {
	return a.clipboard.Store.ClearClipboard(serial)
}

func (a *App) StartClipboardWatch(serial string) error {
	return a.clipboard.StartWatch(a.buildParam(serial))
}

func (a *App) StopClipboardWatch(serial string) {
	if serial != "" {
		a.clipboard.StopWatch(serial)
	}
}

func (a *App) GetClipboardWatchStatus() clipboard.WatchStatus {
	return a.clipboard.WatchStatus()
}
