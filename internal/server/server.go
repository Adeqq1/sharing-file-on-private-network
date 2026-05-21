package server

import (
	"fmt"
	"log"
	"net/http"
	"time"
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
	mux.Handle("/", cacheStatic(staticFS))

	// Wrap: logger → auth middleware
	return requestLogger(AuthMiddleware(cfg.PINEnabled, mux))
}

// NewServer membuat *http.Server yang siap untuk graceful shutdown.
func NewServer(cfg *Config) *http.Server {
	return &http.Server{
		Addr:         Addr(cfg),
		Handler:      New(cfg),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
}

// Addr mengembalikan string alamat listen dari config.
func Addr(cfg *Config) string {
	return fmt.Sprintf(":%d", cfg.Port)
}

// cacheStatic menambahkan Cache-Control header pada response file statis.
func cacheStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		next.ServeHTTP(w, r)
	})
}

// requestLogger adalah middleware yang mencatat setiap request masuk.
func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lrw := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(lrw, r)
		log.Printf("%s %s %s %d %s",
			r.Method,
			r.URL.Path,
			r.RemoteAddr,
			lrw.status,
			time.Since(start).Round(time.Millisecond),
		)
	})
}

// loggingResponseWriter membungkus http.ResponseWriter untuk menangkap status code.
type loggingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	lrw.status = code
	lrw.ResponseWriter.WriteHeader(code)
}
