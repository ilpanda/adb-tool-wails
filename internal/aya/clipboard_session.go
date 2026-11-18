package aya

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/util"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"
)

const ClipboardPocVersion = AyaDexVersion + "-clipboard-poc.1"

type shellStream struct {
	io.ReadCloser
	io.WriteCloser
}

func (s shellStream) Close() error {
	writeErr := s.WriteCloser.Close()
	if errors.Is(writeErr, os.ErrClosed) {
		writeErr = nil
	}
	return errors.Join(writeErr, s.ReadCloser.Close())
}

// WithClipboardSession runs one private shell process. Closing stdin also ends a probe
// that only requested the handshake. The device has an independent lifetime limit.
func WithClipboardSession(param adb.ExecuteParams, dex, version string, test func(*Client, map[string]interface{}) error) (err error) {
	if param.Ctxt == nil {
		param.Ctxt = context.Background()
	}
	ctx, cancel := context.WithTimeout(param.Ctxt, 60*time.Second)
	defer cancel()
	param.Ctxt = ctx
	return withClipboardPipe(param, dex, version, test)
}

func withClipboardPipe(param adb.ExecuteParams, dex, version string, test func(*Client, map[string]interface{}) error) (err error) {
	if strings.TrimSpace(param.DeviceId) == "" {
		return errors.New("explicit adb serial required")
	}
	if param.Ctxt == nil {
		param.Ctxt = context.Background()
	}
	if param.AdbPath == "" {
		param.AdbPath = "adb"
	}
	ctx := param.Ctxt
	if err := ctx.Err(); err != nil {
		return err
	}
	c := NewClient(param)
	sum, err := fileMD5(dex)
	if err != nil {
		return err
	}
	uid, err := c.runAdb(5*time.Second, "shell", "id -u")
	if err != nil {
		return err
	}
	if strings.TrimSpace(uid) != "2000" {
		return errors.New("adb must run as shell (UID 2000)")
	}

	dir := "/data/local/tmp/aya-clipboard-" + uuid.NewString()
	path := dir + "/aya.dex"
	if _, err = c.runAdb(5*time.Second, "shell", "mkdir -m 700 "+dir); err != nil {
		return err
	}
	cleanup := "rm -f " + path + " && { test ! -d " + dir + " || rmdir " + dir + "; }"
	defer func() {
		// Even an interrupted test gets an independent cleanup deadline.
		param.Ctxt = context.Background()
		if _, e := NewClient(param).runAdb(5*time.Second, "shell", cleanup); e != nil {
			err = errors.Join(err, fmt.Errorf("cleanup %s: %w", dir, e))
		}
	}()
	if _, err = c.runAdb(20*time.Second, "push", dex, path); err != nil {
		return err
	}
	out, err := c.runAdb(5*time.Second, "shell", "chmod 400 "+path+" && md5sum "+path)
	if err != nil {
		return err
	}
	if fields := strings.Fields(out); len(fields) != 2 || fields[0] != sum {
		return errors.New("deployed DEX checksum mismatch")
	}

	// All remote paths are generated above. Clipboard data only goes in framed RPCs.
	script := "trap '" + cleanup + "' EXIT; CLASSPATH=" + path + " app_process /system/bin io.liriliri.aya.ClipboardSession"
	cmd := exec.CommandContext(ctx, param.AdbPath, param.Args("shell", "-T", script)...)
	util.ConfigureCommand(cmd)
	in, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	outPipe, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		return err
	}
	// EOF lets the phone unregister immediately, including while an event request is pending.
	cmd.Cancel = in.Close
	cmd.WaitDelay = 3 * time.Second
	stream := shellStream{outPipe, in}
	if err = cmd.Start(); err != nil {
		stream.Close()
		return err
	}
	c.conn = stream
	c.startReadLoop()
	defer func() {
		closeErr := c.Close()
		waitErr := cmd.Wait()
		var exit *exec.ExitError
		switch {
		case ctx.Err() != nil:
			err, waitErr = ctx.Err(), nil
		case errors.As(waitErr, &exit) && exit.ExitCode() == 124:
			// A device watchdog closes the pipe just like a disconnect.
			err, waitErr = errors.New("clipboard process timeout"), nil
		}
		err = errors.Join(err, closeErr, waitErr)
	}()
	info, err := c.sendMessage("getVersion", nil, 15*time.Second)
	if err != nil {
		return fmt.Errorf("clipboard handshake: %w", err)
	}
	if info["version"] != version {
		return fmt.Errorf("clipboard version mismatch (expected %s)", version)
	}
	if info["status"] != "ok" || info["uid"] != float64(2000) || info["opPackage"] != "com.android.shell" {
		return fmt.Errorf("clipboard identity/context check: status=%v uid=%v package=%v opPackage=%v cause=%v",
			info["status"], info["uid"], info["package"], info["opPackage"], info["cause"])
	}
	return test(c, info)
}
