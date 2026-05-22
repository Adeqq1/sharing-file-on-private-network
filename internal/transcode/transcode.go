package transcode

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// ── Deteksi ketersediaan ffmpeg/ffprobe ──────────────────────────────────────

var (
	once        sync.Once
	ffmpegPath  string
	ffprobePath string
	ffmpegVer   string
)

func init() {
	// Inisialisasi saat package pertama kali di-import.
	once.Do(detect)
}

func detect() {
	ffmpegPath = lookupBinary("ffmpeg")
	ffprobePath = lookupBinary("ffprobe")

	if ffmpegPath != "" {
		// Ambil versi dari baris pertama output "ffmpeg -version"
		out, e := exec.Command(ffmpegPath, "-version").Output()
		if e == nil {
			line := strings.SplitN(string(out), "\n", 2)[0]
			// Contoh: "ffmpeg version 6.1.1 Copyright ..."
			parts := strings.Fields(line)
			if len(parts) >= 3 {
				ffmpegVer = parts[2]
			}
		}
	}
}

// lookupBinary mencari binary di PATH, lalu fallback ke lokasi umum winget/choco/scoop.
// Fallback path hanya dicek di Windows.
func lookupBinary(name string) string {
	// 1. Cari di PATH standar (semua OS)
	if p, err := exec.LookPath(name); err == nil {
		return p
	}

	// 2. Fallback: lokasi umum instalasi ffmpeg di Windows saja
	if runtime.GOOS != "windows" {
		return ""
	}

	homeDir, _ := os.UserHomeDir()
	candidates := []string{
		// winget (Gyan.FFmpeg) — cari semua versi
		filepath.Join(homeDir, "AppData", "Local", "Microsoft", "WinGet", "Packages"),
		// Chocolatey
		`C:\ProgramData\chocolatey\bin`,
		// Scoop
		filepath.Join(homeDir, "scoop", "shims"),
		// Manual install umum
		`C:\ffmpeg\bin`,
		`C:\Program Files\ffmpeg\bin`,
		`C:\Program Files (x86)\ffmpeg\bin`,
	}

	exe := name + ".exe"

	for _, dir := range candidates {
		// Untuk winget, perlu rekursif karena ada subfolder versi
		if strings.Contains(dir, "WinGet") {
			if found := findInDir(dir, exe, 4); found != "" {
				return found
			}
			continue
		}
		p := filepath.Join(dir, exe)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// findInDir mencari file secara rekursif sampai kedalaman maxDepth.
func findInDir(dir, filename string, maxDepth int) string {
	if maxDepth <= 0 {
		return ""
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())
		if !e.IsDir() {
			if strings.EqualFold(e.Name(), filename) {
				return full
			}
		} else {
			if found := findInDir(full, filename, maxDepth-1); found != "" {
				return found
			}
		}
	}
	return ""
}

// FindFFmpeg mengembalikan absolute path binary ffmpeg, atau "" jika tidak ada.
func FindFFmpeg() string { return ffmpegPath }

// FindFFprobe mengembalikan absolute path binary ffprobe, atau "" jika tidak ada.
func FindFFprobe() string { return ffprobePath }

// Available mengembalikan true jika ffmpeg DAN ffprobe tersedia di PATH.
func Available() bool { return ffmpegPath != "" && ffprobePath != "" }

// Version mengembalikan string versi ffmpeg (mis. "6.1.1"), atau "" jika tidak ada.
func Version() string { return ffmpegVer }

// ── Semaphore untuk limit concurrent transcode ───────────────────────────────

// maxConcurrentTranscodes adalah batas maksimum proses ffmpeg transcode yang
// berjalan bersamaan. Default 2 — cukup untuk LAN rumah tanpa overload CPU.
// Remux (copy codec) tidak dihitung karena hampir tidak pakai CPU.
const maxConcurrentTranscodes = 2

// transcodeSem adalah semaphore berbasis channel buffered.
var transcodeSem = make(chan struct{}, maxConcurrentTranscodes)

// acquireTranscode mengambil slot semaphore. Blokir sampai ada slot kosong
// atau context di-cancel. Mengembalikan false kalau context di-cancel.
func acquireTranscode(ctx context.Context) bool {
	select {
	case transcodeSem <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

// releaseTranscode melepas slot semaphore.
func releaseTranscode() {
	<-transcodeSem
}

// ── Streaming transcode/remux ─────────────────────────────────────────────────

// Stream menjalankan ffmpeg dengan argumen yang sesuai berdasarkan hasil probe,
// lalu pipe stdout ffmpeg ke out (biasanya http.ResponseWriter).
//
// Strategi dipilih otomatis:
//   - Remux only       : video H.264 + audio AAC/MP3/Opus → -c copy
//   - Audio transcode  : video OK, audio exotic (AC3/DTS/FLAC) → -c:v copy -c:a aac
//   - Full transcode   : video bukan H.264 (HEVC, WMV, dll) → -c:v libx264 -c:a aac
//
// Context cancel akan kill proses ffmpeg — penting agar tidak ada zombie process
// saat user menutup player.
//
// Untuk full/audio transcode, semaphore dipakai agar max 2 proses berjalan
// bersamaan. Remux tidak dibatasi karena hampir tidak pakai CPU.
func Stream(ctx context.Context, absPath string, probe *ProbeResult, out io.Writer) error {
	args := buildFFmpegArgs(absPath, probe)
	strategy := strategyName(probe)

	// Batasi concurrent transcode (bukan remux) via semaphore
	if strategy != "remux" {
		if !acquireTranscode(ctx) {
			return ctx.Err()
		}
		defer releaseTranscode()
	}

	cmd := exec.CommandContext(ctx, ffmpegPath, args...)

	// Capture stderr ke buffer terbatas (10 KB) untuk logging error.
	var stderrBuf bytes.Buffer
	cmd.Stderr = &limitedWriter{w: &stderrBuf, limit: 10 * 1024}
	cmd.Stdout = out

	log.Printf("[transcode] start: %s (%s)", absPath, strategy)

	err := cmd.Run()

	if ctx.Err() != nil {
		// Request di-cancel oleh client (user tutup player) — bukan error nyata.
		log.Printf("[transcode] dibatalkan: %s", absPath)
		return ctx.Err()
	}
	if err != nil {
		stderr := strings.TrimSpace(stderrBuf.String())
		if stderr != "" {
			log.Printf("[transcode] error: %s\nffmpeg stderr:\n%s", absPath, stderr)
		} else {
			log.Printf("[transcode] error: %s — %v", absPath, err)
		}
		return err
	}

	log.Printf("[transcode] selesai: %s", absPath)
	return nil
}

// buildFFmpegArgs memilih argumen ffmpeg berdasarkan codec di probe.
func buildFFmpegArgs(absPath string, probe *ProbeResult) []string {
	// Argumen dasar: tidak tampilkan banner, tidak interaktif
	base := []string{
		"-hide_banner", "-loglevel", "error",
		"-i", absPath,
		"-map", "0:v:0",
		"-map", "0:a:0?", // "?" = opsional, kalau tidak ada audio tetap jalan
	}

	// Pilih strategi codec
	videoOK := probe != nil && VideoCodecCompatible(probe.VideoCodec())
	audioOK := probe != nil && AudioCodecCompatible(probe.AudioCodec())

	var codecArgs []string
	switch {
	case videoOK && audioOK:
		// Remux: copy semua stream tanpa re-encode (~0% CPU)
		codecArgs = []string{"-c", "copy"}
	case videoOK && !audioOK:
		// Audio transcode only: video di-copy, audio di-encode ke AAC stereo
		codecArgs = []string{
			"-c:v", "copy",
			"-c:a", "aac", "-b:a", "192k", "-ac", "2",
		}
	default:
		// Full transcode: video ke H.264, audio ke AAC
		codecArgs = []string{
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
			"-c:a", "aac", "-b:a", "192k", "-ac", "2",
		}
	}

	// Output: fragmented MP4 ke stdout (pipe:1)
	// frag_keyframe+empty_moov+default_base_moof = bisa di-play sebelum file selesai
	outputArgs := []string{
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-reset_timestamps", "1",
		"pipe:1",
	}

	// Pre-allocate slice dengan ukuran tepat untuk menghindari aliasing.
	// append(base, ...) bisa modify backing array base kalau cap > len.
	total := len(base) + len(codecArgs) + len(outputArgs)
	args := make([]string, 0, total)
	args = append(args, base...)
	args = append(args, codecArgs...)
	args = append(args, outputArgs...)
	return args
}

// strategyName mengembalikan nama strategi untuk logging.
func strategyName(probe *ProbeResult) string {
	if probe == nil {
		return "full transcode"
	}
	videoOK := VideoCodecCompatible(probe.VideoCodec())
	audioOK := AudioCodecCompatible(probe.AudioCodec())
	switch {
	case videoOK && audioOK:
		return "remux"
	case videoOK:
		return "audio transcode"
	default:
		return "full transcode"
	}
}

// ExtractSubtitle mengekstrak satu subtitle stream dari file video ke file WebVTT.
// trackIdx adalah index stream (dari ffprobe). Output ditulis ke outPath.
// Timeout 30 detik.
func ExtractSubtitle(ctx context.Context, absPath string, trackIdx int, outPath string) error {
	if ffmpegPath == "" {
		return fmt.Errorf("ffmpeg tidak tersedia")
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffmpegPath,
		"-hide_banner", "-loglevel", "error",
		"-i", absPath,
		"-map", fmt.Sprintf("0:%d", trackIdx),
		"-c:s", "webvtt",
		"-f", "webvtt",
		outPath,
	)

	var stderrBuf bytes.Buffer
	cmd.Stderr = &limitedWriter{w: &stderrBuf, limit: 10 * 1024}

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		stderr := strings.TrimSpace(stderrBuf.String())
		if stderr != "" {
			return fmt.Errorf("%w\nffmpeg: %s", err, stderr)
		}
		return err
	}
	return nil
}

type limitedWriter struct {
	w     io.Writer
	limit int
	n     int
}

func (lw *limitedWriter) Write(p []byte) (int, error) {
	if lw.n >= lw.limit {
		return len(p), nil // buang saja, jangan error
	}
	remaining := lw.limit - lw.n
	if len(p) > remaining {
		p = p[:remaining]
	}
	n, err := lw.w.Write(p)
	lw.n += n
	return len(p), err // kembalikan len asli agar ffmpeg tidak bingung
}
