# LAN Hub 📡

Web service ringan berbasis **Go** untuk berbagi file dan streaming video/audio antara laptop dan HP/tablet di jaringan LAN yang sama. Akses lewat browser HP, tidak perlu install app.

> Cocok untuk pindah file dari laptop ke HP tanpa colok kabel atau pakai cloud, sambil bisa nonton MKV/AVI HEVC langsung di HP tanpa download.

---

## ✨ Fitur

| | |
|---|---|
| 📁 **Browse file** | Jelajahi folder yang di-share dari HP, lengkap breadcrumb dan search |
| 📺 **Streaming langsung** | Putar video & audio di browser HP tanpa download (MP4, WebM, MP3, M4A, OGG, WAV, AAC) |
| 🎬 **On-the-fly transcode** | MKV / AVI / WMV / FLV / TS dikonversi otomatis ke fMP4 lewat ffmpeg dan dipipe ke browser |
| ⏩ **Seeking transcoded video** | Lompat ke menit tertentu pada video transcode lewat query param `?t=` (input seek ffmpeg) |
| 💬 **Subtitle** | Auto-detect file `.srt`/`.vtt` di folder yang sama, plus embedded subtitle (MKV/MP4) di-extract via ffmpeg dan di-cache ke disk |
| 🎮 **Custom video player** | YouTube-like: gesture mobile, speed control, fullscreen + auto-landscape, CC, queue auto-next, resume position |
| ⬇️ **Download** | Tap file → download ke HP dengan satu sentuhan |
| ⬆️ **Upload** | Upload file dari HP ke laptop, batas 200 MB per file, auto-rename kalau bentrok |
| 🔒 **PIN opsional** | PIN 4 digit acak per startup dengan rate limit 5 percobaan / 5 menit |
| 🌙 **Dark mode** | Mengikuti sistem otomatis, atau manual via tombol header |
| 📱 **Responsive** | Mobile-first, frontend < 50 KB total, vanilla JS tanpa framework |

---

## 🧰 Tech Stack

**Backend (Go):**
- Go **1.26.2** (atau 1.21+ secara umum jalan, versi development pakai 1.26.2)
- HTTP server: `net/http` standar (zero web framework)
- Dependency Go modules:
  - [`golang.org/x/net`](https://pkg.go.dev/golang.org/x/net) — utilitas networking ekstensi
  - [`golang.org/x/text`](https://pkg.go.dev/golang.org/x/text) — encoding & charset detection (untuk SRT non-UTF-8 mis. Windows-1252)

**External tools (opsional, untuk format non-native):**
- `ffmpeg` — transcode video MKV/AVI/WMV/FLV/TS dan extract embedded subtitle
- `ffprobe` — probe codec, durasi, stream info

> Tanpa ffmpeg, server tetap jalan; format MP4/WebM/MP3 bisa diputar langsung. Hanya format yang butuh konversi yang akan error.

**Frontend:**
- HTML5 + CSS3 + Vanilla JavaScript (no framework, no build tool)
- HTML5 Video API + Media Source extensions (untuk fragmented MP4 streaming)
- LocalStorage (untuk resume position, theme, volume)

---

## 🚀 Quick Start

### 1. Prasyarat

| | Wajib | Versi minimal | Catatan |
|---|:---:|:---:|---|
| [Go](https://go.dev/dl/) | ✅ | 1.21+ | Untuk build/run dari source |
| ffmpeg + ffprobe | ❌ | 4.0+ | Optional. Hanya jika ingin putar MKV/AVI/HEVC |
| Browser modern di HP | ✅ | 2 tahun terakhir | Chrome, Safari, Firefox, Edge — semua OK |
| Laptop & HP di WiFi yang sama | ✅ | — | Wajib, ini intinya LAN sharing |

**Install ffmpeg (Windows):**

```cmd
winget install --id=Gyan.FFmpeg -e
```

Atau download manual dari [ffmpeg.org](https://ffmpeg.org/download.html) dan tambahkan folder `bin` ke PATH.

### 2. Clone & setup

```cmd
git clone https://github.com/Adeqq1/sharing-file-on-private-network.git
cd sharing-file-on-private-network
copy config.example.json config.json
```

> `config.json` masuk `.gitignore` jadi konfigurasi laptop kamu tidak ter-commit.

### 3. Edit `config.json`

Minimal: ubah `shared_folder` ke folder yang mau dibagikan.

```json
{
  "shared_folder": "C:\\Users\\NamaKamu\\Shared",
  "port": 8080,
  "pin_enabled": false,
  "ffmpeg_path": ""
}
```

> ⚠️ Path Windows pakai **double backslash** (`\\`). Folder otomatis dibuat kalau belum ada. Field `ffmpeg_path` kosong = auto-detect; isi manual kalau ffmpeg ada di lokasi non-standar.

### 4. Run server

```cmd
go run main.go
```

Output:

```
┌─────────────────────────────────────────┐
│           LAN Hub Server                │
├─────────────────────────────────────────┤
│  Laptop  : http://localhost:8080
│  HP/Tablet: http://192.168.1.10:8080
├─────────────────────────────────────────┤
│  Shared  : C:\Users\NamaKamu\Shared
│  Transcode: ENABLED  (ffmpeg 6.1.1)
└─────────────────────────────────────────┘
```

### 5. Setup Firewall (sekali saja)

Windows Defender memblokir port 8080 dari device lain secara default.

**Cara cepat:** klik kanan `setup-firewall.ps1` → **Run with PowerShell** → klik Yes saat dialog admin muncul.

Cara manual:

```cmd
netsh advfirewall firewall add rule name="LAN Hub" dir=in action=allow protocol=TCP localport=8080
```

Untuk hapus rule, lihat [`remove-rule-firewall.md`](./remove-rule-firewall.md).

### 6. Akses dari HP

Buka URL `http://192.168.x.x:8080` (IP dari output console) di browser HP. Selesai.

---

## 🏗️ Arsitektur Project

```
project-lan-serverPrivate/
├── main.go                         # Entry point + graceful shutdown + janitor cache
├── config.json                     # Konfigurasi runtime (gitignored)
├── config.example.json             # Template config
├── go.mod / go.sum                 # Go module + dependency
├── setup-firewall.ps1              # Script setup firewall Windows (admin)
├── remove-rule-firewall.md         # Panduan hapus rule firewall
├── diagnose.ps1                    # Helper diagnostic networking
│
├── internal/                       # Paket internal (tidak bisa di-import dari luar)
│   ├── server/                     # HTTP layer
│   │   ├── server.go               # Routing + middleware (logger, auth, cache header)
│   │   ├── handlers.go             # Semua HTTP handler endpoint
│   │   ├── auth.go                 # PIN, token, rate-limit, janitor token
│   │   └── config.go               # Load + validasi config.json + helper FFmpeg path
│   │
│   ├── files/                      # File system ops
│   │   └── files.go                # ResolveSafe (anti path traversal) + listing folder
│   │
│   ├── media/                      # Deteksi format media
│   │   ├── media.go                # MIME, Kind (video/audio), klasifikasi browser-native
│   │   └── media_test.go
│   │
│   ├── transcode/                  # Wrapper ffmpeg/ffprobe
│   │   ├── transcode.go            # Stream() pipe ffmpeg→HTTP, support input seek (-ss)
│   │   └── probe.go                # ffprobe + LRU cache hasil probe (durasi, codec, stream)
│   │
│   ├── subtitle/                   # Subtitle parser
│   │   ├── subtitle.go             # SRT→VTT converter, charset detection, lang alias
│   │   └── subtitle_test.go
│   │
│   ├── embed/                      # Embedded subtitle (MKV/MP4)
│   │   ├── embed.go                # Probe stream subtitle + extract via ffmpeg
│   │   ├── cache.go                # Cache hasil extract di disk (path-based key)
│   │   └── embed_test.go
│   │
│   └── netinfo/
│       └── netinfo.go              # Deteksi IP LAN, skip adapter virtual
│
├── web/                            # Frontend (di-serve via http.FileServer)
│   ├── index.html                  # Single page app
│   ├── style.css                   # Mobile-first, dark mode, custom player styling
│   ├── app.js                      # State, file listing, upload/download, player launcher
│   └── cplayer.js                  # Custom video player (gesture, fullscreen, seek, CC)
│
└── cache/                          # Cache subtitle embedded (auto-cleanup > 7 hari)
    └── embedded_subtitle/
        └── <sha1>.vtt
```

### Alur request (high-level)

```
HP/Browser ─── HTTP ───► main.go ──► server.New() ──► AuthMiddleware ──► Handler
                                                            │
                                                            ▼
                                              ┌─────────────────────────┐
                                              │  Static (web/*)         │
                                              │  /api/files             │
                                              │  /api/stream            │
                                              │  /api/transcode  ──► transcode.Stream() ──► ffmpeg
                                              │  /api/probe      ──► transcode.Probe()  ──► ffprobe
                                              │  /api/subtitle   ──► subtitle / embed
                                              │  /api/subtitles  ──► subtitle + embed.Probe
                                              │  /api/upload                                          │
                                              │  /api/download                                        │
                                              │  /api/login                                           │
                                              └───────────────────────────────────────────────────────┘
```

**Prinsip desain:**

- **Zero-trust path:** semua path dari client divalidasi via `files.ResolveSafe()` agar tidak keluar dari `shared_folder` (cek path traversal dan symlink).
- **Streaming-first:** video besar tidak di-load full ke RAM. Native files pakai `http.ServeFile` (Range native), transcode pipe ffmpeg stdout langsung ke `http.ResponseWriter`.
- **Fragmented MP4 untuk transcode:** flag `frag_keyframe+empty_moov+default_base_moof` agar browser bisa mulai play sebelum ffmpeg selesai.
- **Concurrent transcode dibatasi:** semaphore `maxConcurrentTranscodes = 2` di `transcode.go` agar CPU laptop tidak overload kalau 5 device drag progress bar bersamaan.
- **Context-aware cancel:** kalau user tutup player, `r.Context()` cancel → ffmpeg di-kill via `exec.CommandContext`.

---

## ⚙️ Konfigurasi (`config.json`)

| Field | Tipe | Default | Keterangan |
|---|---|---|---|
| `shared_folder` | string | — | **Wajib.** Path absolut folder yang dibagikan. Auto-create kalau belum ada. |
| `port` | int | `8080` | Port HTTP server. |
| `pin_enabled` | bool | `false` | `true` → aktifkan login PIN 4 digit (acak per startup). |
| `ffmpeg_path` | string | `""` | Path manual ke `ffmpeg.exe`. Kosong = auto-detect dari PATH + lokasi standar (winget/choco/scoop). `ffprobe` harus tersedia di folder yang sama. |
| `upload_max_bytes` | int | `5368709120` | Batas ukuran setiap file upload dalam byte (default 5 GiB). |
| `upload_max_files` | int | `32` | Batas jumlah file dalam satu request upload. |

Contoh dengan PIN aktif:

```json
{
  "shared_folder": "D:\\LANShare",
  "port": 8080,
  "pin_enabled": true,
  "ffmpeg_path": ""
}
```

Saat server start, PIN tercetak di console:

```
╔══════════════════════════════════╗
║  PIN Akses: 4729                 ║
╚══════════════════════════════════╝
```

---

## 🌐 API Reference

Semua endpoint butuh cookie `auth` (HTTP-only, 24 jam) jika `pin_enabled: true`. Path query param relatif terhadap `shared_folder`.

### File operations

| Method | Endpoint | Query / Body | Response |
|---|---|---|---|
| `GET` | `/api/files` | `?path=<rel>` | `{ path, items: [{name, is_dir, size, mod_time, ext, streamable, native_play, has_subtitle, needs_transcode}] }` |
| `GET` | `/api/download` | `?path=<rel>` | Binary stream dengan header `Content-Disposition: attachment` |
| `POST` | `/api/upload` | `?path=<folder>` + multipart form `file` | `{ ok: true, name }` (auto-rename `(1)`, `(2)` kalau bentrok) |

### Streaming video / audio

| Method | Endpoint | Query | Response |
|---|---|---|---|
| `GET` | `/api/stream` | `?path=<rel>` | File native via `http.ServeFile` (support HTTP Range untuk seek byte-based) |
| `GET` | `/api/transcode` | `?path=<rel>&t=<detik>` | Fragmented MP4 dari ffmpeg, mulai dari posisi `t` detik (default 0). `t` invalid/over-duration → 400. Auto-redirect ke `/api/stream` jika file sudah browser-native. |
| `GET` | `/api/probe` | `?path=<rel>` | `{ format_name, duration, streams: [{index, type, codec, lang, title, default}] }` dari ffprobe + LRU cache |

### Subtitle

| Method | Endpoint | Query | Response |
|---|---|---|---|
| `GET` | `/api/subtitles` | `?path=<video-rel>` | `[{ lang, label, source, track? }]` — list eksternal + embedded subtitle |
| `GET` | `/api/subtitle` | `?path=<video-rel>&lang=<id\|en\|embed:N\|...>` | WebVTT body (`text/vtt; charset=utf-8`). SRT auto-convert. Embedded di-extract via ffmpeg dan cached. |

### Auth

| Method | Endpoint | Body | Response |
|---|---|---|---|
| `POST` | `/api/login` | `{ pin }` | `{ ok: true }` + Set-Cookie `auth` (24h, HTTP-only). 401 kalau salah, 429 kalau locked (5 fail / 5 min). |

### Status code yang umum

| Code | Arti |
|---|---|
| `200` | Sukses |
| `302` | Redirect (transcode → stream untuk file browser-native) |
| `400` | Path tidak valid / param `t` invalid / body invalid |
| `401` | Belum login (PIN aktif, cookie tidak valid) |
| `404` | File tidak ditemukan |
| `413` | Upload melebihi 200 MB |
| `429` | Rate limit PIN (5 percobaan gagal → lock 5 menit) |
| `500` | Error server (cek log console) |
| `503` | ffmpeg tidak tersedia di server |

---

## 🎮 Custom Video Player

Player custom (`web/cplayer.js`) menggantikan `<video controls>` HTML5 default agar UI konsisten antar browser dan support gesture mobile.

**Touch gestures:**
- **Tap layar:** toggle controls (mobile) / play-pause (desktop)
- **Double-tap kiri / kanan:** skip ±10 detik
- **Swipe vertikal sisi kanan:** volume (skipped di iOS karena read-only)
- **Swipe vertikal sisi kiri:** brightness (CSS filter)
- **Drag progress bar:** seek; debounce 250 ms untuk transcoded video, langsung untuk native

**Keyboard shortcuts (desktop):**

| Tombol | Fungsi |
|---|---|
| `Space` / `K` | Play / pause |
| `← / →` | Seek ± 5 detik |
| `J / L` | Seek ± 10 detik |
| `0–9` | Lompat ke 0% – 90% durasi |
| `↑ / ↓` | Volume ± 5% |
| `M` | Mute |
| `F` | Fullscreen |
| `C` | Toggle CC subtitle |
| `, / .` | Frame back / forward (saat paused, video native saja) |

**Fitur lain:**
- Fullscreen + auto-landscape (Screen Orientation API, fallback CSS rotate)
- Picture-in-Picture (browser yang support)
- Speed: 0.25x – 2x
- Multi-track subtitle (eksternal + embedded MKV)
- Resume position per file (localStorage)
- Auto-play next video di folder yang sama (queue)

---

## 🧪 Cara Test

### 1. Unit test Go

Test ada di package `embed`, `live`, `media`, `subtitle`:

```cmd
go test ./...
```

Output yang diharapkan:

```
?       lan-server      [no test files]
ok      lan-server/internal/embed       0.180s
?       lan-server/internal/files       [no test files]
ok      lan-server/internal/media       0.030s
?       lan-server/internal/netinfo     [no test files]
?       lan-server/internal/server      [no test files]
ok      lan-server/internal/subtitle    0.090s
?       lan-server/internal/transcode   [no test files]
```

Verbose (lihat per-test):

```cmd
go test -v ./...
```

Coverage:

```cmd
go test -cover ./...
```

### 2. Static analysis

```cmd
go vet ./...
gofmt -l .
```

Tidak ada output = semuanya bersih.

### 3. Smoke test endpoint manual

Jalankan server di terminal terpisah:

```cmd
go run main.go
```

Lalu test pakai curl atau browser:

```cmd
:: List file
curl http://localhost:8080/api/files?path=

:: Probe info codec
curl http://localhost:8080/api/probe?path=video.mkv

:: Stream dari awal
curl -o out.mp4 http://localhost:8080/api/transcode?path=video.mkv

:: Stream mulai dari menit 5 (300 detik)
curl -o out.mp4 "http://localhost:8080/api/transcode?path=video.mkv&t=300"

:: Validasi error param
curl "http://localhost:8080/api/transcode?path=video.mkv&t=abc"      :: 400
curl "http://localhost:8080/api/transcode?path=video.mkv&t=999999"   :: 400
```

### 4. Frontend test manual

Buka browser (atau HP):
- Klik file MP4 → harus bisa play, drag progress bar harus seek instan
- Klik file MKV/AVI → CPU laptop naik (transcode), drag progress bar → reload dari posisi baru setelah ~250 ms
- Tutup player → cek log server: tidak ada zombie ffmpeg process

### 5. Build + run binary

```cmd
go build -o lan-hub.exe .
lan-hub.exe
```

Binary standalone, bisa dipindah ke folder lain asalkan `config.json` dan folder `web/` ikut.

---

## 🛠️ Cara Pakai (User Guide)

### Browse & download
1. Buka URL server di HP.
2. Tap folder untuk masuk, **🏠 Home** di breadcrumb untuk balik.
3. Tap file → kalau video/audio langsung buka player; kalau tipe lain langsung download.
4. Search bar di atas untuk filter file di folder saat ini.

### Upload dari HP
1. Tap **⬆** di pojok kanan atas.
2. Pilih satu / banyak file. File otomatis ter-upload ke folder yang sedang aktif di breadcrumb.
3. Bentrok nama → auto-suffix `(1)`, `(2)`, dst.

### Streaming video
1. Tap file video di list.
2. Player fullscreen muncul. File native (mp4/webm) langsung play; MKV/AVI dikonversi on-the-fly via ffmpeg (CPU akan naik).
3. Drag progress bar bebas — termasuk untuk transcoded video.

### Subtitle
- File `.srt` / `.vtt` dengan basename sama (`film.srt` untuk `film.mp4`) otomatis terdeteksi.
- Multi-bahasa: pakai pola `film.id.srt`, `film.en.srt` (atau separator `.`, `_`, `-`).
- Embedded subtitle di MKV/MP4 di-extract otomatis via ffmpeg dan di-cache (max 7 hari).
- Toggle via tombol gear di player → **Subtitle**.

### Login PIN (opsional)
Aktifkan `pin_enabled: true` di `config.json`. PIN baru tercetak di console setiap startup. Sesi tersimpan 24 jam. 5 percobaan gagal → kunci 5 menit.

---

## 🧰 Troubleshooting

### IP `169.254.x.x` (APIPA)
DHCP gagal — laptop tidak dapat IP dari router. Disconnect & reconnect WiFi. Cek `ipconfig` di cmd: kolom **IPv4 Address** harus `192.168.x.x` atau `10.x.x.x`.

### "Connection refused" dari HP
- Pastikan laptop & HP di WiFi yang sama (ping IP laptop dari HP via app Network Tools).
- Firewall belum di-allow → jalankan `setup-firewall.ps1` sebagai admin.
- Router pakai **AP / Client Isolation** — matikan di setting router.
- Antivirus pihak ketiga (Avast, Kaspersky) punya firewall sendiri — tambah pengecualian port 8080.

### Port 8080 sudah dipakai
Cek `netstat -ano | findstr :8080` di cmd, lalu ganti `port` di `config.json`.

### Lupa PIN
Stop server (Ctrl+C), `go run main.go` lagi, PIN baru tercetak.

### Video MKV / AVI tidak bisa diputar
ffmpeg tidak terinstall atau tidak terdeteksi. Cek banner startup — harus `Transcode: ENABLED`. Kalau `DISABLED`, install ffmpeg dan restart server. Kalau ffmpeg ada di lokasi non-standar, set `ffmpeg_path` manual di config.

### Subtitle muncul offset setelah seek transcoded video
Known issue. Setelah seek, subtitle file timestamp absolut tapi output fMP4 mulai dari 0. Workaround: disable & enable lagi subtitle dari menu CC. Fix proper di follow-up issue.

### "Salin link" tidak bekerja
Browser di HTTP non-secure block `navigator.clipboard`. LAN Hub fallback ke modal manual — tap textarea, pilih semua, copy.

---

## 🏗️ Build Binary Standalone

```cmd
go build -o lan-hub.exe .
```

Yang harus ada di folder yang sama:

```
lan-hub.exe
config.json
web/   (semua file di dalamnya)
```

Cross-compile ke Linux:

```cmd
set GOOS=linux
set GOARCH=amd64
go build -o lan-hub-linux .
```

---

## 🛣️ Roadmap

- [ ] Fix subtitle alignment setelah seek transcoded video (pakai `-output_ts_offset`)
- [ ] HLS segmenter untuk seek-friendly playback dengan caching segment
- [ ] HTTPS via mkcert / local CA
- [ ] QR code generator untuk URL server (scan dari HP)
- [ ] Compress folder ke `.zip` saat download
- [ ] Multi-user PIN (per-device)
- [ ] Preview thumbnail di file list (auto-generate via ffmpeg)

Punya ide? Buka issue di GitHub.

---

## 📜 Lisensi

MIT — bebas dipakai dan dimodifikasi untuk pribadi maupun komersial.
