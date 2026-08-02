package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveSafe(t *testing.T) {
	root := t.TempDir()

	tests := []struct {
		name    string
		relPath string
		want    string
		wantErr error
	}{
		{
			name:    "nested path",
			relPath: "movies/2026/feature.mp4",
			want:    filepath.Join(root, "movies", "2026", "feature.mp4"),
		},
		{
			name:    "traversal",
			relPath: "../outside.txt",
			wantErr: ErrPathNotAllowed,
		},
		{
			name:    "absolute path",
			relPath: filepath.Join(string(filepath.Separator), "outside.txt"),
			wantErr: ErrPathNotAllowed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ResolveSafe(root, tt.relPath)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ResolveSafe(%q, %q) error = %v, want %v", root, tt.relPath, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("ResolveSafe(%q, %q) = %q, want %q", root, tt.relPath, got, tt.want)
			}
		})
	}
}

func TestResolveSafeRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	link := filepath.Join(root, "escape")

	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks are not supported: %v", err)
	}

	_, err := ResolveSafe(root, "escape/secret.txt")
	if !errors.Is(err, ErrPathNotAllowed) {
		t.Fatalf("ResolveSafe(%q, %q) error = %v, want %v", root, "escape/secret.txt", err, ErrPathNotAllowed)
	}
}
