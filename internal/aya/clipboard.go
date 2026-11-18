package aya

import (
	"adb-tool-wails/internal/adb"
	"adb-tool-wails/internal/i18n"
	"errors"
	"fmt"
)

const maxClipboardBytes = 64 * 1024

type ClipboardText struct {
	Text      string `json:"text"`
	Sensitive bool   `json:"sensitive"`
}

func ReadClipboard(param adb.ExecuteParams, dex string) (ClipboardText, error) {
	var clip ClipboardText
	err := WithClipboardSession(param, dex, AyaDexVersion, func(c *Client, _ map[string]interface{}) error {
		result, err := c.SendMessage("getClipboardText", map[string]bool{"locked": false})
		if err != nil {
			return err
		}
		if result["status"] != "ok" {
			return clipboardStatusError(result["status"])
		}
		text, ok := result["text"].(string)
		sensitive, valid := result["sensitive"].(bool)
		if !ok || !valid || text == "" || len(text) > maxClipboardBytes {
			return errors.New("invalid clipboard response")
		}
		clip = ClipboardText{Text: text, Sensitive: sensitive}
		return nil
	})
	return clip, err
}

func WriteClipboard(param adb.ExecuteParams, dex string, clip ClipboardText) error {
	if clip.Text == "" {
		return clipboardStatusError("empty")
	}
	if len(clip.Text) > maxClipboardBytes {
		return clipboardStatusError("too_large")
	}
	return WithClipboardSession(param, dex, AyaDexVersion, func(c *Client, _ map[string]interface{}) error {
		result, err := c.SendMessage("setClipboardText", clip)
		if err != nil {
			return err
		}
		if result["status"] != "write_rpc_ok" {
			return clipboardStatusError(result["status"])
		}
		return nil
	})
}

func clipboardStatusError(status interface{}) error {
	code, _ := status.(string)
	return clipboardError(code)
}

// A watch failure may still be displayed after the user changes the app language.
type clipboardError string

func (code clipboardError) Error() string {
	switch code {
	case "empty":
		return i18n.T("剪贴板文本为空")
	case "empty_or_invisible":
		return i18n.T("剪贴板为空，或系统限制了读取")
	case "non_plain_text":
		return i18n.T("手机剪贴板没有可用的纯文本")
	case "permission_denied":
		return i18n.T("系统拒绝访问剪贴板")
	case "screen_state_mismatch":
		return i18n.T("请解锁并点亮手机屏幕后重试")
	case "screen_state_unknown":
		return i18n.T("无法确认这台手机的锁屏状态")
	case "watch_error":
		return i18n.T("无法监听手机剪贴板")
	case "api_error":
		return i18n.T("手机系统无法完成剪贴板操作")
	case "too_large":
		return i18n.T("单条文本最多支持 64 KiB")
	default:
		return fmt.Sprintf("%s (%s)", i18n.T("剪贴板操作失败"), string(code))
	}
}

// WatchClipboard only reads clips delivered after listener registration. Quiet replies
// are transport heartbeats; they never trigger an Android clipboard read.
func WatchClipboard(param adb.ExecuteParams, dex string, ready func(), receive func(string) error) error {
	return withClipboardPipe(param, dex, AyaDexVersion, func(c *Client, _ map[string]interface{}) error {
		result, err := c.SendMessage("watchClipboard", nil)
		if err != nil {
			return err
		}
		if result["status"] != "watching" {
			return clipboardStatusError(result["status"])
		}
		ready()
		for {
			result, err := c.SendMessage("nextClipboardChange", nil)
			if err != nil {
				return err
			}
			switch result["status"] {
			case "idle":
				continue
			case "ok":
				text, valid := result["text"].(string)
				if !valid || text == "" || len(text) > maxClipboardBytes || result["sensitive"] != false {
					return errors.New("invalid clipboard change")
				}
				if err := receive(text); err != nil {
					return err
				}
			default:
				return clipboardStatusError(result["status"])
			}
		}
	})
}
