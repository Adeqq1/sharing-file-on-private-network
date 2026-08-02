package server

import (
	"encoding/json"
	"fmt"
	"lan-server/internal/transcode"
	"math"
	"os"
	"path/filepath"
)

// Config adalah struktur konfigurasi utama yang dibaca dari config.json.
type Config struct {
	SharedFolder   string `json:"shared_folder"`
	Port           int    `json:"port"`
	PINEnabled     bool   `json:"pin_enabled"`
	FFmpegPath     string `json:"ffmpeg_path"`      // path ke executable ffmpeg, kosong = auto-detect
	UploadMaxBytes int64  `json:"upload_max_bytes"` // batas ukuran per file upload (bytes), default 5 GB
	UploadMaxFiles int    `json:"upload_max_files"` // batas file per request, default 32
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
	if cfg.UploadMaxBytes <= 0 {
		cfg.UploadMaxBytes = 5 << 30 // 5 GB
	}
	if cfg.UploadMaxFiles <= 0 {
		cfg.UploadMaxFiles = 32
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
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("port harus antara 1 dan 65535")
	}
	if c.FFmpegPath != "" {
		info, err := os.Stat(c.FFmpegPath)
		if err != nil || info.IsDir() {
			return fmt.Errorf("ffmpeg_path tidak valid")
		}
		probe := filepath.Join(filepath.Dir(c.FFmpegPath), "ffprobe")
		if _, err := os.Stat(probe); err != nil {
			if _, exeErr := os.Stat(probe + ".exe"); exeErr != nil {
				return fmt.Errorf("ffprobe tidak ditemukan di folder ffmpeg_path")
			}
		}
	}
	if c.UploadMaxBytes > math.MaxInt64/int64(c.UploadMaxFiles) {
		return fmt.Errorf("upload_max_bytes terlalu besar")
	}
	if c.UploadMaxFiles < 1 {
		return fmt.Errorf("upload_max_files harus lebih dari 0")
	}
	return nil
}

// FFmpegBinary mengembalikan path ke executable ffmpeg yang aktif.
//
// Prioritas:
//  1. ffmpeg_path di config.json (eksplisit dari user)
//  2. transcode.FindFFmpeg() — single source of truth dengan fallback winget/choco/scoop
//
// Dengan ini, deteksi ffmpeg konsisten antara /api/transcode dan /api/subtitles.
func (c *Config) FFmpegBinary() string {
	if c.FFmpegPath != "" {
		return c.FFmpegPath
	}
	return transcode.FindFFmpeg()
}

// FFprobeBinary mengembalikan path ke executable ffprobe.
//
// Prioritas:
//  1. Folder yang sama dengan ffmpeg_path di config (kalau diset manual)
//  2. transcode.FindFFprobe() — single source of truth dengan fallback winget/choco/scoop
func (c *Config) FFprobeBinary() string {
	if c.FFmpegPath != "" {
		// Kalau user set ffmpeg_path manual, cari ffprobe di folder yang sama
		dir := filepath.Dir(c.FFmpegPath)
		for _, name := range []string{"ffprobe", "ffprobe.exe"} {
			candidate := filepath.Join(dir, name)
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	return transcode.FindFFprobe()
}

// ConfigureMedia makes the configured ffmpeg pair the process-wide media runtime.
func (c *Config) ConfigureMedia() {
	transcode.Configure(c.FFmpegBinary(), c.FFprobeBinary())
}

// CacheDir mengembalikan path direktori data aplikasi di luar shared folder.
func (c *Config) CacheDir() string {
	if dir, err := os.UserCacheDir(); err == nil {
		return filepath.Join(dir, "lan-hub")
	}
	// ponytail: fallback only for platforms without a user cache directory;
	// move it to an explicit app-data setting if those platforms need support.
	return filepath.Join(c.SharedFolder, ".cache")
}
