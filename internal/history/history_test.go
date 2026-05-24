package history

import (
	"os"
	"testing"
	"time"
)

func TestSetGetList(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Set("a/b.mkv", "b.mkv", 100, 1000); err != nil {
		t.Fatal(err)
	}
	// Beri jeda kecil agar watched_at berbeda
	time.Sleep(2 * time.Millisecond)
	if err := s.Set("c/d.mkv", "d.mkv", 950, 1000); err != nil {
		t.Fatal(err)
	}

	e, ok := s.Get("a/b.mkv")
	if !ok || e.PositionSec != 100 {
		t.Fatalf("expected 100, got %v ok=%v", e.PositionSec, ok)
	}

	list := s.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(list))
	}
	// d.mkv watched_at lebih baru → harus di index 0
	if list[0].Path != "c/d.mkv" {
		t.Fatalf("expected newest first, got %s", list[0].Path)
	}
	if !list[0].Completed {
		t.Fatalf("d.mkv should be completed (95%%+)")
	}
	if list[1].Completed {
		t.Fatalf("b.mkv should NOT be completed (10%%)")
	}

	// Reload dari disk
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s2.List()) != 2 {
		t.Fatal("reload lost entries")
	}
}

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	_ = s.Set("a", "a", 1, 10)
	if err := s.Delete("a"); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.Get("a"); ok {
		t.Fatal("expected deleted")
	}
}

func TestClear(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	_ = s.Set("a", "a", 1, 10)
	_ = s.Set("b", "b", 2, 10)
	if err := s.Clear(); err != nil {
		t.Fatal(err)
	}
	if len(s.List()) != 0 {
		t.Fatal("expected empty after clear")
	}
	// Reload juga harus kosong
	s2, _ := Open(dir)
	if len(s2.List()) != 0 {
		t.Fatal("reload should be empty after clear")
	}
}

func TestCorruptFile(t *testing.T) {
	dir := t.TempDir()
	// Tulis file JSON rusak
	histPath := dir + "/watch_history.json"
	_ = os.WriteFile(histPath, []byte("not valid json {{{"), 0644)
	// Open harus tidak crash, return store kosong
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.List()) != 0 {
		t.Fatal("corrupt file should result in empty store")
	}
}

func TestPrune(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	// Isi lebih dari maxEntries
	for i := 0; i < maxEntries+10; i++ {
		path := "file_" + string(rune('a'+i%26)) + "_" + string(rune('0'+i/26)) + ".mkv"
		_ = s.Set(path, path, float64(i), 1000)
	}
	if len(s.List()) > maxEntries {
		t.Fatalf("expected <= %d entries after prune, got %d", maxEntries, len(s.List()))
	}
}
