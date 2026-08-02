package main

import (
	"context"
	"fmt"
	"lan-server/internal/netinfo"
	"lan-server/internal/server"
	"lan-server/internal/transcode"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

// cleanSubtitleCache menghapus file cache subtitle yang lebih lama dari maxAge.
// Scan rekursif karena embed.WriteCache menyimpan di struktur nested:
// <cacheRoot>/subtitles/<key>/<streamIndex>.vtt
func cleanSubtitleCache(cacheRoot string, maxAge time.Duration) {
	cutoff := time.Now().Add(-maxAge)
	_ = filepath.WalkDir(cacheRoot, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().Before(cutoff) {
			if removeErr := os.Remove(path); removeErr == nil {
				log.Printf("cache: hapus subtitle lama: %s", filepath.Base(path))
			}
		}
		return nil
	})
}

func main() {
	// Baca dan validasi config.json
	cfg, err := server.LoadConfig("config.json")
	if err != nil {
		log.Fatalf("ERROR: %v\nPastikan config.json ada di folder yang sama dengan main.go\n", err)
	}
	cfg.ConfigureMedia()

	// Pastikan shared_folder ada
	if _, err := os.Stat(cfg.SharedFolder); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(cfg.SharedFolder, 0755); mkErr != nil {
			log.Fatalf("ERROR: shared_folder '%s' tidak ada dan gagal dibuat: %v\n", cfg.SharedFolder, mkErr)
		}
		fmt.Printf("INFO: Folder '%s' dibuat otomatis.\n", cfg.SharedFolder)
	}

	// Cek ketersediaan ffmpeg — satu log saja, pakai transcode package sebagai sumber kebenaran.
	// Tidak perlu log terpisah dari cfg.FFmpegBinary() karena transcode.Available() sudah
	// ditampilkan di banner startup di bawah.
	if !transcode.Available() && cfg.FFmpegPath == "" {
		log.Println("WARNING: ffmpeg tidak ditemukan. Format MKV/AVI/WMV/FLV tidak bisa diputar.")
		log.Println("         Install: winget install --id=Gyan.FFmpeg -e")
		log.Println("         Atau set 'ffmpeg_path' di config.json.")
	}

	// Setup PIN jika diaktifkan
	if cfg.PINEnabled {
		pin := server.InitPIN()
		fmt.Println("╔══════════════════════════════════╗")
		fmt.Printf("║  PIN Akses: %s                  ║\n", pin)
		fmt.Println("╚══════════════════════════════════╝")
		// Jalankan janitor untuk bersihkan token expired secara berkala
		server.StartTokenJanitor()
	}

	// Deteksi IP LAN
	lanIP, err := netinfo.GetLANIP()
	if err != nil {
		lanIP = "tidak terdeteksi"
	}

	port := cfg.Port
	fmt.Println()
	fmt.Println("┌─────────────────────────────────────────┐")
	fmt.Println("│           LAN Hub Server                │")
	fmt.Println("├─────────────────────────────────────────┤")
	fmt.Printf("│  Laptop  : http://localhost:%d          │\n", port)
	fmt.Printf("│  HP/Tablet: http://%s:%d     │\n", lanIP, port)
	fmt.Println("├─────────────────────────────────────────┤")
	fmt.Printf("│  Shared  : %s\n", cfg.SharedFolder)
	if transcode.Available() {
		hwInfo := ""
		if hw := transcode.HWAccel(); hw != "" {
			hwInfo = ", HW: " + hw
		}
		fmt.Printf("│  Transcode: ENABLED  (ffmpeg %s%s)\n", transcode.Version(), hwInfo)
	} else {
		fmt.Println("│  Transcode: DISABLED (ffmpeg tidak ditemukan di PATH)")
		fmt.Println("│             Install ffmpeg untuk memutar MKV/AVI/WMV/FLV")
	}
	fmt.Println("└─────────────────────────────────────────┘")
	fmt.Println()
	fmt.Println("Tekan Ctrl+C untuk menghentikan server.")
	fmt.Println()

	// Buat folder cache untuk subtitle embedded.
	// Path harus sama dengan yang dipakai embed.WriteCache: cfg.CacheDir()/subtitles/...
	cacheDir := cfg.CacheDir()
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		log.Printf("WARN: gagal membuat folder cache subtitle: %v", err)
	}

	// Jalankan janitor cache subtitle: hapus file > 7 hari, scan rekursif
	go func() {
		const maxAge = 7 * 24 * time.Hour
		cleanSubtitleCache(cacheDir, maxAge)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanSubtitleCache(cacheDir, maxAge)
		}
	}()

	// Buat server dengan timeout
	srv := server.NewServer(cfg)

	// Jalankan server di goroutine agar tidak block signal handler
	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Graceful shutdown: tunggu SIGINT atau SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		log.Fatalf("Server error: %v\n", err)
	case sig := <-quit:
		fmt.Printf("\nMenerima sinyal %s, menghentikan server...\n", sig)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown paksa: %v\n", err)
	} else {
		fmt.Println("Server berhenti dengan bersih.")
	}
}
