package clipboard

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/aya"
	"adb-tool-wails/internal/i18n"
	"adb-tool-wails/internal/storage"
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestRecordSensitiveAndUnavailableStorage(t *testing.T) {
	s := &Service{}
	for _, sensitive := range []bool{true, false} {
		r := s.record("serial", aya.ClipboardText{Text: "synthetic", Sensitive: sensitive}, "phone")
		if r.HistorySaved || r.Sensitive != sensitive || r.Text != "synthetic" {
			t.Fatal("incorrect transfer result")
		}
	}
}

func TestClosedServiceDoesNotStartAnotherSession(t *testing.T) {
	s := NewService(context.Background(), nil, "")
	s.Close()
	param := adb.ExecuteParams{DeviceId: "synthetic"}
	if _, err := s.Read(param); !errors.Is(err, context.Canceled) {
		t.Fatal("read attempted after shutdown", err)
	}
	if _, err := s.Send(param, "sample", false); !errors.Is(err, context.Canceled) {
		t.Fatal("send attempted after shutdown", err)
	}
}

func TestWatchFailureCanBeReadInAnotherLanguage(t *testing.T) {
	service := NewService(context.Background(), nil, "")
	defer service.Close()
	t.Cleanup(func() { i18n.SetLanguage("zh-CN") })
	ctx, cancel := context.WithCancel(service.ctx)
	service.runWatch(adb.ExecuteParams{Ctxt: ctx, DeviceId: "synthetic"}, &watchRun{cancel: cancel, done: make(chan struct{})})
	i18n.SetLanguage("en")
	if got := service.WatchStatus().Error; got != "Could not load local history" {
		t.Fatal(got)
	}
}

func TestWatchIdleWithoutDeviceAndReportsFailedStartup(t *testing.T) {
	// An absent DEX fails before adb or the database is touched.
	service := NewService(context.Background(), &storage.BadgerStore{}, filepath.Join(t.TempDir(), "absent.dex"))
	if service.WatchStatus().State != "off" {
		t.Fatal("watch must be idle without a selected device")
	}
	failed := make(chan struct{}, 1)
	service.OnWatchChanged = func() {
		if service.WatchStatus().State == "error" {
			select {
			case failed <- struct{}{}:
			default:
			}
		}
	}
	p := adb.ExecuteParams{DeviceId: "synthetic"}
	if err := service.StartWatch(p); err != nil {
		t.Fatal(err)
	}
	select {
	case <-failed:
	case <-time.After(2 * time.Second):
		t.Fatal("no startup failure notification")
	}
	status := service.WatchStatus()
	if status.Serial != p.DeviceId || status.Error == "" {
		t.Fatal("missing device or failure reason")
	}
	service.Close()
	if err := service.StartWatch(p); !errors.Is(err, context.Canceled) {
		t.Fatal("watch restarted after shutdown", err)
	}
}
