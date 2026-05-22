package embed

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// ===== Unit test: IsTextBased =====

func TestIsTextBased(t *testing.T) {
	cases := []struct {
		codec string
		want  bool
	}{
		// Text-based — harus true
		{"subrip", true},
		{"ass", true},
		{"ssa", true},
		{"mov_text", true},
		{"webvtt", true},
		{"text", true},
		// Case-insensitive
		{"SUBRIP", true},
		{"ASS", true},
		// Image-based — harus false
		{"hdmv_pgs_subtitle", false},
		{"dvd_subtitle", false},
		{"vobsub", false},
		// Tidak dikenal
		{"", false},
		{"unknown", false},
		{"h264", false},
	}
	for _, c := range cases {
		got := Track{Codec: c.codec}.IsTextBased()
		if got != c.want {
			t.Errorf("Track{Codec:%q}.IsTextBased() = %v, want %v", c.codec, got, c.want)
		}
	}
}

// ===== Unit test: Cache =====

func TestCacheKey_DifferentFiles(t *testing.T) {
	// Buat dua file temp dengan konten berbeda
	f1, _ := os.CreateTemp("", "embed-test-*.mkv")
	f1.WriteString("content1")
	f1.Close()
	defer os.Remove(f1.Name())

	f2, _ := os.CreateTemp("", "embed-test-*.mkv")
	f2.WriteString("content2")
	f2.Close()
	defer os.Remove(f2.Name())

	k1, err1 := CacheKey(f1.Name())
	k2, err2 := CacheKey(f2.Name())

	if err1 != nil || err2 != nil {
		t.Fatalf("CacheKey error: %v, %v", err1, err2)
	}
	if k1 == k2 {
		t.Error("file berbeda harus punya cache key berbeda")
	}
}

func TestCacheKey_NonExistentFile(t *testing.T) {
	_, err := CacheKey("/path/yang/tidak/ada.mkv")
	if err == nil {
		t.Error("CacheKey harus return error untuk file yang tidak ada")
	}
}

func TestReadWriteCache(t *testing.T) {
	dir := t.TempDir()
	key := "testkey123"
	streamIndex := 2
	data := []byte("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n")

	// Sebelum write: harus miss
	_, ok := ReadCache(dir, key, streamIndex)
	if ok {
		t.Error("cache harus miss sebelum write")
	}

	// Write
	if err := WriteCache(dir, key, streamIndex, data); err != nil {
		t.Fatalf("WriteCache error: %v", err)
	}

	// Setelah write: harus hit
	got, ok := ReadCache(dir, key, streamIndex)
	if !ok {
		t.Error("cache harus hit setelah write")
	}
	if string(got) != string(data) {
		t.Errorf("data cache tidak cocok: got %q, want %q", got, data)
	}
}

func TestCachePath(t *testing.T) {
	path := CachePath("/cache", "abc123", 5)
	want := filepath.Join("/cache", "subtitles", "abc123", "5.vtt")
	if path != want {
		t.Errorf("CachePath = %q, want %q", path, want)
	}
}

// ===== Integration test: Probe + Extract (skip kalau ffmpeg tidak ada) =====

func TestProbe_RealFile(t *testing.T) {
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe tidak terinstall — skip integration test")
	}
	videoPath := os.Getenv("TEST_VIDEO_PATH")
	if videoPath == "" {
		t.Skip("set TEST_VIDEO_PATH untuk jalankan integration test")
	}

	tracks, err := Probe(context.Background(), ffprobe, videoPath)
	if err != nil {
		t.Fatalf("Probe error: %v", err)
	}
	t.Logf("Ditemukan %d text-based subtitle track:", len(tracks))
	for _, tr := range tracks {
		t.Logf("  index=%d codec=%s lang=%q title=%q default=%v forced=%v",
			tr.Index, tr.Codec, tr.Lang, tr.Title, tr.Default, tr.Forced)
	}
}

func TestExtract_RealFile(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg tidak terinstall — skip integration test")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe tidak terinstall — skip integration test")
	}
	videoPath := os.Getenv("TEST_VIDEO_PATH")
	if videoPath == "" {
		t.Skip("set TEST_VIDEO_PATH untuk jalankan integration test")
	}

	// Probe dulu untuk dapat index
	tracks, err := Probe(context.Background(), ffprobe, videoPath)
	if err != nil {
		t.Fatalf("Probe error: %v", err)
	}
	if len(tracks) == 0 {
		t.Skip("tidak ada text-based subtitle di file ini")
	}

	// Extract track pertama
	tr := tracks[0]
	data, err := Extract(context.Background(), ffmpeg, videoPath, tr.Index)
	if err != nil {
		t.Fatalf("Extract error: %v", err)
	}
	if len(data) == 0 {
		t.Error("hasil extract tidak boleh kosong")
	}
	// Harus diawali dengan WEBVTT
	if len(data) < 6 || string(data[:6]) != "WEBVTT" {
		t.Errorf("output harus diawali 'WEBVTT', got: %q", string(data[:min(20, len(data))]))
	}
	t.Logf("Extract berhasil: %d bytes", len(data))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
