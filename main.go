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

// cleanSubtitleCache menghapus file cache subtitle yang lebih lama dari 7 hari.
func cleanSubtitleCache(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			path := filepath.Join(dir, e.Name())
			if err := os.Remove(path); err == nil {
				log.Printf("cache: hapus subtitle lama: %s", e.Name())
			}
		}
	}
}

func main() {
	// Baca dan validasi config.json
	cfg, err := server.LoadConfig("config.json")
	if err != nil {
		log.Fatalf("ERROR: %v\nPastikan config.json ada di folder yang sama dengan main.go\n", err)
	}

	// Pastikan shared_folder ada
	if _, err := os.Stat(cfg.SharedFolder); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(cfg.SharedFolder, 0755); mkErr != nil {
			log.Fatalf("ERROR: shared_folder '%s' tidak ada dan gagal dibuat: %v\n", cfg.SharedFolder, mkErr)
		}
		fmt.Printf("INFO: Folder '%s' dibuat otomatis.\n", cfg.SharedFolder)
	}

	// Cek ketersediaan ffmpeg untuk fitur embedded subtitle
	if cfg.FFmpegBinary() == "" {
		log.Println("WARNING: ffmpeg tidak ditemukan. Embedded subtitle dari MKV/MP4 tidak akan tersedia.")
		log.Println("         Install ffmpeg: winget install --id=Gyan.FFmpeg -e")
		log.Println("         Atau set 'ffmpeg_path' di config.json ke path ffmpeg yang sudah diinstall.")
	} else {
		log.Printf("INFO: ffmpeg ditemukan di: %s", cfg.FFmpegBinary())
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
		fmt.Printf("│  Transcode: ENABLED  (ffmpeg %s)\n", transcode.Version())
	} else {
		fmt.Println("│  Transcode: DISABLED (ffmpeg tidak ditemukan di PATH)")
		fmt.Println("│             Install ffmpeg untuk memutar MKV/AVI/WMV/FLV")
	}
	fmt.Println("└─────────────────────────────────────────┘")
	fmt.Println()
	fmt.Println("Tekan Ctrl+C untuk menghentikan server.")
	fmt.Println()

	// Buat folder cache untuk subtitle embedded
	cacheDir := filepath.Join("cache", "embedded_subtitle")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		log.Printf("WARN: gagal membuat folder cache subtitle: %v", err)
	}

	// Jalankan janitor cache subtitle: hapus file > 7 hari
	go func() {
		cleanSubtitleCache(cacheDir)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanSubtitleCache(cacheDir)
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
