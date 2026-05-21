package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"lan-server/internal/apps"
	"lan-server/internal/files"
	"lan-server/internal/media"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

// HandleApps menangani GET /api/apps?ext=<extension>
func HandleApps(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ext := r.URL.Query().Get("ext")
		list := apps.List(ext, cfg.Apps)
		// Kirim hanya id dan name ke client (jangan bocorkan exec path)
		type safeApp struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		safe := make([]safeApp, len(list))
		for i, a := range list {
			safe[i] = safeApp{ID: a.ID, Name: a.Name}
		}
		writeJSON(w, http.StatusOK, safe)
	}
}

// openRequest adalah body dari POST /api/open
type openRequest struct {
	AppID string `json:"app_id"`
	Path  string `json:"path"`
}

// HandleOpen menangani POST /api/open
func HandleOpen(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req openRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body tidak valid"})
			return
		}

		// Validasi path (DRY via resolveSafeOrRespond — termasuk symlink check)
		target, ok := resolveSafeOrRespond(w, cfg.SharedFolder, req.Path)
		if !ok {
			return
		}

		// Verifikasi file ada dan bukan folder (#2)
		info, err := os.Stat(target)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file tidak ditemukan"})
			return
		}
		if info.IsDir() {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tidak bisa membuka folder dengan Open With"})
			return
		}

		// Cari app berdasarkan app_id (exec HANYA dari config, tidak dari client)
		var found *apps.AppDef
		for i := range cfg.Apps {
			if cfg.Apps[i].ID == req.AppID {
				found = &cfg.Apps[i]
				break
			}
		}
		if found == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "app_id tidak ditemukan"})
			return
		}

		// Eksekusi aplikasi
		var cmd *exec.Cmd
		if found.Exec == "" {
			// Default Windows: buka dengan aplikasi default
			cmd = exec.Command("cmd", "/C", "start", "", target)
		} else {
			cmd = exec.Command(found.Exec, target)
		}

		if err := cmd.Start(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": fmt.Sprintf("gagal membuka aplikasi: %s", err.Error()),
			})
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// HandleStream menangani GET /api/stream?path=<relative>
// Berbeda dengan HandleDownload: TIDAK set Content-Disposition attachment,
// sehingga browser bisa memutar file langsung (bukan mendownload).
// http.ServeFile otomatis handle Range request (Accept-Ranges: bytes) untuk seek.
func HandleStream(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Support GET dan HEAD (HEAD dipakai browser untuk cek metadata sebelum play)
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
			http.Error(w, "file tidak ditemukan", http.StatusNotFound)
			return
		}
		if info.IsDir() {
			http.Error(w, "tidak bisa stream folder", http.StatusBadRequest)
			return
		}

		// Set Content-Type eksplisit berdasarkan ekstensi.
		// Tanpa ini, beberapa browser mobile tidak mau play (terutama audio).
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(info.Name()), "."))
		if mime := media.MIMEOf(ext); mime != "" {
			w.Header().Set("Content-Type", mime)
		}

		// http.ServeFile otomatis:
		// - Set Accept-Ranges: bytes
		// - Handle Range request → HTTP 206 Partial Content
		// - Set Content-Length
		// - Handle If-Modified-Since / ETag caching
		http.ServeFile(w, r, target)
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

		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, info.Name()))
		http.ServeFile(w, r, target)
	}
}

// uniqueDestPath mengembalikan path tujuan yang tidak bentrok dengan file existing.
// Jika "file.txt" sudah ada, coba "file (1).txt", "file (2).txt", dst.
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
	// Fallback: pakai nama asli (akan overwrite)
	return dest
}

// HandleUpload menangani POST /api/upload?path=<relative_folder>
func HandleUpload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Batasi ukuran upload 200MB (#14: tangkap error 413 dengan pesan ramah)
		r.Body = http.MaxBytesReader(w, r.Body, 200<<20)

		targetDir, ok := resolveSafeOrRespond(w, cfg.SharedFolder, r.URL.Query().Get("path"))
		if !ok {
			return
		}

		if err := r.ParseMultipartForm(200 << 20); err != nil {
			// Deteksi request body too large → pesan ramah
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

		// Sanitasi nama file: hanya ambil base name
		safeName := filepath.Base(header.Filename)

		// Hindari overwrite file existing (#3): cari nama unik
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
