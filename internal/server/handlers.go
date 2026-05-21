package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"lan-server/internal/files"
	"lan-server/internal/live"
	"lan-server/internal/media"
	"lan-server/internal/subtitle"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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
// http.ServeFile otomatis handle Range request untuk seek.
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
		http.ServeFile(w, r, target)
	}
}

// HandleSubtitle menangani GET /api/subtitle?path=<video-path>&lang=<id|en|...>
func HandleSubtitle(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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

		dir := filepath.Dir(target)
		base := strings.TrimSuffix(info.Name(), filepath.Ext(info.Name()))

		type subCandidate struct {
			path  string
			isSRT bool
		}
		var candidates []subCandidate

		if lang != "" {
			candidates = append(candidates,
				subCandidate{filepath.Join(dir, base+"."+lang+".vtt"), false},
				subCandidate{filepath.Join(dir, base+"."+lang+".srt"), true},
			)
		}
		candidates = append(candidates,
			subCandidate{filepath.Join(dir, base+".vtt"), false},
			subCandidate{filepath.Join(dir, base+".srt"), true},
		)

		for _, c := range candidates {
			if _, err := os.Stat(c.path); err != nil {
				continue
			}
			data, err := os.ReadFile(c.path)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membaca subtitle"})
				return
			}

			w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Access-Control-Allow-Origin", "*")

			if c.isSRT {
				w.Write([]byte(subtitle.SRTToVTT(string(data))))
			} else {
				w.Write(data)
			}
			return
		}

		writeJSON(w, http.StatusNotFound, map[string]string{"error": "subtitle tidak ditemukan"})
	}
}

// HandleSubtitles menangani GET /api/subtitles?path=<video-path>
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
			Lang  string `json:"lang"`
			Label string `json:"label"`
		}
		results := []subInfo{}

		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			n := e.Name()
			ext := strings.ToLower(filepath.Ext(n))
			if ext != ".srt" && ext != ".vtt" {
				continue
			}
			stem := strings.TrimSuffix(n, ext)
			if stem == baseName {
				results = append(results, subInfo{Lang: "", Label: "Default"})
				continue
			}
			if strings.HasPrefix(stem, baseName+".") {
				code := strings.TrimPrefix(stem, baseName+".")
				results = append(results, subInfo{
					Lang:  code,
					Label: langLabel(code),
				})
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

		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
		http.ServeFile(w, r, target)
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

// HandleUpload menangani POST /api/upload?path=<relative_folder>
func HandleUpload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 200<<20)

		targetDir, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}

		if err := r.ParseMultipartForm(200 << 20); err != nil {
			if strings.Contains(err.Error(), "too large") {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{
					"error": "Ukuran file melebihi batas 200 MB",
				})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "gagal memproses form upload"})
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "field 'file' tidak ditemukan"})
			return
		}
		defer file.Close()

		safeName := filepath.Base(header.Filename)
		destPath := uniqueDestPath(targetDir, safeName)
		finalName := filepath.Base(destPath)

		dst, err := os.Create(destPath)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal menyimpan file"})
			return
		}
		defer dst.Close()

		if _, err := io.Copy(dst, file); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal menulis file"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": finalName})
	}
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

// ===== Live Stream Handlers =====

// HandleLiveStatus menangani GET /api/live/status
func HandleLiveStatus(hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		active := hub.IsActive()
		resp := map[string]any{
			"active":  active,
			"viewers": hub.ViewerCount(),
		}
		if active {
			resp["started_at"] = hub.StartedAt().Format("2006-01-02T15:04:05Z07:00")
		}
		w.Header().Set("Cache-Control", "no-cache")
		writeJSON(w, http.StatusOK, resp)
	}
}

// HandleLiveSignal menangani POST /api/live/signal
func HandleLiveSignal(hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var sig live.Signal
		if err := json.NewDecoder(r.Body).Decode(&sig); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body tidak valid"})
			return
		}
		if sig.From == "" || sig.To == "" || sig.Type == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "from, to, dan type wajib diisi"})
			return
		}
		hub.Forward(sig)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleLiveEvents menangani GET /api/live/events?peer_id=<id>&role=<broadcaster|viewer>
func HandleLiveEvents(hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		id := r.URL.Query().Get("peer_id")
		roleStr := r.URL.Query().Get("role")
		if id == "" || (roleStr != "broadcaster" && roleStr != "viewer") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "peer_id dan role (broadcaster|viewer) wajib diisi"})
			return
		}

		role := live.Role(roleStr)
		ch, err := hub.Join(role, id)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}
		defer hub.Leave(id)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming tidak didukung"})
			return
		}

		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()

		// Heartbeat setiap 20 detik agar proxy/firewall tidak drop koneksi idle.
		heartbeat := time.NewTicker(20 * time.Second)
		defer heartbeat.Stop()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			case <-heartbeat.C:
				fmt.Fprintf(w, ":ka\n\n")
				flusher.Flush()
			case sig, open := <-ch:
				if !open {
					fmt.Fprintf(w, "event: signal\ndata: {\"type\":\"bye\",\"from\":\"server\"}\n\n")
					flusher.Flush()
					return
				}
				data, err := json.Marshal(sig)
				if err != nil {
					continue
				}
				fmt.Fprintf(w, "event: signal\ndata: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

// HandleLiveStop menangani POST /api/live/stop
func HandleLiveStop(hub *live.Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var body struct {
			PeerID string `json:"peer_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PeerID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "peer_id wajib diisi"})
			return
		}
		hub.Leave(body.PeerID)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
