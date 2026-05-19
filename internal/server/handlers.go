package server

import (
	"encoding/json"
	"fmt"
	"io"
	"lan-server/internal/apps"
	"lan-server/internal/files"
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
			if strings.Contains(err.Error(), "tidak diizinkan") {
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

		// Validasi path (cegah path traversal)
		absRoot, _ := filepath.Abs(cfg.SharedFolder)
		target := filepath.Join(absRoot, filepath.FromSlash(req.Path))
		target = filepath.Clean(target)
		if !strings.HasPrefix(target+string(filepath.Separator), absRoot+string(filepath.Separator)) {
			if target != absRoot {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak diizinkan"})
				return
			}
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

// HandleDownload menangani GET /api/download?path=<relative>
func HandleDownload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		relPath := r.URL.Query().Get("path")
		absRoot, _ := filepath.Abs(cfg.SharedFolder)
		target := filepath.Join(absRoot, filepath.FromSlash(relPath))
		target = filepath.Clean(target)

		if !strings.HasPrefix(target+string(filepath.Separator), absRoot+string(filepath.Separator)) {
			if target != absRoot {
				http.Error(w, "path tidak diizinkan", http.StatusBadRequest)
				return
			}
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

// HandleUpload menangani POST /api/upload?path=<relative_folder>
func HandleUpload(cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Batasi ukuran upload 200MB
		r.Body = http.MaxBytesReader(w, r.Body, 200<<20)

		relPath := r.URL.Query().Get("path")
		absRoot, _ := filepath.Abs(cfg.SharedFolder)
		targetDir := filepath.Join(absRoot, filepath.FromSlash(relPath))
		targetDir = filepath.Clean(targetDir)

		if !strings.HasPrefix(targetDir+string(filepath.Separator), absRoot+string(filepath.Separator)) {
			if targetDir != absRoot {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path tidak diizinkan"})
				return
			}
		}

		if err := r.ParseMultipartForm(200 << 20); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "gagal parse form: " + err.Error()})
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
		destPath := filepath.Join(targetDir, safeName)

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

		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": safeName})
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
		if !ValidatePIN(body.PIN) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "PIN salah"})
			return
		}
		token := CreateToken()
		http.SetCookie(w, &http.Cookie{
			Name:     "auth",
			Value:    token,
			Path:     "/",
			MaxAge:   86400, // 24 jam
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
