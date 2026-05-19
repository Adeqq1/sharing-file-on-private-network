# LAN Hub

Web service ringan untuk berbagi file dan membuka file dari perangkat mobile di jaringan LAN yang sama.

## Fitur

- 📁 Browse folder yang di-share dari HP/tablet
- 🖥️ Buka file di laptop dengan aplikasi pilihan ("Open With")
- ⬇️ Download file ke HP
- ⬆️ Upload file dari HP ke laptop
- 🔒 PIN opsional agar tidak sembarang orang bisa akses
- 🌙 Dark mode otomatis
- 📱 Responsif di semua ukuran layar

## Cara Menjalankan

### Prasyarat

- [Go 1.21+](https://go.dev/dl/)
- Windows (untuk fitur "Open With")

### Langkah

1. Clone atau download repo ini.

2. Edit `config.json` sesuai kebutuhan (lihat bagian Konfigurasi di bawah).

3. Jalankan server:
   ```
   go run main.go
   ```

4. Buka browser di HP dan akses URL yang tercetak di console, contoh:
   ```
   http://192.168.1.10:8080
   ```

5. Pastikan firewall Windows mengizinkan port 8080. Saat dialog muncul, klik **Allow access**.

## Konfigurasi (`config.json`)

```json
{
  "shared_folder": "C:\\Users\\NamaKamu\\Shared",
  "port": 8080,
  "pin_enabled": false,
  "apps": [
    {
      "id": "vlc",
      "name": "VLC Media Player",
      "exec": "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
      "extensions": ["mp4", "mkv", "mp3"]
    },
    {
      "id": "notepad",
      "name": "Notepad",
      "exec": "notepad.exe",
      "extensions": ["txt", "log", "md"]
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

| Field | Keterangan |
|---|---|
| `shared_folder` | Path absolut folder yang akan di-share. Dibuat otomatis jika belum ada. |
| `port` | Port HTTP server. Default: `8080`. |
| `pin_enabled` | `true` untuk mengaktifkan PIN 4 digit. PIN digenerate acak tiap startup dan tercetak di console. |
| `apps[].id` | ID unik aplikasi (dipakai internal). |
| `apps[].name` | Nama yang ditampilkan di UI. |
| `apps[].exec` | Path ke executable. Kosongkan (`""`) untuk menggunakan aplikasi default Windows. |
| `apps[].extensions` | Daftar ekstensi file yang bisa dibuka app ini. Gunakan `"*"` untuk semua file. |

## Struktur Proyek

```
├── main.go                 # Entry point
├── config.json             # Konfigurasi
├── internal/
│   ├── apps/               # Logika filter aplikasi
│   ├── files/              # Logika listing & validasi path
│   ├── netinfo/            # Deteksi IP LAN
│   └── server/             # HTTP handlers & routing
├── web/
│   ├── index.html          # Halaman utama
│   ├── style.css           # Styling (mobile-first, dark mode)
│   └── app.js              # Logic frontend (vanilla JS)
└── README.md
```

## Keamanan

- Server hanya bisa diakses dari jaringan LAN (tidak terekspos ke internet selama router tidak melakukan port forwarding).
- Path traversal dicegah: semua path dari client divalidasi agar tetap di dalam `shared_folder`.
- `exec` aplikasi tidak pernah diterima dari client; hanya `app_id` yang dikirim, lalu server mencari `exec` dari `config.json`.
- Aktifkan `pin_enabled: true` jika ingin lapisan keamanan tambahan.

## Build (opsional)

Untuk membuat binary yang bisa dijalankan tanpa Go terinstall:

```
go build -o lan-hub.exe .
```

Lalu jalankan `lan-hub.exe` dari folder yang sama dengan `config.json` dan folder `web/`.
