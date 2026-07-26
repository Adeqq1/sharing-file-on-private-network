package hls

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"lan-server/internal/transcode"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SegDuration is the fixed HLS segment length in seconds.
const SegDuration = 4.0

// CacheDir returns <root>/hls.
func CacheDir(root string) string {
	return filepath.Join(root, "hls")
}

// cacheGen bumps when segment encode recipe changes (invalidates old bad segs).
const cacheGen = "v2-force-encode"

// CacheKey is stable for path+mtime+size+burnSub+gen so recipe changes invalidate cache.
func CacheKey(absPath string, modTime time.Time, size int64, burnSub int) string {
	h := sha1.New()
	fmt.Fprintf(h, "%s|%d|%d|%d|%s", absPath, modTime.UnixNano(), size, burnSub, cacheGen)
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// NumSegments returns how many segments cover durationSec.
func NumSegments(durationSec float64) int {
	if durationSec <= 0 {
		return 0
	}
	n := int(durationSec / SegDuration)
	if float64(n)*SegDuration < durationSec {
		n++
	}
	if n < 1 {
		n = 1
	}
	return n
}

// SegmentDuration returns EXTINF length for segment index i (0-based).
func SegmentDuration(durationSec float64, i int) float64 {
	n := NumSegments(durationSec)
	if n == 0 || i < 0 || i >= n {
		return 0
	}
	start := float64(i) * SegDuration
	remain := durationSec - start
	if remain > SegDuration {
		return SegDuration
	}
	if remain < 0.1 {
		return 0.1
	}
	return remain
}

// BuildMediaPlaylist writes a VOD m3u8. segURL builds the URI for segment i.
func BuildMediaPlaylist(durationSec float64, segURL func(i int) string) string {
	n := NumSegments(durationSec)
	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:3\n")
	b.WriteString("#EXT-X-TARGETDURATION:" + strconv.Itoa(int(SegDuration)+1) + "\n")
	b.WriteString("#EXT-X-MEDIA-SEQUENCE:0\n")
	b.WriteString("#EXT-X-PLAYLIST-TYPE:VOD\n")
	for i := 0; i < n; i++ {
		d := SegmentDuration(durationSec, i)
		fmt.Fprintf(&b, "#EXTINF:%.3f,\n", d)
		b.WriteString(segURL(i))
		b.WriteByte('\n')
	}
	b.WriteString("#EXT-X-ENDLIST\n")
	return b.String()
}

// segment locks: one encode per cache file at a time.
var (
	segMu    sync.Mutex
	segLocks = map[string]*sync.Mutex{}
)

func lockPath(p string) func() {
	segMu.Lock()
	m, ok := segLocks[p]
	if !ok {
		m = &sync.Mutex{}
		segLocks[p] = m
	}
	segMu.Unlock()
	m.Lock()
	return m.Unlock
}

// SegmentPath is the on-disk path for segment i under cache root.
func SegmentPath(cacheRoot, key string, i int) string {
	return filepath.Join(CacheDir(cacheRoot), key, fmt.Sprintf("seg_%05d.ts", i))
}

// WriteSegment serves segment i: cache hit = file; miss = stream ffmpeg to client while caching.
func WriteSegment(ctx context.Context, w http.ResponseWriter, cacheRoot, absPath string, probe *transcode.ProbeResult, modTime time.Time, size int64, burnSub, index int) error {
	if probe == nil || probe.Duration <= 0 {
		return fmt.Errorf("durasi video tidak diketahui")
	}
	n := NumSegments(probe.Duration)
	if index < 0 || index >= n {
		return fmt.Errorf("index segment di luar jangkauan")
	}

	key := CacheKey(absPath, modTime, size, burnSub)
	outPath := SegmentPath(cacheRoot, key, index)

	// Fast path: already cached
	if st, err := os.Stat(outPath); err == nil && st.Size() > 0 {
		return serveFile(w, outPath, st)
	}

	unlock := lockPath(outPath)
	defer unlock()

	// Re-check after lock (another request may have finished encode)
	if st, err := os.Stat(outPath); err == nil && st.Size() > 0 {
		return serveFile(w, outPath, st)
	}

	if err := os.MkdirAll(filepath.Dir(outPath), 0755); err != nil {
		return err
	}

	start := float64(index) * SegDuration
	dur := SegmentDuration(probe.Duration, index)
	tmp := outPath + ".part"
	_ = os.Remove(tmp)

	f, err := os.Create(tmp)
	if err != nil {
		return err
	}

	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	// Headers must be written before body; first Write flushes status.

	// Tee: client gets bytes ASAP; disk gets full segment for next hit.
	var dest io.Writer = io.MultiWriter(w, f)
	if fl, ok := w.(http.Flusher); ok {
		dest = &flushWriter{w: dest, fl: fl}
	}

	encErr := transcode.StreamSegment(ctx, absPath, probe, start, dur, burnSub, dest)
	closeErr := f.Close()

	if encErr != nil {
		os.Remove(tmp)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return encErr
	}
	if closeErr != nil {
		os.Remove(tmp)
		return closeErr
	}
	if st, err := os.Stat(tmp); err != nil || st.Size() == 0 {
		os.Remove(tmp)
		return fmt.Errorf("segment kosong")
	}
	if err := os.Rename(tmp, outPath); err != nil {
		os.Remove(tmp)
		return err
	}
	log.Printf("[hls] cached seg %d (stream-through): %s", index, filepath.Base(outPath))
	return nil
}

func serveFile(w http.ResponseWriter, path string, st os.FileInfo) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w.Header().Set("Content-Type", "video/mp2t")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	_, err = io.Copy(w, f)
	return err
}

// flushWriter flushes HTTP after each write so first ffmpeg bytes reach client early.
type flushWriter struct {
	w  io.Writer
	fl http.Flusher
}

func (f *flushWriter) Write(p []byte) (int, error) {
	n, err := f.w.Write(p)
	if n > 0 {
		f.fl.Flush()
	}
	return n, err
}

// CleanCache removes HLS cache files older than maxAge under cacheRoot/hls.
func CleanCache(cacheRoot string, maxAge time.Duration) {
	root := CacheDir(cacheRoot)
	cutoff := time.Now().Add(-maxAge)
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			if removeErr := os.Remove(path); removeErr == nil {
				log.Printf("cache: hapus hls lama: %s", filepath.Base(path))
			}
		}
		return nil
	})
}
