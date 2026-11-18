package storage

import (
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/dgraph-io/badger/v4"
	"github.com/google/uuid"
)

const clipboardPrefix = "clipboard/history/"
const clipboardLimit = 20

type ClipboardEntry struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	Source     string `json:"source"`
	LastUsedAt int64  `json:"lastUsedAt"`
}

func (s *BadgerStore) ClipboardDevices() ([]string, error) {
	devices := []string{}
	if s == nil {
		return devices, errors.New("history storage unavailable")
	}
	prefix := []byte(clipboardPrefix)
	err := s.db.View(func(tx *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.PrefetchValues = false
		opts.Prefix = prefix
		it := tx.NewIterator(opts)
		defer it.Close()
		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
			devices = append(devices, strings.TrimPrefix(string(it.Item().Key()), clipboardPrefix))
		}
		return nil
	})
	return devices, err
}

func (s *BadgerStore) ClipboardHistory(serial string) ([]ClipboardEntry, error) {
	entries := []ClipboardEntry{}
	if s == nil {
		return entries, errors.New("history storage unavailable")
	}
	if strings.TrimSpace(serial) == "" {
		return entries, errors.New("device serial required")
	}
	err := s.Get(clipboardPrefix+serial, &entries)
	if errors.Is(err, badger.ErrKeyNotFound) {
		return entries, nil
	}
	return entries, err
}

func (s *BadgerStore) updateClipboard(serial string, edit func([]ClipboardEntry) []ClipboardEntry) error {
	if s == nil {
		return errors.New("history storage unavailable")
	}
	s.clipboardMu.Lock()
	defer s.clipboardMu.Unlock()
	entries, err := s.ClipboardHistory(serial)
	if err != nil {
		return err
	}
	entries = edit(entries)
	if len(entries) == 0 {
		return s.Delete(clipboardPrefix + serial)
	}
	return s.Set(clipboardPrefix+serial, entries)
}

func (s *BadgerStore) RememberClipboard(serial, text, source string) error {
	return s.updateClipboard(serial, func(entries []ClipboardEntry) []ClipboardEntry {
		entry := ClipboardEntry{Text: text, Source: source, LastUsedAt: time.Now().UnixMilli()}
		index := slices.IndexFunc(entries, func(old ClipboardEntry) bool { return old.Text == text })
		if index >= 0 {
			entry.ID = entries[index].ID
			entries = slices.Delete(entries, index, index+1)
		} else {
			entry.ID = uuid.NewString()
		}
		return append([]ClipboardEntry{entry}, entries[:min(len(entries), clipboardLimit-1)]...)
	})
}

func (s *BadgerStore) RemoveClipboard(serial, id string) error {
	return s.updateClipboard(serial, func(entries []ClipboardEntry) []ClipboardEntry {
		return slices.DeleteFunc(entries, func(entry ClipboardEntry) bool { return entry.ID == id })
	})
}

func (s *BadgerStore) ClearClipboard(serial string) error {
	return s.updateClipboard(serial, func([]ClipboardEntry) []ClipboardEntry { return nil })
}

// Promote only existing records. Completing a desktop copy cannot revive a deleted item.
func (s *BadgerStore) TouchClipboard(serial, id string) error {
	return s.updateClipboard(serial, func(entries []ClipboardEntry) []ClipboardEntry {
		index := slices.IndexFunc(entries, func(entry ClipboardEntry) bool { return entry.ID == id })
		if index >= 0 {
			entry := entries[index]
			entry.LastUsedAt = time.Now().UnixMilli()
			copy(entries[1:index+1], entries[:index])
			entries[0] = entry
		}
		return entries
	})
}
