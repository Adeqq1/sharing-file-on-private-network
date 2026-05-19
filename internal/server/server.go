package server

import (
	"fmt"
	"net/http"
)

// New membuat http.Handler dengan semua route terdaftar.
func New(cfg *Config) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/files", HandleFiles(cfg))
	mux.HandleFunc("/api/apps", HandleApps(cfg))
	mux.HandleFunc("/api/open", HandleOpen(cfg))
	mux.HandleFunc("/api/download", HandleDownload(cfg))
	mux.HandleFunc("/api/upload", HandleUpload(cfg))
	mux.HandleFunc("/api/login", HandleLogin(cfg.PINEnabled))

	// Static files (web/)
	staticFS := http.FileServer(http.Dir("web"))
	// Tambahkan Cache-Control header untuk aset statis
	mux.Handle("/", cacheStatic(staticFS))

	// Wrap semua dengan auth middleware
	return AuthMiddleware(cfg.PINEnabled, mux)
}

// cacheStatic menambahkan Cache-Control header pada response file statis.
func cacheStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Jangan cache index.html agar perubahan langsung terlihat
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		next.ServeHTTP(w, r)
	})
}

// Addr mengembalikan string alamat listen dari config.
func Addr(cfg *Config) string {
	return fmt.Sprintf(":%d", cfg.Port)
}
