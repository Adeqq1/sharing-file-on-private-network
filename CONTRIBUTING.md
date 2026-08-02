# Contributing

1. Salin `config.example.json` menjadi `config.json` dan pilih folder share sementara.
2. Jalankan `gofmt -l .`, `go vet ./...`, `go test ./...`, dan `go test -race ./...` sebelum membuka PR.
3. Tambahkan regression test untuk perubahan backend; FFmpeg integration test harus opt-in melalui `TEST_VIDEO_PATH`.
4. Jangan commit `config.json`, cache, binary, atau media pribadi.
5. Uji perubahan UI pada desktop dan browser HP jika menyentuh `web/`.
