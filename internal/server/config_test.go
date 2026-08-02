package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfigDefaultsPort(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"shared_folder":"/shared"}`), 0600); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want 8080", cfg.Port)
	}
}

func TestConfigCacheDir(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	cfg := Config{SharedFolder: filepath.Join("shared", "files")}
	if got, want := cfg.CacheDir(), filepath.Join(os.Getenv("XDG_CACHE_HOME"), "lan-hub"); got != want {
		t.Errorf("CacheDir() = %q, want %q", got, want)
	}
}
