package embed

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
)

// CacheKey menghasilkan kunci cache unik untuk satu file video.
// Kunci di-invalidate otomatis kalau file dimodifikasi (modtime atau size berubah).
func CacheKey(videoPath string) (string, error) {
	info, err := os.Stat(videoPath)
	if err != nil {
		return "", fmt.Errorf("gagal stat file: %w", err)
	}
	h := sha1.New()
	fmt.Fprintf(h, "%s|%d|%d", videoPath, info.ModTime().UnixNano(), info.Size())
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CachePath mengembalikan path file cache untuk satu stream subtitle.
// Struktur: <cacheRoot>/subtitles/<key>/<streamIndex>.vtt
func CachePath(cacheRoot, key string, streamIndex int) string {
	return filepath.Join(cacheRoot, "subtitles", key, fmt.Sprintf("%d.vtt", streamIndex))
}

// ReadCache membaca hasil extract dari cache.
// Mengembalikan (data, true) kalau cache ada, (nil, false) kalau tidak ada atau error.
func ReadCache(cacheRoot, key string, streamIndex int) ([]byte, bool) {
	path := CachePath(cacheRoot, key, streamIndex)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	return data, true
}

// WriteCache menyimpan hasil extract ke cache.
// Error tidak fatal — caller boleh ignore (cache miss hanya berarti extract ulang).
func WriteCache(cacheRoot, key string, streamIndex int, data []byte) error {
	path := CachePath(cacheRoot, key, streamIndex)
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("gagal buat direktori cache: %w", err)
	}
	return os.WriteFile(path, data, 0644)
}
