package main

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/aya"
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
)

const (
	writeSample = "桌面→手机：你好 👩‍💻\n第二行：空格与标点 % &"
	readSample  = "手机→桌面：独立样本 🧪"
	digitSample = "739251"
)

func run() error {
	serial := flag.String("serial", "", "authorized test device serial (required)")
	dex := flag.String("dex", "server/server/build/outputs/clipboardPoc/aya.dex", "PoC DEX")
	copied := flag.Bool("copied", false, "confirm the independent sample was just copied manually on this phone")
	digits := flag.Bool("digits", false, "compare against the manually entered six-digit sample 739251")
	flag.Parse()
	if flag.NArg() != 1 {
		return errors.New("specify probe, write, read or read-locked")
	}
	action := flag.Arg(0)
	switch action {
	case "probe", "write":
		if *digits {
			return errors.New("-digits applies only to read or read-locked")
		}
	case "read", "read-locked":
		if !*copied {
			return errors.New("manually copy the independent phone sample first, then supply -copied")
		}
	default:
		return errors.New("unknown action")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	return aya.WithClipboardSession(adb.ExecuteParams{Ctxt: ctx, DeviceId: *serial}, *dex, aya.ClipboardPocVersion, func(c *aya.Client, info map[string]interface{}) error {
		fmt.Printf("serial=%s version=%v uid=%v pid=%v package=%v opPackage=%v\n",
			*serial, info["version"], info["uid"], info["pid"], info["package"], info["opPackage"])
		if action == "probe" {
			return nil
		}
		if action == "write" {
			result, err := c.SendMessage("setClipboardText", map[string]string{"text": writeSample})
			if err != nil {
				return err
			}
			if result["status"] != "write_rpc_ok" {
				return fmt.Errorf("write status=%v cause=%v", result["status"], result["cause"])
			}
			fmt.Println("WRITE_RPC_OK — manual paste verification pending")
			return nil
		}
		result, err := c.SendMessage("getClipboardText", map[string]bool{"locked": action == "read-locked"})
		if err != nil {
			return err
		}
		if result["status"] != "ok" {
			return fmt.Errorf("%s FAIL status=%v cause=%v", action, result["status"], result["cause"])
		}
		if result["alsoHtml"] == true {
			fmt.Println("format=text/plain (HTML alternative present)")
		}
		// Exact UTF-8 equality, with no normalization or whitespace trimming.
		expected := readSample
		if *digits {
			expected = digitSample
		}
		if result["text"] != expected {
			return fmt.Errorf("%s FAIL sample_mismatch", action)
		}
		fmt.Printf("%s PASS\n", action)
		return nil
	})
}

func main() {
	log.SetFlags(0)
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
