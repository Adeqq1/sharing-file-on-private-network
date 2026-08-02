package server

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizeFilenameLongExtensionDoesNotPanic(t *testing.T) {
	name := SanitizeFilename("file." + strings.Repeat("x", 300))
	if !utf8.ValidString(name) {
		t.Fatal("SanitizeFilename returned invalid UTF-8")
	}
	if len([]rune(name)) > 200 {
		t.Errorf("SanitizeFilename length = %d, want <= 200", len([]rune(name)))
	}
}

func TestSanitizeFilenamePreservesUTF8(t *testing.T) {
	name := SanitizeFilename(strings.Repeat("猫", 120) + ".mkv")
	if !utf8.ValidString(name) {
		t.Fatal("SanitizeFilename returned invalid UTF-8")
	}
	if len([]rune(name)) > 200 {
		t.Errorf("SanitizeFilename length = %d, want <= 200", len([]rune(name)))
	}
}
