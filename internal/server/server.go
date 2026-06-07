package server

import (
	"fmt"
	"lan-server/internal/history"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

// init mendaftarkan MIME type secara eksplisit agar tidak bergantung pada
// registry OS (Windows kadang tidak punya entry untuk .js / .css).
func init() {
	mime.AddExtensionType(".js", "application/javascript; charset=utf-8")
	mime.AddExtensionType(".mjs", "application/javascript; charset=utf-8")
	mime.AddExtensionType(".css", "text/css; charset=utf-8")
	mime.AddExtensionType(".html", "text/html; charset=utf-8")
	mime.AddExtensionType(".svg", "image/svg+xml")
	mime.AddExtensionType(".json", "application/json; charset=utf-8")
	mime.AddExtensionType(".vtt", "text/vtt; charset=utf-8")
	mime.AddExtensionType(".mkv", "video/x-matroska")
	mime.AddExtensionType(".avi", "video/x-msvideo")
	mime.AddExtensionType(".wmv", "video/x-ms-wmv")
	mime.AddExtensionType(".flv", "video/x-flv")
	mime.AddExtensionType(".ts", "video/mp2t")
}

// New membuat http.Handler dengan semua route terdaftar.
func New(cfg *Config) http.Handler {
	mux := http.NewServeMux()

	// History store — load dari disk, fallback ke store kosong kalau gagal
	historyStore, err := history.Open(cfg.CacheDir(), cfg.MaxHistory)
	if err != nil {
		log.Printf("WARN: gagal load history store: %v — mulai dengan store kosong", err)
		historyStore, _ = history.Open(cfg.CacheDir(), cfg.MaxHistory)
	}

	// API routes
	mux.HandleFunc("/api/files", HandleFiles(cfg))
	mux.HandleFunc("/api/download", HandleDownload(cfg))
	mux.HandleFunc("/api/download-zip", HandleDownloadZip(cfg))
	mux.HandleFunc("/api/mkdir", HandleMkdir(cfg))
	mux.HandleFunc("/api/stream", HandleStream(cfg))
	mux.HandleFunc("/api/transcode", HandleTranscode(cfg))
	mux.HandleFunc("/api/transcode/status", HandleTranscodeStatus())
	mux.HandleFunc("/api/probe", HandleProbe(cfg))
	mux.HandleFunc("/api/subtitle", HandleSubtitle(cfg))
	mux.HandleFunc("/api/subtitles", HandleSubtitles(cfg))
	mux.HandleFunc("/api/upload", HandleUpload(cfg))
	mux.HandleFunc("/api/login", HandleLogin(cfg.PINEnabled))

	// History routes
	mux.HandleFunc("/api/history", HandleHistoryList(historyStore))
	mux.HandleFunc("/api/history/update", HandleHistoryUpdate(cfg, historyStore))
	mux.HandleFunc("/api/history/delete", HandleHistoryDelete(historyStore))
	mux.HandleFunc("/api/history/clear", HandleHistoryClear(historyStore))

	// Static files (web/)
	staticFS := http.FileServer(http.Dir("web"))
	mux.Handle("/", cacheStatic(staticFS))

	// Wrap: logger → auth middleware
	return requestLogger(AuthMiddleware(cfg.PINEnabled, mux))
}

// NewServer membuat *http.Server yang siap untuk graceful shutdown.
func NewServer(cfg *Config) *http.Server {
	return &http.Server{
		Addr:              Addr(cfg),
		Handler:           New(cfg),
		ReadHeaderTimeout: 30 * time.Second,
		ReadTimeout:       0, // 0 = jangan putus upload file besar yang valid di tengah jalan
		WriteTimeout:      0, // 0 = no timeout — diperlukan untuk streaming file besar
		IdleTimeout:       120 * time.Second,
	}
}

// Addr mengembalikan string alamat listen dari config.
func Addr(cfg *Config) string {
	return fmt.Sprintf(":%d", cfg.Port)
}

// cacheStatic menambahkan Cache-Control header pada response file statis.
// HTML, JS, dan CSS pakai no-cache + must-revalidate agar setiap deploy fix
// baru langsung diambil browser tanpa hard-refresh manual di tiap device
// (terutama HP). Asset lain (gambar, font, dll) boleh di-cache 1 jam.
func cacheStatic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ext := strings.ToLower(filepath.Ext(r.URL.Path))
		if r.URL.Path == "/" || r.URL.Path == "/index.html" ||
			ext == ".html" || ext == ".js" || ext == ".css" {
			// no-cache: browser wajib revalidasi ke server sebelum pakai cache.
			// must-revalidate: tidak boleh pakai stale copy saat offline.
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
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
