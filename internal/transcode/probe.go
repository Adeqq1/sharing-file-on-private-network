package transcode

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ── Struct hasil probe ────────────────────────────────────────────────────────

// StreamInfo menyimpan info satu stream (video/audio/subtitle) di dalam file.
type StreamInfo struct {
	Index   int    `json:"index"`   // index stream di file (0, 1, 2, ...)
	Type    string `json:"type"`    // "video" | "audio" | "subtitle"
	Codec   string `json:"codec"`   // "h264", "hevc", "aac", "ac3", "subrip", "ass", ...
	Lang    string `json:"lang"`    // kode bahasa ISO 639 (mis. "ind", "eng", "")
	Title   string `json:"title"`   // dari tag title stream
	Default bool   `json:"default"` // disposition default
}

// ProbeResult menyimpan hasil ffprobe untuk satu file.
type ProbeResult struct {
	FormatName string       `json:"format_name"` // "matroska", "mov,mp4,m4a", ...
	Duration   float64      `json:"duration"`    // durasi dalam detik
	Streams    []StreamInfo `json:"streams"`
}

// VideoCodec mengembalikan codec video pertama yang ditemukan, atau "".
func (p *ProbeResult) VideoCodec() string {
	for _, s := range p.Streams {
		if s.Type == "video" {
			return s.Codec
		}
	}
	return ""
}

// AudioCodec mengembalikan codec audio pertama yang ditemukan, atau "".
func (p *ProbeResult) AudioCodec() string {
	for _, s := range p.Streams {
		if s.Type == "audio" {
			return s.Codec
		}
	}
	return ""
}

// SubtitleStreams mengembalikan semua stream subtitle yang bisa di-convert ke WebVTT.
// Format image-based (pgssub, dvd_subtitle, dvbsub) di-skip.
func (p *ProbeResult) SubtitleStreams() []StreamInfo {
	var result []StreamInfo
	for _, s := range p.Streams {
		if s.Type != "subtitle" {
			continue
		}
		if isImageSubtitle(s.Codec) {
			continue
		}
		result = append(result, s)
	}
	return result
}

// isImageSubtitle mengembalikan true untuk codec subtitle berbasis gambar
// yang tidak bisa di-convert ke WebVTT teks.
func isImageSubtitle(codec string) bool {
	switch strings.ToLower(codec) {
	case "pgssub", "hdmv_pgs_subtitle", "dvd_subtitle", "dvbsub",
		"dvb_subtitle", "xsub", "vobsub":
		return true
	}
	return false
}

// ── Kompatibilitas codec browser ─────────────────────────────────────────────

// VideoCodecCompatible mengembalikan true jika codec video bisa diputar
// langsung di browser HTML5 tanpa re-encode.
func VideoCodecCompatible(codec string) bool {
	switch strings.ToLower(codec) {
	case "h264", "avc", "vp8", "vp9", "av1":
		return true
	}
	return false
}

// AudioCodecCompatible mengembalikan true jika codec audio bisa diputar
// langsung di browser HTML5 tanpa re-encode.
func AudioCodecCompatible(codec string) bool {
	switch strings.ToLower(codec) {
	case "aac", "mp3", "opus", "vorbis", "mp2":
		return true
	}
	return false
}

// NeedsTranscode mengembalikan true jika file perlu di-remux atau di-transcode
// sebelum bisa diputar di browser HTML5.
//
// Kondisi yang memerlukan transcode/remux:
//   - Format container bukan mp4/webm/mov (mis. MKV selalu di-remux ke fMP4
//     agar Content-Type jadi video/mp4 yang semua browser support)
//   - Codec video bukan H.264/VP8/VP9/AV1
//   - Codec audio bukan AAC/MP3/Opus/Vorbis
func NeedsTranscode(p *ProbeResult) bool {
	if p == nil {
		return true
	}
	// MKV/AVI/WMV/FLV/TS selalu di-remux ke fMP4 agar browser mobile support.
	// Walaupun codec H.264+AAC, container matroska tidak reliable di semua browser.
	if !isBrowserNativeContainer(p.FormatName) {
		return true
	}
	// Cek codec video
	if vc := p.VideoCodec(); vc != "" && !VideoCodecCompatible(vc) {
		return true
	}
	// Cek codec audio
	if ac := p.AudioCodec(); ac != "" && !AudioCodecCompatible(ac) {
		return true
	}
	return false
}

// isBrowserNativeContainer mengembalikan true untuk container yang semua browser
// support secara native tanpa remux (MP4, WebM, MOV).
// MKV/matroska TIDAK termasuk karena tidak reliable di browser mobile.
// Catatan: ffprobe mengembalikan "matroska,webm" untuk file MKV — kita cek
// apakah "matroska" ada di string format, kalau ada → bukan native container.
func isBrowserNativeContainer(format string) bool {
	lower := strings.ToLower(format)
	// Kalau ada "matroska" → ini MKV, selalu perlu remux
	if strings.Contains(lower, "matroska") {
		return false
	}
	for _, f := range strings.Split(lower, ",") {
		f = strings.TrimSpace(f)
		switch f {
		case "mp4", "webm", "mov", "m4v":
			return true
		}
	}
	return false
}

// ── Cache probe result (LRU sederhana) ───────────────────────────────────────

type cacheEntry struct {
	result  *ProbeResult
	modTime time.Time
	lastUse time.Time
}

const maxCacheSize = 100

var (
	cacheMu    sync.Mutex
	probeCache = make(map[string]*cacheEntry, maxCacheSize)
)

func cacheKey(absPath string, modTime time.Time) string {
	return fmt.Sprintf("%s|%d", absPath, modTime.UnixNano())
}

func cacheGet(absPath string, modTime time.Time) (*ProbeResult, bool) {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	e, ok := probeCache[cacheKey(absPath, modTime)]
	if !ok {
		return nil, false
	}
	e.lastUse = time.Now()
	return e.result, true
}

func cacheSet(absPath string, modTime time.Time, result *ProbeResult) {
	cacheMu.Lock()
	defer cacheMu.Unlock()

	// Evict entry paling lama dipakai kalau sudah penuh
	if len(probeCache) >= maxCacheSize {
		var oldestKey string
		var oldestTime time.Time
		for k, e := range probeCache {
			if oldestKey == "" || e.lastUse.Before(oldestTime) {
				oldestKey = k
				oldestTime = e.lastUse
			}
		}
		delete(probeCache, oldestKey)
	}

	probeCache[cacheKey(absPath, modTime)] = &cacheEntry{
		result:  result,
		modTime: modTime,
		lastUse: time.Now(),
	}
}

// ── Fungsi Probe utama ────────────────────────────────────────────────────────

// ffprobeOutput adalah struct internal untuk parse JSON output ffprobe.
type ffprobeOutput struct {
	Format struct {
		FormatName string            `json:"format_name"`
		Duration   string            `json:"duration"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Index       int    `json:"index"`
		CodecType   string `json:"codec_type"`
		CodecName   string `json:"codec_name"`
		Disposition struct {
			Default int `json:"default"`
		} `json:"disposition"`
		Tags map[string]string `json:"tags"`
	} `json:"streams"`
}

// Probe menjalankan ffprobe pada file dan mengembalikan info codec & stream.
// Hasil di-cache berdasarkan path + modtime. Timeout 10 detik.
func Probe(absPath string, modTime time.Time) (*ProbeResult, error) {
	if ffprobePath == "" {
		return nil, fmt.Errorf("ffprobe tidak tersedia")
	}

	// Cek cache dulu
	if cached, ok := cacheGet(absPath, modTime); ok {
		return cached, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffprobePath,
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		absPath,
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe gagal: %w — %s", err, strings.TrimSpace(stderr.String()))
	}

	var raw ffprobeOutput
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		return nil, fmt.Errorf("gagal parse output ffprobe: %w", err)
	}

	result := &ProbeResult{
		FormatName: raw.Format.FormatName,
	}

	// Parse durasi
	if raw.Format.Duration != "" {
		var dur float64
		fmt.Sscanf(raw.Format.Duration, "%f", &dur)
		result.Duration = dur
	}

	// Parse streams
	for _, s := range raw.Streams {
		si := StreamInfo{
			Index:   s.Index,
			Type:    s.CodecType,
			Codec:   s.CodecName,
			Default: s.Disposition.Default == 1,
		}
		// Ambil bahasa dari tags
		if lang, ok := s.Tags["language"]; ok {
			si.Lang = lang
		}
		if title, ok := s.Tags["title"]; ok {
			si.Title = title
		}
		result.Streams = append(result.Streams, si)
	}

	cacheSet(absPath, modTime, result)
	return result, nil
}
