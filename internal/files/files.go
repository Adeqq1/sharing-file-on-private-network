package files

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrPathNotAllowed dikembalikan saat path mencoba keluar dari shared folder.
var ErrPathNotAllowed = errors.New("path tidak diizinkan")

// Item merepresentasikan satu entri file atau folder.
type Item struct {
	Name    string    `json:"name"`
	IsDir   bool      `json:"is_dir"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
	Ext     string    `json:"ext"`
}

// ListResult adalah response dari listing folder.
type ListResult struct {
	Path  string `json:"path"`
	Items []Item `json:"items"`
}

// ResolveSafe menggabungkan sharedRoot + relPath, membersihkan path,
// lalu memastikan hasilnya masih di dalam sharedRoot (termasuk cek symlink).
// Mengembalikan ErrPathNotAllowed jika path mencoba keluar.
func ResolveSafe(sharedRoot, relPath string) (string, error) {
	absRoot, err := filepath.Abs(sharedRoot)
	if err != nil {
		return "", fmt.Errorf("shared_folder tidak valid: %w", err)
	}

	target := filepath.Clean(filepath.Join(absRoot, filepath.FromSlash(relPath)))
	sep := string(filepath.Separator)

	// Cek path traversal dasar
	if target != absRoot && !strings.HasPrefix(target+sep, absRoot+sep) {
		return "", ErrPathNotAllowed
	}

	// Cek symlink traversal: resolve symlink lalu cek ulang
	realTarget, err := filepath.EvalSymlinks(target)
	if err == nil {
		realRoot, _ := filepath.EvalSymlinks(absRoot)
		if realTarget != realRoot && !strings.HasPrefix(realTarget+sep, realRoot+sep) {
			return "", ErrPathNotAllowed
		}
	}
	// Jika EvalSymlinks error (file belum ada, misal saat upload), biarkan lewat —
	// caller bertanggung jawab cek keberadaan file.

	return target, nil
}

// List membaca isi folder relatif terhadap sharedRoot.
// Mengembalikan ErrPathNotAllowed jika relPath mencoba keluar dari sharedRoot.
func List(sharedRoot, relPath string) (*ListResult, error) {
	absRoot, err := filepath.Abs(sharedRoot)
	if err != nil {
		return nil, fmt.Errorf("shared_folder tidak valid: %w", err)
	}

	target, err := ResolveSafe(sharedRoot, relPath)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(target)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca folder: %w", err)
	}

	items := make([]Item, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		ext := ""
		if !e.IsDir() {
			ext = strings.ToLower(strings.TrimPrefix(filepath.Ext(e.Name()), "."))
		}
		items = append(items, Item{
			Name:    e.Name(),
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime(),
			Ext:     ext,
		})
	}

	// Normalisasi relPath untuk response
	cleanRel := filepath.ToSlash(strings.TrimPrefix(target, absRoot))
	cleanRel = strings.TrimPrefix(cleanRel, "/")

	return &ListResult{
		Path:  cleanRel,
		Items: items,
	}, nil
}
