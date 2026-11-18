package clipboard

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/aya"
	"adb-tool-wails/internal/i18n"
	"context"
	"errors"
	"strings"
)

type WatchStatus struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
	Error  string `json:"error"`
}

type watchRun struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (s *Service) WatchStatus() WatchStatus {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	status := s.status
	if s.watchErr != nil {
		status.Error = i18n.T(s.watchErr.Error())
	}
	return status
}

func (s *Service) notifyStatus() {
	if s.OnWatchChanged != nil {
		s.OnWatchChanged()
	}
}

// StartWatch launches exactly one listener. Control operations serialize replacement
// and cleanup; status and cancellation remain available during the adb handshake.
func (s *Service) StartWatch(param adb.ExecuteParams) error {
	if strings.TrimSpace(param.DeviceId) == "" {
		return errors.New("device serial required")
	}
	s.watchControl.Lock()
	defer s.watchControl.Unlock()
	if err := s.ctx.Err(); err != nil {
		return err
	}
	current := s.WatchStatus()
	if current.Serial == param.DeviceId && (current.State == "starting" || current.State == "watching") {
		return nil
	}
	s.stopWatch("")
	ctx, cancel := context.WithCancel(s.ctx)
	param.Ctxt = ctx
	run := &watchRun{cancel: cancel, done: make(chan struct{})}
	s.watchMu.Lock()
	s.watch = run
	s.watchErr = nil
	s.status = WatchStatus{Serial: param.DeviceId, State: "starting"}
	s.watchMu.Unlock()
	go s.runWatch(param, run)
	s.notifyStatus()
	return nil
}

func (s *Service) runWatch(p adb.ExecuteParams, run *watchRun) {
	defer close(run.done)
	defer run.cancel()
	err := s.listen(p)
	s.watchMu.Lock()
	s.status = WatchStatus{State: "off"}
	if err != nil && p.Ctxt.Err() == nil {
		s.status = WatchStatus{Serial: p.DeviceId, State: "error"}
		s.watchErr = err
	}
	s.watch = nil
	s.watchMu.Unlock()
	s.notifyStatus()
}

func (s *Service) listen(p adb.ExecuteParams) error {
	if s.Store == nil {
		return errors.New("无法加载本地历史")
	}
	return aya.WatchClipboard(p, s.dexPath, func() {
		if p.Ctxt.Err() != nil {
			return
		}
		s.watchMu.Lock()
		s.status.State = "watching"
		s.watchMu.Unlock()
		s.notifyStatus()
	}, func(text string) error {
		if err := p.Ctxt.Err(); err != nil {
			return err
		}
		if err := s.Store.RememberClipboard(p.DeviceId, text, "phone"); err != nil {
			return err
		}
		if s.OnHistoryChanged != nil {
			s.OnHistoryChanged(p.DeviceId)
		}
		return nil
	})
}

func (s *Service) StopWatch(serial string) {
	s.watchControl.Lock()
	defer s.watchControl.Unlock()
	s.stopWatch(serial)
}

// A delayed stop from a previous device must never cancel a new device's listener.
func (s *Service) stopWatch(serial string) {
	s.watchMu.Lock()
	run := s.watch
	match := serial == "" || serial == s.status.Serial
	s.watchMu.Unlock()
	if run != nil && match {
		run.cancel()
		<-run.done
	}
}
