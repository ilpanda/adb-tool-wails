package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

type tarEntry struct {
	name string
	body string
	dir  bool
}

func makeTarGz(t *testing.T, entries []tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		header := &tar.Header{Name: e.name, Mode: 0755}
		if e.dir {
			header.Typeflag = tar.TypeDir
		} else {
			header.Typeflag = tar.TypeReg
			header.Size = int64(len(e.body))
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(e.body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

var appEntries = []tarEntry{
	{name: "adb-tool-wails.app/", dir: true},
	{name: "adb-tool-wails.app/Contents/MacOS/", dir: true},
	{name: "adb-tool-wails.app/Contents/MacOS/adb-tool-wails", body: "binary"},
	{name: "adb-tool-wails.app/Contents/Info.plist", body: "plist"},
}

func TestExtractTarGzRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "a.tar.gz")
	os.WriteFile(archive, makeTarGz(t, []tarEntry{{name: "../evil", body: "x"}}), 0644)
	if err := extractTarGz(archive, filepath.Join(dir, "out")); err == nil {
		t.Fatal("expected error for path escaping the target directory")
	}
	if _, err := os.Stat(filepath.Join(dir, "evil")); err == nil {
		t.Fatal("file escaped the target directory")
	}
}

func TestFindStaged(t *testing.T) {
	dir := t.TempDir()
	archive := filepath.Join(dir, "a.tar.gz")
	os.WriteFile(archive, makeTarGz(t, appEntries), 0644)
	pkg := filepath.Join(dir, "pkg")
	if err := extractTarGz(archive, pkg); err != nil {
		t.Fatal(err)
	}
	staged, err := findStaged(pkg, "darwin")
	if err != nil || filepath.Base(staged) != "adb-tool-wails.app" {
		t.Fatalf("findStaged = %q, %v", staged, err)
	}
	info, err := os.Stat(filepath.Join(staged, "Contents/MacOS/adb-tool-wails"))
	if err != nil || info.Mode().Perm()&0100 == 0 {
		t.Fatalf("binary missing or not executable: %v", err)
	}
	if _, err := findStaged(pkg, "windows"); err == nil {
		t.Fatal("expected no installer in a macOS package")
	}
}

func newTestUpdater(t *testing.T, payload []byte, digest string) (*Updater, chan Status) {
	t.Helper()
	t.Setenv("TMPDIR", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(payload)
	}))
	t.Cleanup(server.Close)

	statuses := make(chan Status, 64)
	u := NewUpdater("v1.0.0", false, func(s Status) { statuses <- s })
	u.latest = Info{Latest: "v1.1.0", HasUpdate: true, CanInstall: true, asset: releaseAsset{
		Name: "adb-tool-macos-universal.tar.gz", URL: server.URL, Size: int64(len(payload)), Digest: digest,
	}}
	return u, statuses
}

func waitFinal(t *testing.T, statuses chan Status) Status {
	t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case s := <-statuses:
			if s.State == StateReady || s.State == StateError {
				return s
			}
		case <-timeout:
			t.Fatal("download did not finish")
		}
	}
}

func TestDownload(t *testing.T) {
	payload := makeTarGz(t, appEntries)
	sum := sha256.Sum256(payload)
	u, statuses := newTestUpdater(t, payload, "sha256:"+hex.EncodeToString(sum[:]))

	if err := u.Download(context.Background()); err != nil {
		t.Fatal(err)
	}
	if s := waitFinal(t, statuses); s.State != StateReady || s.Version != "v1.1.0" {
		t.Fatalf("final status = %+v", s)
	}
	if filepath.Base(u.staged) != "adb-tool-wails.app" {
		t.Fatalf("staged = %q", u.staged)
	}

	// 已下载完成的版本再次下载直接复用
	u.status = Status{State: StateIdle}
	u.Download(context.Background())
	if s := waitFinal(t, statuses); s.State != StateReady {
		t.Fatalf("reuse status = %+v", s)
	}
}

func TestDownloadResumesAfterStall(t *testing.T) {
	payload := makeTarGz(t, appEntries)
	sum := sha256.Sum256(payload)
	half := len(payload) / 2
	var requests atomic.Int32
	var resumeRange string

	t.Setenv("TMPDIR", t.TempDir())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) == 1 {
			// 第一次只发一半就不再发送数据，模拟网络卡住
			w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
			w.Write(payload[:half])
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		resumeRange = r.Header.Get("Range")
		http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(payload))
	}))
	defer server.Close()

	old := stallTimeout
	stallTimeout = 300 * time.Millisecond
	defer func() { stallTimeout = old }()

	statuses := make(chan Status, 256)
	u := NewUpdater("v1.0.0", false, func(s Status) { statuses <- s })
	u.latest = Info{Latest: "v1.1.0", CanInstall: true, asset: releaseAsset{
		Name: "adb-tool-macos-universal.tar.gz", URL: server.URL, Size: int64(len(payload)), Digest: "sha256:" + hex.EncodeToString(sum[:]),
	}}
	u.Download(context.Background())
	if s := waitFinal(t, statuses); s.State != StateReady {
		t.Fatalf("final status = %+v", s)
	}
	if want := "bytes=" + strconv.Itoa(half) + "-"; resumeRange != want {
		t.Fatalf("resume Range = %q, want %q", resumeRange, want)
	}
}

func TestDownloadDigestMismatch(t *testing.T) {
	payload := makeTarGz(t, appEntries)
	u, statuses := newTestUpdater(t, payload, "sha256:"+hex.EncodeToString(make([]byte, 32)))

	u.Download(context.Background())
	if s := waitFinal(t, statuses); s.State != StateError {
		t.Fatalf("expected error status, got %+v", s)
	}
}

func TestCleanStaged(t *testing.T) {
	t.Setenv("TMPDIR", t.TempDir())
	for _, v := range []string{"v1.0.0", "v1.1.0", "v1.2.0"} {
		os.MkdirAll(filepath.Join(stagingRoot(), v), 0755)
	}
	CleanStaged("v1.1.0")
	entries, _ := os.ReadDir(stagingRoot())
	if len(entries) != 1 || entries[0].Name() != "v1.2.0" {
		t.Fatalf("remaining = %v", entries)
	}
}
