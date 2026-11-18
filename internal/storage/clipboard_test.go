package storage

import (
	"fmt"
	"sync"
	"testing"

	"github.com/dgraph-io/badger/v4"
)

func TestClipboardHistory(t *testing.T) {
	path := t.TempDir()
	open := func() *BadgerStore {
		db, err := badger.Open(badger.DefaultOptions(path).WithLogger(nil))
		if err != nil {
			t.Fatal(err)
		}
		return &BadgerStore{db: db}
	}
	s := open()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	list := func(serial string) []ClipboardEntry {
		t.Helper()
		entries, err := s.ClipboardHistory(serial)
		must(err)
		return entries
	}
	for i := 0; i < 21; i++ {
		must(s.RememberClipboard("A", fmt.Sprint(i), "desktop"))
	}
	must(s.RememberClipboard("B", "  中文👩‍💻\n% &  ", "phone"))
	a := list("A")
	if len(a) != 20 || a[0].Text != "20" || a[19].Text != "1" {
		t.Fatal("incorrect history window")
	}
	id := a[19].ID
	must(s.RememberClipboard("A", "1", "phone"))
	a = list("A")
	if len(a) != 20 || a[0].ID != id || a[0].Source != "phone" {
		t.Fatal("duplicate was not promoted")
	}
	must(s.TouchClipboard("A", a[5].ID))
	if list("A")[0].ID != a[5].ID {
		t.Fatal("copy did not promote entry")
	}
	must(s.RemoveClipboard("A", id))
	must(s.TouchClipboard("A", id))
	if len(list("A")) != 19 {
		t.Fatal("deleted entry reappeared")
	}
	must(s.Close())
	s = open()
	defer s.Close()
	if len(list("A")) != 19 || list("B")[0].Text != "  中文👩‍💻\n% &  " {
		t.Fatal("persistence or device isolation failed")
	}
	must(s.ClearClipboard("A"))
	devices, err := s.ClipboardDevices()
	must(err)
	if len(devices) != 1 || devices[0] != "B" || len(list("A")) != 0 {
		t.Fatal("clear affected another device or retained its key")
	}
	var group sync.WaitGroup
	for i := 0; i < 18; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			if err := s.RememberClipboard("C", fmt.Sprint(i), "phone"); err != nil {
				t.Error(err)
			}
		}(i)
	}
	group.Wait()
	if len(list("C")) != 18 {
		t.Fatal("lost concurrent history updates")
	}
}
