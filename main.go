package main

import (
	"fmt"
	"lan-server/internal/netinfo"
	"lan-server/internal/server"
	"log"
	"net/http"
	"os"
)

func main() {
	// Baca config.json
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
	}

	// Deteksi IP LAN
	lanIP, err := netinfo.GetLANIP()
	if err != nil {
		lanIP = "tidak terdeteksi"
	}

	addr := server.Addr(cfg)
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

	handler := server.New(cfg)
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server error: %v\n", err)
	}
}
