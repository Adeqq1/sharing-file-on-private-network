package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"
)

// ── Semaphore untuk limit concurrent subtitle extract ────────────────────────

// maxConcurrentExtracts membatasi jumlah proses ffmpeg subtitle-extract yang
// berjalan bersamaan. Nilai 1 memastikan extract berjalan serial — tidak ada
// dua ffmpeg extract yang bersaing untuk CPU/disk secara bersamaan.
//
// Alasan nilai 1 (bukan 2+):
//   - Extract subtitle text-based biasanya selesai dalam 5–60 detik.
//   - Antrian serial OK untuk LAN rumah — user tidak akan pilih 2 subtitle sekaligus.
//   - Yang paling penting: tidak ada extract yang bersaing dengan transcode video
//     yang sedang streaming ke HP (buffer browser HP hanya 5–15 detik).
const maxConcurrentExtracts = 1

var extractSem = make(chan struct{}, maxConcurrentExtracts)

// acquireExtract mengambil slot semaphore. Blokir sampai ada slot kosong
// atau context di-cancel. Mengembalikan false kalau context di-cancel.
func acquireExtract(ctx context.Context) bool {
	select {
	case extractSem <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

// releaseExtract melepas slot semaphore.
func releaseExtract() {
	<-extractSem
}

// Track merepresentasikan satu stream subtitle di dalam file video.
type Track struct {
	Index   int    `json:"index"`   // index stream global (dipakai di -map 0:N saat extract)
	Codec   string `json:"codec"`   // codec_name dari ffprobe (mis. "subrip", "ass", "mov_text")
	Lang    string `json:"lang"`    // kode bahasa ISO 639 (mis. "ind", "eng") — bisa kosong
	Title   string `json:"title"`   // judul track dari metadata — bisa kosong
	Default bool   `json:"default"` // true kalau disposition.default == 1
	Forced  bool   `json:"forced"`  // true kalau disposition.forced == 1
	Image   bool   `json:"image"`   // true untuk PGS, VobSub, dll — butuh burn-in, tidak bisa WebVTT
}

// IsTextBased mengembalikan true kalau codec subtitle adalah text-based
// dan bisa dikonversi ke WebVTT oleh ffmpeg.
// Image-based codec (PGS, VobSub) di-skip karena butuh OCR.
func (t Track) IsTextBased() bool {
	switch strings.ToLower(t.Codec) {
	case "subrip", "ass", "ssa", "mov_text", "webvtt", "text":
		return true
	}
	return false
}

// IsImageBased mengembalikan true untuk codec subtitle berbasis gambar
// yang tidak bisa dikonversi ke WebVTT — butuh burn-in via ffmpeg filter.
func (t Track) IsImageBased() bool {
	switch strings.ToLower(t.Codec) {
	case "hdmv_pgs_subtitle", "pgssub", "dvd_subtitle", "dvb_subtitle", "dvbsub", "vobsub", "xsub":
		return true
	}
	return false
}

// Probe menjalankan ffprobe pada file video dan mengembalikan list subtitle stream
// yang text-based (image-based di-skip).
//
// Mengembalikan error kalau ffprobePath kosong, ffprobe gagal, atau output tidak bisa di-parse.
// Error ini tidak fatal untuk caller — caller boleh silent-ignore dan lanjut tanpa embedded subtitle.
func Probe(ctx context.Context, ffprobePath, videoPath string) ([]Track, error) {
	if ffprobePath == "" {
		return nil, fmt.Errorf("ffprobe tidak tersedia")
	}

	args := []string{
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		"-select_streams", "s", // hanya subtitle stream
		videoPath,
	}

	// Timeout 30 detik agar tidak hang kalau file rusak atau disk lambat
	pCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	out, err := exec.CommandContext(pCtx, ffprobePath, args...).Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe gagal: %w", err)
	}

	// Parse output JSON dari ffprobe
	var raw struct {
		Streams []struct {
			Index     int               `json:"index"`
			CodecName string            `json:"codec_name"`
			Tags      map[string]string `json:"tags"`
			Disp      map[string]int    `json:"disposition"`
		} `json:"streams"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse ffprobe output gagal: %w", err)
	}

	var tracks []Track
	for _, s := range raw.Streams {
		t := Track{
			Index:   s.Index,
			Codec:   s.CodecName,
			Lang:    strings.ToLower(s.Tags["language"]),
			Title:   s.Tags["title"],
			Default: s.Disp["default"] == 1,
			Forced:  s.Disp["forced"] == 1,
		}
		if t.IsImageBased() {
			// Include image-based dengan flag Image=true — frontend akan pakai burn-in
			t.Image = true
			tracks = append(tracks, t)
			continue
		}
		// Hanya include text-based codec yang dikenal
		if !t.IsTextBased() {
			continue
		}
		tracks = append(tracks, t)
	}
	return tracks, nil
}

// Extract mengekstrak subtitle stream ke-streamIndex dari videoPath dan mengembalikan
// konten dalam format WebVTT sebagai []byte.
//
// ffmpeg otomatis konversi SRT/ASS/mov_text ke WebVTT.
// Untuk ASS/SSA, styling kompleks (color, position) akan hilang — hanya teks dan timing.
//
// streamIndex adalah nilai Track.Index yang didapat dari Probe().
//
// Fix buffering di HP (issue #38):
//   - Semaphore: maks 1 extract berjalan bersamaan agar tidak bersaing dengan transcode.
//   - -threads 1: batasi CPU usage ffmpeg extract agar transcode streaming tidak terganggu.
//   - applyLowPriority: set process priority rendah (Below Normal di Windows, nice 10 di Unix).
//   - Refactor ke Start/Wait: diperlukan agar applyNiceFunc bisa dipanggil setelah Start.
func Extract(ctx context.Context, ffmpegPath, videoPath string, streamIndex int) ([]byte, error) {
	if ffmpegPath == "" {
		return nil, fmt.Errorf("ffmpeg tidak tersedia")
	}

	// Antri di semaphore — maks 1 extract berjalan bersamaan.
	// Ini mencegah banyak request subtitle paralel men-spawn banyak ffmpeg
	// yang bersaing dengan transcode video yang sedang streaming ke HP.
	if !acquireExtract(ctx) {
		return nil, ctx.Err()
	}
	defer releaseExtract()

	start := time.Now()
	log.Printf("[embed] extract subtitle stream %d dari %s — mulai", streamIndex, videoPath)

	args := []string{
		"-v", "error",
		// Batasi decoder thread ke 1 — subtitle extract sangat ringan,
		// tidak perlu banyak thread. Ini membebaskan CPU core untuk transcode.
		"-threads", "1",
		"-i", videoPath,
		"-map", fmt.Sprintf("0:%d", streamIndex),
		// Skip video & audio stream — kita hanya butuh subtitle.
		// Tanpa flag ini, ffmpeg demux full stream untuk file besar (HEVC 1080p)
		// yang bisa makan 30-120 detik. Dengan -vn -an, extract jadi 5-10x lebih cepat.
		"-vn", "-an",
		// Skip data streams & attachments (font, cover art) yang ada di MKV
		"-dn",
		// Batasi encoder thread ke 1 juga (flag setelah -i berlaku untuk encoder)
		"-threads", "1",
		"-c:s", "webvtt",
		"-f", "webvtt",
		"-", // output ke stdout
	}

	// Timeout 180 detik — file MKV besar (10+ GB) bisa butuh waktu lebih lama
	// walaupun sudah pakai -vn -an karena tetap perlu read container header.
	pCtx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	cmd := exec.CommandContext(pCtx, ffmpegPath, args...)

	// Set process priority rendah agar ffmpeg extract mengalah pada transcode.
	// Di Windows: BELOW_NORMAL_PRIORITY_CLASS via CreationFlags.
	// Di Unix: Setpgid=true, lalu nice 10 di-apply setelah Start().
	applyLowPriority(cmd)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	// Pakai Start+Wait (bukan Output) agar bisa apply nice setelah Start di Unix.
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("ffmpeg start gagal (stream %d): %w", streamIndex, err)
	}

	// Unix: apply nice value setelah Start() karena PID baru tersedia setelah Start.
	// Windows: applyNiceFunc = nil, baris ini no-op.
	if applyNiceFunc != nil {
		applyNiceFunc(cmd.Process.Pid)
	}

	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("ffmpeg extract gagal (stream %d): %w", streamIndex, err)
	}

	out := stdout.Bytes()
	log.Printf("[embed] extract stream %d selesai (%d bytes, %.1fs)", streamIndex, len(out), time.Since(start).Seconds())
	return out, nil
}
