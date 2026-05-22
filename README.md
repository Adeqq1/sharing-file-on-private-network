# LAN Hub 📡

Web service ringan berbasis **Go native** (zero dependency eksternal) untuk berbagi file dan membuka file di laptop dari perangkat mobile dalam **jaringan LAN yang sama**.

> Cocok untuk yang sering pindah file antara HP dan laptop tanpa harus colok kabel atau pakai cloud.

---

## ✨ Fitur

| | |
|---|---|
| 📁 **Browse file** | Jelajahi folder yang di-share langsung dari HP, dengan breadcrumb dan search |
| 🖥️ **Open With** | Klik file di HP, pilih aplikasi, file langsung dibuka di laptop (VLC, Notepad, dll) |
| 📺 **Streaming di HP** | Putar video & audio langsung di browser HP tanpa download (MP4, WebM, MP3, M4A, OGG) |
| 📲 **Buka di App HP** | Stream MKV/AVI/FLAC ke VLC, MX Player, dll lewat playlist .m3u |
| ⬇️ **Download** | Download file dari laptop ke HP dengan satu tap |
| ⬆️ **Upload** | Upload file dari HP ke laptop, batas 200 MB per file |
| 🔒 **PIN opsional** | PIN 4 digit acak per sesi, dengan rate limit anti brute-force |
| 🌙 **Dark mode** | Mengikuti pengaturan sistem secara otomatis |
| 📱 **Responsive** | Mobile-first, ringan (< 20KB total aset frontend) |

---

## 🚀 Quick Start

### 1. Prasyarat

- **[Go 1.21+](https://go.dev/dl/)** terinstall di laptop
- **Windows** (Linux/Mac juga jalan, tapi fitur "Open With" optimal di Windows)
- Laptop dan HP terhubung ke **WiFi/router yang sama**

### 2. Clone repo

```cmd
git clone https://github.com/Adeqq1/sharing-file-on-private-network.git
cd sharing-file-on-private-network
```

### 3. Buat `config.json` dari template

```cmd
copy config.example.json config.json
```

> File `config.json` masuk `.gitignore` agar konfigurasi laptop kamu tidak ter-commit.

### 4. Edit `config.json`

Ubah field `shared_folder` ke path folder yang mau dibagikan. Contoh:

```json
{
  "shared_folder": "C:\\Users\\NamaKamu\\Shared",
  "port": 8080,
  "pin_enabled": false,
  "apps": [...]
}
```

> 💡 Folder akan dibuat otomatis kalau belum ada.

### 5. Jalankan server

```cmd
go run main.go
```

Output di console akan seperti ini:

```
┌─────────────────────────────────────────┐
│           LAN Hub Server                │
├─────────────────────────────────────────┤
│  Laptop  : http://localhost:8080
│  HP/Tablet: http://192.168.1.10:8080
├─────────────────────────────────────────┤
│  Shared  : C:\Users\NamaKamu\Shared
└─────────────────────────────────────────┘

Tekan Ctrl+C untuk menghentikan server.
```

### 6. Akses dari HP

1. Pastikan HP terhubung ke WiFi yang sama dengan laptop.
2. Buka browser di HP, ketik URL `http://192.168.x.x:8080` (sesuai output di console).
3. **Buka akses firewall** — lihat langkah berikutnya di bawah.

> Jika halaman tidak terbuka, lihat bagian [Troubleshooting](#-troubleshooting) di bawah.

### 7. Setup Firewall (penting, dilakukan sekali saja)

Secara default, Windows akan **memblokir koneksi masuk** dari device lain ke port 8080. Ada dua cara:

**Cara A — pakai script (direkomendasikan):**

1. Klik kanan file `setup-firewall.ps1` → **Run with PowerShell**.
2. Klik **Yes** saat dialog UAC muncul (script butuh admin).
3. Selesai. Rule firewall otomatis dibuat untuk port 8080.

**Cara B — manual via dialog Windows:**

1. Saat pertama kali jalan `go run main.go`, Windows menampilkan dialog **"Windows Defender Firewall has blocked some features"**.
2. Centang **Private networks** (jangan centang Public).
3. Klik **Allow access**.

Kalau dialog tidak muncul (kelewat di-cancel), pakai Cara A atau buat rule manual:
```cmd
netsh advfirewall firewall add rule name="LAN Hub" dir=in action=allow protocol=TCP localport=8080
```

---

## ⚙️ Konfigurasi (`config.json`)

### Field utama

| Field | Tipe | Keterangan |
|---|---|---|
| `shared_folder` | string | Path absolut folder yang dibagikan. Akan dibuat otomatis jika belum ada. |
| `port` | int | Port HTTP server. Default: `8080`. Ganti jika bentrok dengan aplikasi lain. |
| `pin_enabled` | bool | `true` untuk aktifkan login PIN 4 digit. PIN digenerate acak tiap startup. |
| `apps` | array | Daftar aplikasi yang bisa dipakai untuk "Open With". |

### Field per aplikasi

| Field | Keterangan |
|---|---|
| `id` | ID unik (huruf kecil, tanpa spasi). Dipakai internal, tidak ditampilkan ke user. |
| `name` | Nama yang muncul di tombol modal "Open With". |
| `exec` | Path lengkap ke executable. Kosongkan (`""`) untuk pakai aplikasi default Windows. |
| `extensions` | Array ekstensi file yang cocok (tanpa titik). Pakai `["*"]` untuk semua file. |

### Contoh konfigurasi lengkap

```json
{
  "shared_folder": "D:\\LANShare",
  "port": 8080,
  "pin_enabled": true,
  "apps": [
    {
      "id": "vlc",
      "name": "VLC Media Player",
      "exec": "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
      "extensions": ["mp4", "mkv", "avi", "mp3", "flac"]
    },
    {
      "id": "vscode",
      "name": "Visual Studio Code",
      "exec": "C:\\Users\\NamaKamu\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "extensions": ["txt", "md", "js", "go", "py", "json", "html", "css"]
    },
    {
      "id": "photos",
      "name": "Windows Photos",
      "exec": "",
      "extensions": ["jpg", "jpeg", "png", "gif", "webp"]
    },
    {
      "id": "default",
      "name": "Buka dengan Default",
      "exec": "",
      "extensions": ["*"]
    }
  ]
}
```

> ⚠️ **Penting**: Path Windows di JSON pakai **double backslash** (`\\`), bukan single. Salah satu penyebab umum config gagal di-load.

---

## 🔒 Keamanan

LAN Hub dirancang untuk pemakaian rumah/kantor pribadi, bukan untuk diekspos ke internet.

| Lapisan | Penjelasan |
|---|---|
| **Path traversal** | Semua path dari HP divalidasi agar tetap di dalam `shared_folder`. Symlink yang menunjuk keluar juga ditolak. |
| **App whitelisting** | Path executable (`exec`) tidak pernah diterima dari client. Client hanya kirim `app_id`, server cocokkan dengan daftar di `config.json`. |
| **PIN brute-force protection** | Jika PIN aktif, akun dikunci 5 menit setelah 5 percobaan gagal. |
| **HTTP-only cookie** | Token sesi tidak bisa diakses lewat JavaScript di client. |
| **Cookie expiry** | Sesi otomatis expired setelah 24 jam, plus janitor goroutine membersihkan token kadaluarsa tiap 30 menit. |

> ⚠️ **Jangan port-forward server ini ke internet**. Ini bukan hardened service untuk publik.

---

## 🛠️ Cara Pakai (User Guide)

### Browse file
1. Buka URL server di HP.
2. Tap folder untuk masuk, atau tap **🏠 Home** di breadcrumb untuk balik ke root.
3. Pakai search bar di atas untuk filter file di folder saat ini.

### Buka file di laptop ("Open With")
1. Tap nama file (bukan folder) di list.
2. Modal "Buka dengan..." muncul, menampilkan app yang cocok dengan ekstensi file tersebut.
3. Tap aplikasi pilihan → file langsung terbuka di laptop.

### Download ke HP
1. Tap file → modal muncul.
2. Tap tombol **⬇ Download ke HP** di bagian bawah modal.

### Upload dari HP
1. Tap ikon **⬆** di pojok kanan atas header.
2. Pilih satu atau beberapa file dari HP.
3. File otomatis di-upload ke folder yang sedang aktif di breadcrumb.
4. Jika nama file sudah ada di server, otomatis diberi suffix `(1)`, `(2)`, dst.

### Streaming video / audio di HP
1. Tap file video (`.mp4`, `.webm`) atau audio (`.mp3`, `.m4a`, `.ogg`, `.wav`, `.aac`).
2. Tap tombol **▶ Putar Video di HP** atau **♪ Putar Audio di HP** di modal.
3. Player fullscreen muncul, file diputar langsung — tidak perlu download dulu.

**Custom Player Controls:**
- **Tap** layar → toggle controls
- **Double-tap kiri/kanan** → skip ±10 detik
- **Swipe atas-bawah** sisi kanan → volume
- **Swipe atas-bawah** sisi kiri → brightness
- **Tombol speed** → 0.5x sampai 2x
- **Tombol CC** → toggle subtitle (auto-detect `.srt`/`.vtt` di folder yang sama)
- **Tombol fullscreen** → masuk/keluar fullscreen

**Keyboard shortcuts (desktop):**

| Tombol | Fungsi |
|---|---|
| `Space` / `K` | Play/Pause |
| `←` / `→` | Seek ±5 detik |
| `↑` / `↓` | Volume |
| `F` | Fullscreen |
| `M` | Mute |
| `C` | Toggle subtitle |

**Subtitle:**
File subtitle dengan basename sama (mis. `film.srt` untuk `film.mp4`) otomatis terdeteksi. Format SRT dikonversi ke WebVTT secara otomatis. Untuk multi-bahasa, pakai `film.id.srt`, `film.en.srt`, dll.

### Buka file di app native HP (VLC, MX Player, dll)

Untuk format yang tidak bisa di-browser (MKV, AVI, FLAC), atau jika ingin pakai fitur app (subtitle otomatis, codec lengkap, background play):

1. Tap file di list.
2. Tap **📲 Buka dengan App di HP**.
3. Pilih cara:
   - **Download Playlist .m3u** — paling reliable. File kecil ter-download, buka pakai app pilihan, stream langsung dari laptop.
   - **Bagikan link** — pakai dialog Share native HP. Hanya muncul di Chrome/Safari.
   - **Salin link stream** — paste di kolom URL app media player.

**Format yang didukung:**

| Tipe | Browser HP | App Native HP |
|---|:---:|:---:|
| MP4, M4V, WebM, MOV | ✅ | ✅ |
| MP3, M4A, AAC, OGG, WAV | ✅ | ✅ |
| MKV, AVI, WMV, FLV, TS | ❌ | ✅ |
| FLAC, WMA | ❌ | ✅ |
| PDF, ZIP, dll | ❌ | ❌ (download saja) |

**Apps yang sudah dites:** VLC for Android/iOS, MX Player Pro, nPlayer, KMPlayer Mobile, Poweramp.

### Login dengan PIN (jika diaktifkan)
1. Saat server start, PIN 4 digit acak akan tercetak di console laptop.
2. Buka URL di HP → halaman login muncul.
3. Ketik PIN yang tercetak di console.
4. Sesi tersimpan 24 jam (cookie HTTP-only).

---

## 🧰 Troubleshooting

### IP yang muncul `169.254.x.x` (APIPA)
Itu IP **fallback Windows** yang muncul ketika laptop **tidak dapat IP dari router** (DHCP gagal). Penyebab umum:
- Laptop sebenarnya tidak terhubung WiFi/Ethernet.
- WiFi terhubung tapi router-nya tidak memberi IP (coba reconnect WiFi).
- Go salah pilih adapter virtual (VirtualBox, VMware, Hyper-V) yang tidak terhubung ke router.

**Solusi:**
1. Cek manual di cmd: `ipconfig` → lihat baris **IPv4 Address** di adapter "Wi-Fi" atau "Ethernet". Pastikan formatnya `192.168.x.x` atau `10.x.x.x`.
2. Jika IPv4 di WiFi adapter tetap `169.254.x.x`, disconnect lalu reconnect WiFi.
3. Jika Go masih salah pilih adapter walaupun IPv4 sudah benar, restart server (`Ctrl+C` lalu `go run main.go` lagi). Sejak versi terbaru, virtual adapter otomatis di-skip.

### "Connection refused" / "This site can't be reached" dari HP
- Pastikan laptop dan HP di **WiFi yang sama**. Coba ping IP laptop dari HP (pakai app Network Tools).
- Cek **firewall** — jalankan `setup-firewall.ps1` sebagai admin (lihat [Quick Start step 7](#7-setup-firewall-penting-dilakukan-sekali-saja)).
- Beberapa router WiFi punya **AP isolation** yang memblokir komunikasi antar device. Cek setting router, matikan "Client Isolation" atau "AP Isolation".
- Antivirus pihak ketiga (Avast, Kaspersky, dll) kadang punya firewall sendiri. Tambah pengecualian untuk port 8080.

### Port 8080 sudah dipakai
- Ubah `port` di `config.json` ke port lain (misal `8081`, `9000`).
- Atau cek aplikasi yang pakai port 8080: `netstat -ano | findstr :8080` di cmd.

### Konfigurasi `apps[]` tidak muncul di modal "Open With"
- Pastikan ekstensi di `extensions` cocok dengan file yang di-tap (lowercase, tanpa titik).
- Lihat output console: jika ada peringatan `apps[N]: exec '...' tidak ditemukan`, perbaiki path executable.
- Pastikan `extensions` adalah array string, contoh `["mp4", "mkv"]` bukan `"mp4,mkv"`.

### File tidak terbuka di laptop saat tap "Open With"
- Cek log di console laptop — akan tercatat method, path, dan status code request.
- Pastikan path executable di `config.json` benar (test buka manual di Windows Explorer).
- Jika pakai aplikasi UWP/Microsoft Store (mis. Photos baru), kosongkan `exec` dan pakai default Windows.

### Saya lupa PIN
- PIN digenerate ulang setiap kali server di-restart. Stop server (Ctrl+C), jalankan lagi, PIN baru akan tercetak.

### Tombol "Salin link" tidak menyalin apapun
Beberapa browser (Firefox, Brave) memblokir `navigator.clipboard` di HTTP non-secure. LAN Hub akan otomatis tampilkan modal manual — tap textarea, pilih semua teks, lalu copy seperti biasa.

### Tombol CC tidak muncul padahal ada file subtitle
- Pastikan nama subtitle sama dengan video (cuma beda ekstensi). Contoh: `film.mp4` → `film.srt`.
- File subtitle harus `.srt` atau `.vtt`.
- Refresh halaman setelah menambah subtitle baru ke folder.

---

## 🏗️ Build Binary (Opsional)

Untuk dapat `.exe` standalone yang bisa dijalankan tanpa Go terinstall:

```cmd
go build -o lan-hub.exe .
```

Setelah selesai, kamu cukup punya 3 hal di folder yang sama:

```
lan-hub.exe
config.json
web/
  ├── index.html
  ├── style.css
  └── app.js
```

Lalu jalankan:

```cmd
lan-hub.exe
```

> 💡 Bisa dipindah ke folder lain (misal Desktop), asalkan `config.json` dan folder `web/` ikut dipindah bersama `.exe`.

### Buat shortcut "double-click to run"

1. Klik kanan `lan-hub.exe` → **Create shortcut**.
2. Pindah shortcut ke Desktop.
3. (Opsional) Klik kanan shortcut → Properties → tab Shortcut → klik **Change Icon** untuk ganti ikon.

---

## 📂 Struktur Proyek

```
project-lan-serverPrivate/
├── main.go                       # Entry point + graceful shutdown
├── config.json                   # Konfigurasi (gitignored)
├── config.example.json           # Template config (di-commit)
├── setup-firewall.ps1            # Script setup firewall (run sebagai admin)
├── go.mod                        # Go module (zero dependency eksternal)
├── internal/
│   ├── apps/apps.go              # Filter aplikasi by extension
│   ├── files/files.go            # Listing folder + ResolveSafe (anti traversal)
│   ├── netinfo/netinfo.go        # Deteksi IP LAN
│   └── server/
│       ├── server.go             # Routing + middleware (logger, cache)
│       ├── handlers.go           # Semua HTTP handlers
│       ├── auth.go               # PIN + token + rate limit
│       └── config.go             # Load + validasi config.json
├── web/
│   ├── index.html                # Halaman utama
│   ├── style.css                 # Mobile-first, dark mode
│   └── app.js                    # Vanilla JS (no framework)
├── .gitignore
└── README.md
```

---

## 🌐 API Reference

Semua endpoint butuh cookie `auth` jika `pin_enabled: true`.

| Method | Endpoint | Query / Body | Response |
|---|---|---|---|
| `GET` | `/api/files` | `?path=<relative>` | `{ path, items: [{name, is_dir, size, mod_time, ext}] }` |
| `GET` | `/api/apps` | `?ext=<extension>` | `[{id, name}]` |
| `POST` | `/api/open` | `{app_id, path}` | `{ok: true}` |
| `GET` | `/api/download` | `?path=<relative>` | File stream (attachment) |
| `GET` | `/api/stream` | `?path=<relative>` | File stream (inline, support Range/seek) |
| `GET` | `/api/transcode` | `?path=<relative>&t=<detik>` | fMP4 stream dari ffmpeg, mulai dari posisi `t` detik (default 0) |
| `POST` | `/api/upload` | `?path=<folder>` + multipart `file` | `{ok: true, name}` |
| `POST` | `/api/login` | `{pin}` | `{ok: true}` + cookie `auth` |

### Status code yang umum

| Code | Arti |
|---|---|
| `200` | Sukses |
| `400` | Path tidak diizinkan / body invalid / app_id tidak ada / mencoba buka folder |
| `401` | Belum login (PIN aktif tapi cookie tidak valid) |
| `404` | File tidak ditemukan |
| `413` | File upload melebihi 200 MB |
| `429` | Rate limit (5 percobaan PIN gagal — lock 5 menit) |
| `500` | Error server (cek log console) |

---

## 🛣️ Roadmap (Ide Lanjutan)

- [ ] Preview gambar/video langsung di HP (tanpa download)
- [ ] QR code generator untuk URL server (scan dari HP, otomatis buka)
- [ ] Multi-user dengan PIN berbeda per device
- [ ] HTTPS via mkcert/local CA untuk akses lebih aman
- [ ] Compress folder jadi `.zip` saat download

Punya ide lain? Buka issue di GitHub.

---

## 📜 Lisensi

MIT — bebas dipakai dan dimodifikasi untuk pemakaian pribadi maupun komersial.
