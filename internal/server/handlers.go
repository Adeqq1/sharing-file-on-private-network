package server

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"lan-server/internal/embed"
	"lan-server/internal/files"
	"lan-server/internal/history"
	"lan-server/internal/media"
	"lan-server/internal/subtitle"
	"lan-server/internal/transcode"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// fileWithoutConn membungkus io.ReadSeeker untuk menyembunyikan interface
// syscall.Conn dari *os.File. Ini mencegah Go memakai TransmitFile di Windows,
// yang bisa terputus di sekitar 2 GiB untuk file besar, sambil tetap
// mempertahankan dukungan Range via http.ServeContent.
type fileWithoutConn struct {
	io.ReadSeeker
}

// writeJSON menulis response JSON dengan status code tertentu.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// resolveSafeOrRespond adalah helper: resolve path aman, atau tulis error response dan return false.
func resolveSafeOrRespond(w http.ResponseWriter, sharedRoot, relPath string) (string, bool) {
	target, err := files.ResolveSafe(sharedRoot, relPath)
	if err != nil {
		if errors.Is(err, files.ErrPathNotAllowed) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak diizinkan"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return "", false
	}
	return target, true
}

// HandleFiles menangani GET /api/files?path=<relative>
func HandleFiles(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		relPath := r.URL.Query().Get("path")
		result, err := files.List(cfg.SharedFolder, relPath)
		if err != nil {
			if errors.Is(err, files.ErrPathNotAllowed) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak diizinkan"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, http.StatusOK, result)
	}
}

// HandleStream menangani GET /api/stream?path=<relative>
// TIDAK set Content-Disposition attachment — browser memutar langsung.
// http.ServeContent tetap handle Range request untuk seek.
func HandleStream(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}

		info, err := os.Stat(target)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}
		if info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tidak bisa stream folder"})
			return
		}
		if info.Size() == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file kosong, tidak bisa di-stream"})
			return
		}

		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
		if mime := media.MIMEOf(ext); mime != "" {
			w.Header().Set("Content-Type", mime)
		}

		w.Header().Set("Cache-Control", "private, max-age=300")
		// Accept-Ranges sudah di-handle oleh http.ServeContent, tapi kita
		// set eksplisit sebagai hint ke browser bahwa file ini seekable.
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		file, err := os.Open(target)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membuka file"})
			return
		}
		defer file.Close()
		if fileInfo, err := file.Stat(); err == nil {
			info = fileInfo
		}

		http.ServeContent(w, r, info.Name(), info.ModTime(), fileWithoutConn{file})
	}
}

// HandleSubtitle menangani GET /api/subtitle?path=<video-path>&lang=<id|en|embed:N|...>
func HandleSubtitle(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Handle CORS preflight — mobile browser (Chrome Android) mengirim OPTIONS
		// sebelum fetch <track> subtitle karena dianggap cross-origin subresource.
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Range, Cookie")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		relPath := r.URL.Query().Get("path")
		lang := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("lang")))
		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, relPath)
		if !ok {
			return
		}

		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}

		// Cek apakah ini request embedded subtitle (lang = "embed:<streamIndex>")
		if strings.HasPrefix(lang, "embed:") {
			indexStr := strings.TrimPrefix(lang, "embed:")
			streamIndex, err := strconv.Atoi(indexStr)
			if err != nil || streamIndex < 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "stream index tidak valid"})
				return
			}
			var offsetSec float64
			if oStr := strings.TrimSpace(r.URL.Query().Get("offset")); oStr != "" {
				if v, perr := strconv.ParseFloat(oStr, 64); perr == nil && v > 0 {
					offsetSec = v
				}
			}
			serveEmbeddedSubtitle(w, r, cfg, target, streamIndex, offsetSec)
			return
		}

		dir := filepath.Dir(target)
		base := strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))

		// Baca semua entri di folder lalu cari subtitle yang cocok via MatchSubtitleFile.
		// Pendekatan ini mendukung semua pola penamaan (., _, -) dan case-insensitive.
		entries, err := os.ReadDir(dir)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membaca folder"})
			return
		}

		type foundSub struct {
			path  string
			isSRT bool
			lang  string // "" = default
		}
		var matches []foundSub
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			matchLang, ok := subtitle.MatchSubtitleFile(base, e.Name())
			if !ok {
				continue
			}
			matches = append(matches, foundSub{
				path:  filepath.Join(dir, e.Name()),
				isSRT: strings.EqualFold(filepath.Ext(e.Name()), ".srt"),
				lang:  matchLang,
			})
		}

		// Pilih subtitle dengan prioritas:
		// 1. Lang yang diminta + VTT (tidak perlu konversi)
		// 2. Lang yang diminta + SRT
		// 3. Default ("") + VTT
		// 4. Default ("") + SRT
		// 5. Subtitle pertama yang ditemukan (fallback)
		var chosen *foundSub
		priorities := []struct {
			wantLang string
		}{
			{lang},
			{""},
		}
		for _, p := range priorities {
			// Coba VTT dulu
			for i := range matches {
				if matches[i].lang == p.wantLang && !matches[i].isSRT {
					chosen = &matches[i]
					break
				}
			}
			if chosen != nil {
				break
			}
			// Lalu SRT
			for i := range matches {
				if matches[i].lang == p.wantLang {
					chosen = &matches[i]
					break
				}
			}
			if chosen != nil {
				break
			}
		}
		// Fallback: subtitle pertama yang ada
		if chosen == nil && len(matches) > 0 {
			chosen = &matches[0]
		}

		if chosen == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "subtitle tidak ditemukan"})
			return
		}

		data, err := os.ReadFile(chosen.path)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membaca subtitle"})
			return
		}

		w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// Parse ?offset= untuk shift timestamp subtitle agar sinkron dengan seek transcode.
		// ffmpeg -reset_timestamps 1 membuat output fMP4 selalu mulai dari t=0,
		// tapi subtitle masih punya timestamp absolut. Kurangi offset agar sinkron.
		var offsetSec float64
		if oStr := strings.TrimSpace(r.URL.Query().Get("offset")); oStr != "" {
			if v, err := strconv.ParseFloat(oStr, 64); err == nil && v > 0 {
				offsetSec = v
			}
		}

		var vttContent string
		if chosen.isSRT {
			vttContent = subtitle.SRTToVTT(data)
		} else {
			vttContent = subtitle.StripBOM(subtitle.ToUTF8(data))
		}
		if offsetSec > 0 {
			vttContent = subtitle.ShiftVTT(vttContent, offsetSec)
		}
		w.Write([]byte(vttContent))
	}
}

// serveEmbeddedSubtitle mengekstrak subtitle stream dari file video pakai ffmpeg
// dan mengirimnya sebagai WebVTT. Hasil di-cache di disk.
// offsetSec > 0: shift timestamp VTT agar sinkron dengan transcode yang di-seek.
func serveEmbeddedSubtitle(w http.ResponseWriter, r *http.Request, cfg *Config, videoPath string, streamIndex int, offsetSec float64) {
	ffmpeg := cfg.FFmpegBinary()
	if ffmpeg == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "ffmpeg tidak tersedia di server. Install ffmpeg dan restart server.",
		})
		return
	}

	// Cek cache dulu — hindari extract berulang untuk file yang sama
	key, err := embed.CacheKey(videoPath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membaca info file"})
		return
	}
	if cached, ok := embed.ReadCache(cfg.CacheDir(), key, streamIndex); ok {
		w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache") // jangan cache karena offset bisa beda
		w.Header().Set("Access-Control-Allow-Origin", "*")
		vtt := string(cached)
		if offsetSec > 0 {
			vtt = subtitle.ShiftVTT(vtt, offsetSec)
		}
		w.Write([]byte(vtt))
		return
	}

	// Extract via ffmpeg
	data, err := embed.Extract(r.Context(), ffmpeg, videoPath, streamIndex)
	if err != nil {
		log.Printf("embed.Extract gagal (stream %d, %s): %v", streamIndex, videoPath, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "gagal mengekstrak subtitle dari video",
		})
		return
	}

	// Simpan ke cache (silent error — tidak fatal)
	if cacheErr := embed.WriteCache(cfg.CacheDir(), key, streamIndex, data); cacheErr != nil {
		log.Printf("embed.WriteCache gagal: %v", cacheErr)
	}

	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	vtt := string(data)
	if offsetSec > 0 {
		vtt = subtitle.ShiftVTT(vtt, offsetSec)
	}
	w.Write([]byte(vtt))
}

// HandleSubtitles menangani GET /api/subtitles?path=<video-path>
// Mengembalikan list subtitle: file eksternal (.srt/.vtt) + embedded stream dari MKV/MP4.
func HandleSubtitles(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		relPath := r.URL.Query().Get("path")
		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, relPath)
		if !ok {
			return
		}
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}

		dir := filepath.Dir(target)
		baseName := strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))

		entries, err := os.ReadDir(dir)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membaca folder"})
			return
		}

		type subInfo struct {
			Lang   string `json:"lang"`
			Label  string `json:"label"`
			Source string `json:"source"`          // "external" atau "embedded"
			Track  int    `json:"track,omitempty"` // index stream (hanya untuk embedded)
			Image  bool   `json:"image,omitempty"` // true untuk PGS dll → butuh burn-in
		}
		var results []subInfo

		// 1. Scan file subtitle eksternal (.srt / .vtt)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			lang, ok := subtitle.MatchSubtitleFile(baseName, e.Name())
			if !ok {
				continue
			}
			label := "Default"
			if lang != "" {
				label = langLabel(lang)
			}
			results = append(results, subInfo{Lang: lang, Label: label, Source: "external"})
		}

		// 2. Scan embedded subtitle stream (MKV, MP4, MOV, WebM)
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
		if ext == "mkv" || ext == "mp4" || ext == "mov" || ext == "webm" {
			ffprobe := cfg.FFprobeBinary()
			if ffprobe != "" {
				tracks, probeErr := embed.Probe(r.Context(), ffprobe, target)
				if probeErr != nil {
					// Error ffprobe tidak fatal — log saja, lanjut dengan hasil eksternal
					log.Printf("embed.Probe gagal (%s): %v", info.Name(), probeErr)
				} else {
					for _, t := range tracks {
						// Normalisasi lang code (mis. "ind" → "id", "eng" → "en")
						lang := subtitle.LangAlias(t.Lang)
						if lang == "" {
							lang = t.Lang // pakai apa adanya kalau tidak dikenal
						}
						// Coba normalisasi dari Title kalau lang masih kosong
						if lang == "" && t.Title != "" {
							lang = subtitle.LangAlias(t.Title)
						}

						// Buat label yang informatif
						label := "Embedded"
						if t.Title != "" {
							label = t.Title
						} else if lang != "" {
							label = langLabel(lang)
						}
						label += " (Embedded)"

						// Untuk PGS/image-based, tambah keterangan burn-in
						if t.Image {
							label += " — perlu burn-in"
						}

						// Pakai prefix "embed:<index>" sebagai lang key
						// Frontend kirim kembali nilai ini ke /api/subtitle?lang=embed:N
						results = append(results, subInfo{
							Lang:   fmt.Sprintf("embed:%d", t.Index),
							Label:  label,
							Source: "embedded",
							Track:  t.Index,
							Image:  t.Image,
						})
					}
				}
			}
		}

		writeJSON(w, http.StatusOK, results)
	}
}

// langLabel menerjemahkan kode bahasa ke nama yang lebih ramah.
func langLabel(code string) string {
	labels := map[string]string{
		"id": "Indonesia", "en": "English",
		"ja": "日本語", "ko": "한국어", "zh": "中文",
		"es": "Español", "fr": "Français", "de": "Deutsch",
		"pt": "Português", "ar": "العربية",
		"th": "ไทย", "vi": "Tiếng Việt", "ms": "Melayu",
	}
	if l, ok := labels[strings.ToLower(code)]; ok {
		return l
	}
	return strings.ToUpper(code)
}

// ── Handler baru: Probe, Transcode, Embedded Subtitle ────────────────────────

// HandleProbe menangani GET /api/probe?path=<relative>
// Mengembalikan info codec & stream dari file via ffprobe.
// Endpoint ini opsional untuk frontend — dipakai sebagai hint saja.
func HandleProbe(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if !transcode.Available() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "ffmpeg tidak terinstall di server",
			})
			return
		}
		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}
		result, err := transcode.Probe(target, info.ModTime())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, http.StatusOK, result)
	}
}

// HandleTranscode menangani GET /api/transcode?path=<relative>
// Stream video sebagai fragmented MP4 via ffmpeg.
// Otomatis pilih strategi: remux / audio-transcode / full-transcode.
// Kalau file tidak butuh transcode → redirect 302 ke /api/stream.
func HandleTranscode(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if !transcode.Available() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"error": "ffmpeg tidak terinstall di server. Install ffmpeg untuk memutar format ini.",
			})
			return
		}

		relPath := r.URL.Query().Get("path")
		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, relPath)
		if !ok {
			return
		}

		info, err := os.Stat(target)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}
		if info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tidak bisa transcode folder"})
			return
		}
		if info.Size() == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file kosong"})
			return
		}

		probe, err := transcode.Probe(target, info.ModTime())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "gagal membaca info file: " + err.Error(),
			})
			return
		}

		// Kalau tidak butuh transcode → redirect ke /api/stream yang lebih efisien
		// Tapi: kalau burnSubIndex >= 0, JANGAN redirect — harus transcode untuk overlay subtitle.
		burnSubIndex := -1
		if bs := strings.TrimSpace(r.URL.Query().Get("burnSub")); bs != "" {
			if v, err := strconv.Atoi(bs); err == nil && v >= 0 {
				burnSubIndex = v
			}
		}

		// Optimasi Fase 1: kalau codec sudah kompatibel browser modern, redirect ke
		// /api/stream agar dapat Range support + Content-Length + ~0% CPU.
		//
		// MKV: bisa di-serve langsung di Chrome/Firefox, TAPI tidak di Safari/iOS.
		// Jadi cek User-Agent dulu sebelum redirect.
		//
		// PENTING: jangan redirect kalau ada ?t= (seek offset).
		// /api/stream pakai http.ServeFile yang mengabaikan ?t= — file selalu
		// di-serve dari byte 0. Seek harus tetap lewat ffmpeg (-ss flag) agar
		// video benar-benar mulai dari posisi yang diminta.
		tStr := strings.TrimSpace(r.URL.Query().Get("t"))
		hasSeek := tStr != "" && tStr != "0"

		if !hasSeek && burnSubIndex < 0 && transcode.CanDirectServe(probe) {
			isMKV := transcode.IsMKVContainer(probe)
			safariOrIOS := isSafariOrIOS(r.Header.Get("User-Agent"))

			// Direct-serve OK kalau:
			//   - Container bukan MKV (selalu aman: MP4/WebM/MOV), ATAU
			//   - Container MKV TAPI client bukan Safari/iOS
			if !isMKV || !safariOrIOS {
				http.Redirect(w, r, "/api/stream?path="+url.QueryEscape(relPath), http.StatusFound)
				return
			}
			// Safari + MKV → fall-through ke remux ffmpeg di bawah (tidak ada cara lain)
		}

		// Parse param ?t=<detik>. Kalau kosong/tidak ada → 0 (mulai dari awal).
		var startSec float64
		if tStr := strings.TrimSpace(r.URL.Query().Get("t")); tStr != "" {
			parsed, perr := strconv.ParseFloat(tStr, 64)
			if perr != nil || parsed < 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "parameter t tidak valid",
				})
				return
			}
			// Validasi: t tidak boleh ≥ durasi (kasih buffer 0.5 detik)
			if probe.Duration > 0 && parsed >= probe.Duration-0.5 {
				writeJSON(w, http.StatusBadRequest, map[string]string{
					"error": "t melebihi durasi video",
				})
				return
			}
			startSec = parsed
		}

		// Set header sebelum ffmpeg dijalankan — setelah body mulai dikirim, header tidak bisa diubah
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Cache-Control", "no-store")
		// Tidak set Content-Length karena ukuran output transcode tidak diketahui di awal

		if r.Method == http.MethodHead {
			return
		}

		if err := transcode.Stream(r.Context(), target, probe, startSec, burnSubIndex, w); err != nil {
			// Error setelah header dikirim tidak bisa dikembalikan sebagai HTTP error
			// Cukup log — client akan melihat koneksi terputus
			return
		}
	}
}

// HandleDownload menangani GET /api/download?path=<relative>
func HandleDownload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}

		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			http.Error(w, "file tidak ditemukan", http.StatusNotFound)
			return
		}

		file, err := os.Open(target)
		if err != nil {
			http.Error(w, "gagal membuka file", http.StatusInternalServerError)
			return
		}
		defer file.Close()
		if fileInfo, err := file.Stat(); err == nil {
			info = fileInfo
		}

		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
		http.ServeContent(w, r, info.Name(), info.ModTime(), fileWithoutConn{file})
	}
}

// uniqueDestPath mengembalikan path tujuan yang tidak bentrok dengan file existing.
func uniqueDestPath(dir, filename string) string {
	dest := filepath.Join(dir, filename)
	if _, err := os.Stat(dest); os.IsNotExist(err) {
		return dest
	}
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	for i := 1; i <= 999; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return dest
}

// HandleDownloadZip menangani GET /api/download-zip?path=<relative_folder>
// Stream isi folder sebagai arsip ZIP on-the-fly (tidak menyimpan ke disk).
// Mendukung juga banyak path: ?path=a&path=b → zip gabungan bernama download.zip.
// HEAD request didukung untuk preflight dari frontend (cek apakah path valid).
func HandleDownloadZip(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		rawPaths := r.URL.Query()["path"]
		if len(rawPaths) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path wajib diisi"})
			return
		}

		// Validasi semua path sebelum mulai streaming
		type resolvedEntry struct {
			abs   string
			isDir bool
			name  string
		}
		entries := make([]resolvedEntry, 0, len(rawPaths))
		for _, rp := range rawPaths {
			abs, err := files.ResolveSafe(cfg.SharedFolder, rp)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak diizinkan: " + rp})
				return
			}
			info, err := os.Stat(abs)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "tidak ditemukan: " + rp})
				return
			}
			entries = append(entries, resolvedEntry{abs: abs, isDir: info.IsDir(), name: info.Name()})
		}

		// Tentukan nama file zip
		zipName := "download"
		if len(entries) == 1 {
			zipName = entries[0].name
		}
		safeZipName := SanitizeFilename(zipName)
		if safeZipName == "" {
			safeZipName = "download"
		}

		// Encode nama ZIP dengan RFC 5987 agar nama non-ASCII (Unicode) tampil benar
		// di semua browser. Kirim keduanya: filename= (ASCII fallback) dan filename*= (UTF-8).
		asciiName := safeZipName + ".zip"
		encodedName := url.PathEscape(safeZipName + ".zip")
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition",
			fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, asciiName, encodedName))
		w.Header().Set("Cache-Control", "no-store")

		// #6: HEAD request hanya butuh header — tidak perlu stream ZIP.
		if r.Method == http.MethodHead {
			return
		}

		zw := zip.NewWriter(w)
		// #2: tangkap error Close() agar truncated ZIP bisa dideteksi di log.
		defer func() {
			if err := zw.Close(); err != nil {
				log.Printf("download-zip: zw.Close gagal (zip mungkin tidak lengkap): %v", err)
			}
		}()

		// alreadyCompressedExt adalah ekstensi yang sudah terkompresi — pakai Store
		// agar tidak buang CPU untuk kompresi ulang yang hasilnya ~0%.
		alreadyCompressedExt := map[string]bool{
			".mp4": true, ".mkv": true, ".avi": true, ".mov": true, ".webm": true,
			".wmv": true, ".flv": true, ".ts": true,
			".mp3": true, ".flac": true, ".aac": true, ".ogg": true, ".m4a": true,
			".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
			".zip": true, ".gz": true, ".7z": true, ".rar": true, ".bz2": true,
		}

		addFileToZip := func(absPath, relInZip string) {
			f, err := os.Open(absPath)
			if err != nil {
				return
			}
			defer f.Close()
			fi, err := f.Stat()
			if err != nil {
				return
			}
			hdr, err := zip.FileInfoHeader(fi)
			if err != nil {
				return
			}
			hdr.Name = filepath.ToSlash(relInZip)
			// #4: gunakan Store untuk format yang sudah terkompresi
			ext := strings.ToLower(filepath.Ext(fi.Name()))
			if alreadyCompressedExt[ext] {
				hdr.Method = zip.Store
			} else {
				hdr.Method = zip.Deflate
			}
			wr, err := zw.CreateHeader(hdr)
			if err != nil {
				return
			}
			_, _ = io.Copy(wr, f)
		}

		for _, entry := range entries {
			if !entry.isDir {
				addFileToZip(entry.abs, entry.name)
				continue
			}
			// Folder: walk rekursif
			_ = filepath.Walk(entry.abs, func(path string, fi os.FileInfo, walkErr error) error {
				if walkErr != nil {
					return nil
				}
				// #1: skip folder .cache (berisi subtitle cache & history internal)
				if fi.IsDir() && fi.Name() == ".cache" {
					return filepath.SkipDir
				}
				if fi.IsDir() {
					return nil
				}
				// #3: skip symlink — filepath.Walk pakai Lstat, jadi symlink terdeteksi
				// lewat mode bit. Ikut symlink bisa bocorkan file di luar shared folder.
				if fi.Mode()&os.ModeSymlink != 0 {
					return nil
				}
				rel, err := filepath.Rel(entry.abs, path)
				if err != nil {
					return nil
				}
				// Prefix dengan nama folder agar struktur terjaga
				relInZip := filepath.Join(entry.name, rel)
				addFileToZip(path, relInZip)
				return nil
			})
		}
	}
}

// TODO: multi-path ZIP (?path=a&path=b) sudah didukung backend di atas,
// tapi belum ada UI multi-select di frontend. Akan diimplementasikan di Fase 4.

// HandleMkdir menangani POST /api/mkdir?path=<parent>&name=<nama_folder>
// Membuat subfolder baru di dalam shared folder.
func HandleMkdir(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		// #12: resolve parent sekali, pakai hasilnya langsung untuk bangun newPath.
		parent, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}
		name := SanitizeFilename(r.URL.Query().Get("name"))
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nama folder tidak valid"})
			return
		}
		// SanitizeFilename sudah menghapus semua separator path (/ dan \),
		// jadi filepath.Join(parent, name) tidak bisa keluar dari parent.
		// Verifikasi defensif: pastikan tidak ada separator yang tersisa.
		if strings.ContainsAny(name, `/\`) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "nama folder tidak valid"})
			return
		}
		newPath := filepath.Join(parent, name)
		// #8: pakai os.Mkdir (bukan MkdirAll) agar bisa bedakan "sudah ada" vs error lain.
		if err := os.Mkdir(newPath, 0o755); err != nil {
			if os.IsExist(err) {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "folder sudah ada"})
			} else {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membuat folder"})
			}
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleUpload menangani POST /api/upload?path=<relative_folder>
//
// Body: multipart/form-data dengan satu atau banyak field bernama "file".
// Setiap file di-stream langsung ke disk (tidak di-buffer ke memori).
// Penulisan atomic via .uploading.tmp + rename agar file half-written tidak tertinggal.
//
// Response:
//
//	200 OK — selalu, dengan body:
//	  { "results": [ { "name": "...", "size": 123, "ok": true }, ... ] }
//	Item gagal dilaporkan per file lewat field "error", request keseluruhan
//	tetap 200 supaya client bisa parse hasil partial.
//
// Limit ukuran per file dibaca dari cfg.UploadMaxBytes.
func HandleUpload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		targetDir, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}

		// Pastikan target adalah direktori yang valid.
		if info, err := os.Stat(targetDir); err != nil || !info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "folder tujuan tidak valid"})
			return
		}

		reader, err := r.MultipartReader()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "request bukan multipart/form-data"})
			return
		}

		results := make([]uploadResult, 0, 4)
		maxSize := cfg.UploadMaxBytes

		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				results = append(results, uploadResult{OK: false, Error: "gagal membaca part: " + err.Error()})
				break
			}

			// Hanya proses field "file"; abaikan field lain.
			if part.FormName() != "file" {
				_, _ = io.Copy(io.Discard, part)
				part.Close()
				continue
			}

			res := saveOnePart(part, targetDir, maxSize)
			part.Close()
			results = append(results, res)
		}

		writeJSON(w, http.StatusOK, map[string]any{"results": results})
	}
}

// uploadResult adalah satu item hasil upload.
type uploadResult struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// saveOnePart menyimpan satu part multipart ke targetDir secara streaming + atomic.
// Mengembalikan uploadResult dengan OK=false dan Error kalau ada masalah.
func saveOnePart(part *multipart.Part, targetDir string, maxSize int64) uploadResult {
	rawName := part.FileName()
	safeName := SanitizeFilename(rawName)
	if safeName == "" {
		return uploadResult{Name: rawName, OK: false, Error: "nama file tidak valid"}
	}

	destPath := uniqueDestPath(targetDir, safeName)
	finalName := filepath.Base(destPath)
	tmpPath := destPath + ".uploading.tmp"

	dst, err := os.Create(tmpPath)
	if err != nil {
		return uploadResult{Name: finalName, OK: false, Error: "gagal membuat file sementara"}
	}

	// Limit reader supaya tidak boleh > maxSize.
	limited := &io.LimitedReader{R: part, N: maxSize + 1}
	written, copyErr := io.Copy(dst, limited)
	closeErr := dst.Close()

	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmpPath)
		return uploadResult{Name: finalName, OK: false, Error: "gagal menulis file"}
	}
	if written > maxSize {
		_ = os.Remove(tmpPath)
		return uploadResult{Name: finalName, OK: false, Error: fmt.Sprintf("ukuran melebihi batas %d bytes", maxSize)}
	}

	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(tmpPath)
		return uploadResult{Name: finalName, OK: false, Error: "gagal finalisasi file"}
	}

	return uploadResult{Name: finalName, Size: written, OK: true}
}

// HandleLogin menangani POST /api/login (PIN auth)
func HandleLogin(pinEnabled bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !pinEnabled {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
		var body struct {
			PIN string `json:"pin"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body tidak valid"})
			return
		}

		valid, locked, retryAfter := ValidatePIN(body.PIN)
		if locked {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":       "Terlalu banyak percobaan. Coba lagi dalam beberapa menit.",
				"retry_after": int(retryAfter.Seconds()),
			})
			return
		}
		if !valid {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "PIN salah"})
			return
		}

		token, err := CreateToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membuat sesi"})
			return
		}
		http.SetCookie(w, &http.Cookie{
			Name:     "auth",
			Value:    token,
			Path:     "/",
			MaxAge:   int(tokenTTL.Seconds()),
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleTranscodeStatus menangani GET /api/transcode/status
// Mengembalikan jumlah transcode aktif dan apakah slot tersedia.
func HandleTranscodeStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		active := transcode.ActiveTranscodes()
		max := transcode.MaxTranscodes()
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, http.StatusOK, map[string]any{
			"active":    active,
			"max":       max,
			"available": active < max,
		})
	}
}

// HandleHistoryList menangani GET /api/history
func HandleHistoryList(store *history.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, http.StatusOK, store.List())
	}
}

// HandleHistoryUpdate menangani POST /api/history/update
// Body: { path, position_sec, duration_sec }
func HandleHistoryUpdate(cfg *Config, store *history.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var body struct {
			Path        string  `json:"path"`
			PositionSec float64 `json:"position_sec"`
			DurationSec float64 `json:"duration_sec"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body invalid"})
			return
		}
		if body.Path == "" || body.PositionSec < 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path & position_sec wajib"})
			return
		}
		// Validasi path harus di dalam shared_folder
		if _, err := files.ResolveSafe(cfg.SharedFolder, body.Path); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak valid"})
			return
		}
		name := filepath.Base(body.Path)
		if err := store.Set(body.Path, name, body.PositionSec, body.DurationSec); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleHistoryDelete menangani DELETE /api/history/delete?path=<rel>
func HandleHistoryDelete(store *history.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		path := r.URL.Query().Get("path")
		if path == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path wajib"})
			return
		}
		if err := store.Delete(path); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleHistoryClear menangani POST /api/history/clear
func HandleHistoryClear(store *history.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if err := store.Clear(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// isSafariOrIOS mengembalikan true kalau User-Agent berasal dari Safari atau
// iOS device. Browser ini TIDAK support MKV native, harus selalu lewat transcode.
//
// Catatan: semua browser di iOS (Chrome iOS, Firefox iOS, dll) menggunakan
// WebKit engine yang sama dengan Safari, sehingga semuanya tidak support MKV.
func isSafariOrIOS(userAgent string) bool {
	ua := strings.ToLower(userAgent)
	// iOS device (iPhone, iPad, iPod) — semua browser di iOS pakai WebKit
	if strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") || strings.Contains(ua, "ipod") {
		return true
	}
	// Safari desktop (tapi bukan Chrome/Edge yang juga punya "safari" di UA string)
	if strings.Contains(ua, "safari") &&
		!strings.Contains(ua, "chrome") &&
		!strings.Contains(ua, "chromium") &&
		!strings.Contains(ua, "edg/") {
		return true
	}
	return false
}
