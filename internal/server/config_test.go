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
	firstCfg := Config{SharedFolder: filepath.Join("shared", "first")}
	secondCfg := Config{SharedFolder: filepath.Join("shared", "second")}
	first := firstCfg.CacheDir()
	second := secondCfg.CacheDir()
	if first == second {
		t.Errorf("CacheDir() must namespace different shares: %q", first)
	}
	if filepath.Dir(first) != filepath.Join(os.Getenv("XDG_CACHE_HOME"), "lan-hub") {
		t.Errorf("CacheDir() = %q outside lan-hub cache", first)
	}
}
