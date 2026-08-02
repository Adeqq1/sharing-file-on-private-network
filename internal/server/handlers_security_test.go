package server

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHandleUploadRejectsForeignOrigin(t *testing.T) {
	dir := t.TempDir()
	cfg := &Config{SharedFolder: dir, UploadMaxBytes: 1024, UploadMaxFiles: 1}
	req := httptest.NewRequest(http.MethodPost, "/api/upload?path=", nil)
	req.Host = "lan.example"
	req.Header.Set("Origin", "http://evil.example")
	response := httptest.NewRecorder()

	HandleUpload(cfg).ServeHTTP(response, req)
	if response.Code != http.StatusForbidden {
		t.Errorf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestHandleUploadRejectsTooManyFiles(t *testing.T) {
	dir := t.TempDir()
	cfg := &Config{SharedFolder: dir, UploadMaxBytes: 1024, UploadMaxFiles: 1}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, name := range []string{"one.txt", "two.txt"} {
		part, err := writer.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(part, "x"); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/upload?path=", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	response := httptest.NewRecorder()

	HandleUpload(cfg).ServeHTTP(response, req)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", response.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestHandleDownloadZipIncludesFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "note.txt"), []byte("hello"), 0600); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/download-zip?path=note.txt", nil)
	HandleDownloadZip(&Config{SharedFolder: dir}).ServeHTTP(response, request)

	reader, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) != 1 || reader.File[0].Name != "note.txt" {
		t.Fatalf("zip entries = %#v, want note.txt", reader.File)
	}
}
