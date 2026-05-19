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
	return &cfg, nil
}
