package history

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

const (
	fileVersion = 1
	maxEntries  = 200 // entry paling lama otomatis di-prune
)

// Entry menyimpan satu record riwayat tontonan.
type Entry struct {
	Path        string    `json:"path"`         // relatif terhadap shared_folder
	Name        string    `json:"name"`         // basename, untuk display
	PositionSec float64   `json:"position_sec"` // posisi terakhir dalam detik
	DurationSec float64   `json:"duration_sec"` // durasi total video
	WatchedAt   time.Time `json:"watched_at"`
	Completed   bool      `json:"completed"` // true kalau >= 95% durasi
}

// Store adalah in-memory store yang di-persist ke disk sebagai JSON.
type Store struct {
	mu      sync.Mutex
	file    string
	entries map[string]Entry // key: sha1(path)
}

func keyOf(relPath string) string {
	h := sha1.Sum([]byte(relPath))
	return hex.EncodeToString(h[:])
}

// Open memuat store dari disk. Kalau file belum ada, store kosong.
func Open(cacheDir string) (*Store, error) {
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("mkdir cacheDir: %w", err)
	}
	s := &Store{
		file:    filepath.Join(cacheDir, "watch_history.json"),
		entries: make(map[string]Entry),
	}
	data, err := os.ReadFile(s.file)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		// File ada tapi tidak bisa dibaca — return store kosong, jangan crash
		return s, nil
	}
	var raw struct {
		Version int              `json:"version"`
		Entries map[string]Entry `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		// File korup → reset, jangan crash
		return s, nil
	}
	if raw.Entries != nil {
		s.entries = raw.Entries
	}
	return s, nil
}

// Set update atau insert satu entry. Auto-save ke disk.
func (s *Store) Set(relPath, name string, position, duration float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	completed := duration > 0 && position >= duration*0.95
	s.entries[keyOf(relPath)] = Entry{
		Path:        relPath,
		Name:        name,
		PositionSec: position,
		DurationSec: duration,
		WatchedAt:   time.Now(),
		Completed:   completed,
	}
	s.prune()
	return s.flush()
}

// Get mengembalikan entry tunggal (untuk resume). Return zero value & false kalau tidak ada.
func (s *Store) Get(relPath string) (Entry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[keyOf(relPath)]
	return e, ok
}

// List mengembalikan semua entry, sort terbaru di depan.
func (s *Store) List() []Entry {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Entry, 0, len(s.entries))
	for _, e := range s.entries {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].WatchedAt.After(out[j].WatchedAt)
	})
	return out
}

// Delete menghapus satu entry by path.
func (s *Store) Delete(relPath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, keyOf(relPath))
	return s.flush()
}

// Clear menghapus semua entry.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = make(map[string]Entry)
	return s.flush()
}

// prune memastikan jumlah entry <= maxEntries dengan menghapus yang paling lama.
// Caller harus pegang mutex.
func (s *Store) prune() {
	if len(s.entries) <= maxEntries {
		return
	}
	type kv struct {
		k string
		e Entry
	}
	list := make([]kv, 0, len(s.entries))
	for k, e := range s.entries {
		list = append(list, kv{k, e})
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].e.WatchedAt.After(list[j].e.WatchedAt)
	})
	for _, item := range list[maxEntries:] {
		delete(s.entries, item.k)
	}
}

// flush menulis ke disk. Caller harus pegang mutex.
func (s *Store) flush() error {
	raw := struct {
		Version int              `json:"version"`
		Entries map[string]Entry `json:"entries"`
	}{Version: fileVersion, Entries: s.entries}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	// Tulis lewat temp file lalu rename agar atomic
	tmp := s.file + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, s.file)
}
