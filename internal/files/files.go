package files

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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

// List membaca isi folder relatif terhadap sharedRoot.
// Mengembalikan error jika relPath mencoba keluar dari sharedRoot (path traversal).
func List(sharedRoot, relPath string) (*ListResult, error) {
	// Bersihkan dan gabungkan path
	absRoot, err := filepath.Abs(sharedRoot)
	if err != nil {
		return nil, fmt.Errorf("shared_folder tidak valid: %w", err)
	}

	target := filepath.Join(absRoot, filepath.FromSlash(relPath))
	target = filepath.Clean(target)

	// Keamanan: pastikan target masih di dalam absRoot
	if !strings.HasPrefix(target+string(filepath.Separator), absRoot+string(filepath.Separator)) {
		if target != absRoot {
			return nil, fmt.Errorf("path tidak diizinkan")
		}
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
			ext = strings.TrimPrefix(filepath.Ext(e.Name()), ".")
			ext = strings.ToLower(ext)
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
