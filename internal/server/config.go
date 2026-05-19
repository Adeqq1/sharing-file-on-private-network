package server

import (
	"encoding/json"
	"fmt"
	"lan-server/internal/apps"
	"os"
)

// Config adalah struktur konfigurasi utama yang dibaca dari config.json.
type Config struct {
	SharedFolder string        `json:"shared_folder"`
	Apps         []apps.AppDef `json:"apps"`
	Port         int           `json:"port"`
	PINEnabled   bool          `json:"pin_enabled"`
}

// LoadConfig membaca config.json dari path yang diberikan.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca config.json: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config.json tidak valid: %w", err)
	}
	if cfg.Port == 0 {
		cfg.Port = 8080
	}
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("config tidak valid: %w", err)
	}
	return &cfg, nil
}

// Validate memvalidasi isi Config dan mengembalikan error deskriptif jika ada masalah.
func (c *Config) Validate() error {
	// shared_folder wajib diisi
	if c.SharedFolder == "" {
		return fmt.Errorf("shared_folder tidak boleh kosong")
	}

	// Cek duplikat app ID
	seen := make(map[string]bool, len(c.Apps))
	for i, app := range c.Apps {
		if app.ID == "" {
			return fmt.Errorf("apps[%d]: id tidak boleh kosong", i)
		}
		if seen[app.ID] {
			return fmt.Errorf("apps[%d]: id '%s' duplikat", i, app.ID)
		}
		seen[app.ID] = true

		// Cek exec path ada (hanya jika diisi dan bukan perintah sistem)
		if app.Exec != "" && isAbsPath(app.Exec) {
			if _, err := os.Stat(app.Exec); os.IsNotExist(err) {
				// Warning saja, bukan fatal — user mungkin belum install app
				fmt.Printf("PERINGATAN: apps[%d] '%s': exec '%s' tidak ditemukan\n", i, app.ID, app.Exec)
			}
		}
	}
	return nil
}

// isAbsPath mengembalikan true jika path terlihat seperti path absolut Windows atau Unix.
func isAbsPath(p string) bool {
	if len(p) == 0 {
		return false
	}
	// Windows: C:\... atau \\server\...
	if len(p) >= 3 && p[1] == ':' {
		return true
	}
	// Unix: /usr/bin/...
	return p[0] == '/'
}
