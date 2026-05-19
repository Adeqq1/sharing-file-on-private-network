package main

import (
	"context"
	"fmt"
	"lan-server/internal/netinfo"
	"lan-server/internal/server"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

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
	fmt.Println("└─────────────────────────────────────────┘")
	fmt.Println()
	fmt.Println("Tekan Ctrl+C untuk menghentikan server.")
	fmt.Println()

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
