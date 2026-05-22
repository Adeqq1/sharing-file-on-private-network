package server

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// Config adalah struktur konfigurasi utama yang dibaca dari config.json.
type Config struct {
	SharedFolder string `json:"shared_folder"`
	Port         int    `json:"port"`
	PINEnabled   bool   `json:"pin_enabled"`
	FFmpegPath   string `json:"ffmpeg_path"` // path ke executable ffmpeg, kosong = auto-detect dari PATH
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
	if c.SharedFolder == "" {
		return fmt.Errorf("shared_folder tidak boleh kosong")
	}
	return nil
}

// FFmpegBinary mengembalikan path ke executable ffmpeg yang aktif.
// Kalau FFmpegPath di config kosong, cari di PATH sistem.
// Mengembalikan "" kalau tidak ditemukan.
func (c *Config) FFmpegBinary() string {
	if c.FFmpegPath != "" {
		return c.FFmpegPath
	}
	p, err := exec.LookPath("ffmpeg")
	if err != nil {
		return ""
	}
	return p
}

// FFprobeBinary mengembalikan path ke executable ffprobe.
// Dicari di folder yang sama dengan ffmpeg dulu, lalu fallback ke PATH.
// Mengembalikan "" kalau tidak ditemukan.
func (c *Config) FFprobeBinary() string {
	ffmpeg := c.FFmpegBinary()
	if ffmpeg != "" {
		// ffprobe biasanya satu folder dengan ffmpeg
		dir := filepath.Dir(ffmpeg)
		for _, name := range []string{"ffprobe", "ffprobe.exe"} {
			candidate := filepath.Join(dir, name)
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	// Fallback: cari di PATH
	p, err := exec.LookPath("ffprobe")
	if err != nil {
		return ""
	}
	return p
}

// CacheDir mengembalikan path direktori cache untuk embedded subtitle.
// Cache disimpan di dalam shared_folder agar tidak menulis ke folder OS lain.
func (c *Config) CacheDir() string {
	return filepath.Join(c.SharedFolder, ".cache")
}
