// Package clipboard manages phone clipboard transfers and per-device history.
package clipboard

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/aya"
	"adb-tool-wails/internal/storage"
	"context"
	"sync"
)

type Service struct {
	Store            *storage.BadgerStore
	dexPath          string
	ctx              context.Context
	cancel           context.CancelFunc
	active           sync.RWMutex
	watchControl     sync.Mutex
	watchMu          sync.Mutex
	status           WatchStatus
	watchErr         error
	watch            *watchRun
	OnWatchChanged   func()
	OnHistoryChanged func(serial string)
}

func NewService(parent context.Context, store *storage.BadgerStore, dex string) *Service {
	ctx, cancel := context.WithCancel(parent)
	return &Service{Store: store, dexPath: dex, ctx: ctx, cancel: cancel, status: WatchStatus{State: "off"}}
}

// Close waits for the foreground adb commands and their remote cleanup before Badger closes.
func (s *Service) Close() {
	s.cancel()
	s.StopWatch("")
	s.active.Lock()
	s.active.Unlock()
}

type Transfer struct {
	Text         string `json:"text"`
	Sensitive    bool   `json:"sensitive"`
	HistorySaved bool   `json:"historySaved"`
}

func (s *Service) Read(param adb.ExecuteParams) (Transfer, error) {
	s.active.RLock()
	defer s.active.RUnlock()
	param.Ctxt = s.ctx
	clip, err := aya.ReadClipboard(param, s.dexPath)
	if err != nil {
		return Transfer{}, err
	}
	return s.record(param.DeviceId, clip, "phone"), nil
}

func (s *Service) Send(param adb.ExecuteParams, text string, sensitive bool) (Transfer, error) {
	s.active.RLock()
	defer s.active.RUnlock()
	param.Ctxt = s.ctx
	clip := aya.ClipboardText{Text: text, Sensitive: sensitive}
	if err := aya.WriteClipboard(param, s.dexPath, clip); err != nil {
		return Transfer{}, err
	}
	return s.record(param.DeviceId, clip, "desktop"), nil
}

func (s *Service) record(serial string, clip aya.ClipboardText, source string) Transfer {
	result := Transfer{Text: clip.Text, Sensitive: clip.Sensitive}
	if !clip.Sensitive {
		result.HistorySaved = s.Store.RememberClipboard(serial, clip.Text, source) == nil
	}
	return result
}
