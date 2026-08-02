package files

import (
	"errors"
	"fmt"
	"lan-server/internal/media"
	"lan-server/internal/subtitle"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrPathNotAllowed dikembalikan saat path mencoba keluar dari shared folder.
var ErrPathNotAllowed = errors.New("path tidak diizinkan")

// Item merepresentasikan satu entri file atau folder.
type Item struct {
	Name           string    `json:"name"`
	IsDir          bool      `json:"is_dir"`
	Size           int64     `json:"size"`
	ModTime        time.Time `json:"mod_time"`
	Ext            string    `json:"ext"`
	Streamable     string    `json:"streamable"`      // "video"/"audio" untuk semua format yang bisa diputar (native atau via transcode)
	NativePlay     bool      `json:"native_play"`     // true jika bisa di-stream ke app native HP (VLC, MX Player, dll)
	HasSubtitle    bool      `json:"has_subtitle"`    // true jika ada file .srt/.vtt dengan basename yang sama
	NeedsTranscode bool      `json:"needs_transcode"` // true jika format kemungkinan butuh transcode via ffmpeg
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
	if filepath.IsAbs(relPath) {
		return "", ErrPathNotAllowed
	}
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

	// Resolve the nearest existing ancestor so a new file below an escaping
	// symlink is rejected too, not only paths whose final component exists.
	ancestor := target
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			break
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return "", ErrPathNotAllowed
		}
		ancestor = parent
	}
	realAncestor, err := filepath.EvalSymlinks(ancestor)
	if err != nil {
		return "", err
	}
	realRoot, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		return "", err
	}
	if realAncestor != realRoot && !strings.HasPrefix(realAncestor+sep, realRoot+sep) {
		return "", ErrPathNotAllowed
	}

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
		// Cek subtitle untuk file video — pakai MatchSubtitleFile agar konsisten
		// dengan handler API (support pola ., _, -, case-insensitive).
		hasSubtitle := false
		videoKind := media.KindOf(ext) // cek semua format video, termasuk native-only
		if videoKind == media.KindVideo {
			base := strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
			for _, sib := range entries {
				if sib.IsDir() {
					continue
				}
				if _, ok := subtitle.MatchSubtitleFile(base, sib.Name()); ok {
					hasSubtitle = true
					break
				}
			}
			// MKV/MP4/MOV/WebM kemungkinan besar punya embedded subtitle.
			// Set true secara defensif agar badge subtitle muncul di file list.
			// Verifikasi sesungguhnya dilakukan saat user buka video (via ffprobe).
			if !hasSubtitle && (ext == "mkv" || ext == "mp4" || ext == "mov" || ext == "webm") {
				hasSubtitle = true
			}
		}

		// Tentukan streamable:
		// - Format browser-native → pakai KindForBrowser (existing)
		// - Format yang butuh transcode (avi, wmv, flv, ts) → tetap "video"
		//   agar frontend bisa buka di cplayer via /api/transcode
		streamable := string(media.KindForBrowser(ext))
		if streamable == "" && media.KindOf(ext) == media.KindVideo && media.IsNativePlayable(ext) {
			streamable = string(media.KindVideo)
		}

		items = append(items, Item{
			Name:           e.Name(),
			IsDir:          e.IsDir(),
			Size:           info.Size(),
			ModTime:        info.ModTime(),
			Ext:            ext,
			Streamable:     streamable,
			NativePlay:     media.IsNativePlayable(ext),
			HasSubtitle:    hasSubtitle,
			NeedsTranscode: media.NeedsTranscodeHint(ext),
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
