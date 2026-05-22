# Issue: Implementasi Seeking untuk Video yang Di-transcode

> **Target pengerjaan:** junior programmer / model AI yang lebih murah.
> **Estimasi:** 1–2 hari kerja (Backend ~3 jam, Frontend ~4 jam, Testing ~2 jam).
> **Bahasa:** Indonesia (ikut konvensi codebase).

---

## 1. TL;DR

Saat ini user **tidak bisa lompat ke menit tertentu** kalau video sedang
di-transcode (MKV HEVC, AVI, WMV, FLV, dll. lewat endpoint `/api/transcode`).
Video hanya bisa diputar dari awal secara berurutan, dan progress bar di custom
player tidak bisa di-drag ke posisi sembarang — ujung-ujungnya video stuck di
awal (mis. `00:00 - 00:04`).

Tugas:

1. Tambah dukungan **time-seek** di endpoint `/api/transcode` lewat query
   param `?t=<detik>`.
2. Update **custom video player** (`web/cplayer.js`) supaya saat user
   drag/click progress bar atau pakai shortcut keyboard, video **reload dari
   posisi yang diminta** — bukan menunggu buffer urut.
3. Subtitle (eksternal & embedded), fullscreen, queue next/prev, dan fitur
   native (`/api/stream` MP4/MP3) **wajib tetap jalan tanpa regresi**.

**Jangan refactor fitur yang sudah jalan.** Format video sudah dideteksi dengan
benar di `internal/media/media.go`, subtitle sudah berfungsi di
`internal/subtitle/`, jangan disentuh kecuali memang nyangkut. Kalau ragu,
**baca dulu file terkait sebelum modify**.

---

## 2. Konteks Singkat (Wajib Baca)

### 2.1 Yang sudah jalan (jangan diubah)

| Komponen | Status | Lokasi |
|---|---|---|
| Stream native MP4/WebM/MP3 + Range/seek | ✅ Sudah jalan | `internal/server/handlers.go` → `HandleStream` (pakai `http.ServeFile` yang otomatis handle `Range` header) |
| Probe ffprobe (durasi, codec, stream) | ✅ Sudah jalan | `internal/transcode/probe.go` → `Probe()` |
| Subtitle eksternal (.srt/.vtt) | ✅ Sudah jalan | `internal/server/handlers.go` → `HandleSubtitle` |
| Subtitle embedded (MKV/MP4) | ✅ Sudah jalan | `internal/embed/`, dipakai di `HandleSubtitle` |
| Custom player (cplayer) | ✅ Sudah jalan | `web/cplayer.js` |
| Deteksi format `streamable` & `needs_transcode` | ✅ Sudah jalan | `internal/media/media.go`, `internal/files/files.go` |

### 2.2 Yang belum jalan (target issue ini)

`/api/transcode` di `internal/server/handlers.go` sekarang:

```go
// Tidak set Content-Length karena ukuran output transcode tidak diketahui di awal
// TODO: Implementasi Range request / HLS untuk seek-friendly playback (follow-up issue)
```

Jadi:

- Server **selalu mulai ffmpeg dari detik 0**, pipe stdout ke response.
- HTTP `Range` header **diabaikan** (tidak ada handler-nya).
- Browser tidak bisa request "kasih saya video mulai detik 600". Setiap kali
  user drag progress bar ke kanan, browser cuma menunggu buffer dari awal.
- Akibatnya UX jelek: kelihatan video cuma bisa diputar 4 detik pertama
  walaupun durasi video 30 menit.

### 2.3 Cara backend ini akan dipakai oleh frontend

Untuk file native (mp4/webm/mp3): `<video src="/api/stream?path=...">` →
browser handle Range otomatis. Tidak perlu diapa-apain.

Untuk file transcode (mkv/avi/wmv/flv/ts): `<video src="/api/transcode?path=...">`
→ ffmpeg pipe ke browser. **Di sini yang harus diperbaiki.**

Pendekatan paling ringan untuk tugas ini: **time-seek lewat query param**.
Browser tidak akan kirim `Range` ke /api/transcode (karena server tidak
advertise `Accept-Ranges`), jadi seeking dipicu manual dari JS player dengan
me-reload `<video>.src` ke URL baru `?t=<detik>`. Backend pakai `-ss <detik>`
di ffmpeg supaya output mulai dari posisi tersebut.

> **Kenapa bukan HTTP Range native / HLS?**
> Implementasi HTTP Range untuk output ffmpeg pipe yang ukurannya belum tahu
> sangat kompleks. HLS butuh segmenter terpisah, cache, dan playlist
> manifest — out of scope. Pendekatan time-seek lewat query param adalah
> kompromi paling simple yang masih memenuhi requirement user (bisa lompat ke
> menit tertentu).

---

## 3. Pendekatan Teknis

### 3.1 Diagram alur

```
USER drag progress bar ke menit 10:00
        │
        ▼
cplayer.js detect: video.src berasal dari /api/transcode?
   ├─ YA  → reload <video>.src = /api/transcode?path=...&t=600
   │       └─ simpan offset 600 detik di state
   │       └─ saat video play, currentTime di-display sebagai
   │          (video.currentTime + offset) di progress bar & label waktu
   │
   └─ TIDAK (file native /api/stream) → biarkan native HTML5 seek (sudah jalan)

BACKEND /api/transcode
        │
        ▼
parse query: path=..., t=600
        │
        ▼
ffmpeg -ss 600 -i <file> -c ... -f mp4 ... pipe:1
   (-ss SEBELUM -i = input seek = cepat, lompat ke keyframe terdekat)
        │
        ▼
output fMP4 ke browser, dimulai dari ~detik 600 (sesuai keyframe terdekat)
```

### 3.2 Kontrak API baru

#### `GET /api/transcode?path=<rel>&t=<detik>`

| Param | Required | Tipe | Default | Keterangan |
|---|---|---|---|---|
| `path` | ya | string | — | Path relatif ke shared_folder (sudah ada) |
| `t` | tidak | float (detik) | `0` | Posisi mulai dalam detik. Boleh desimal (mis. `123.5`). |

**Validasi `t`:**
- Harus bilangan ≥ 0.
- Harus < durasi video (cek pakai `transcode.Probe`). Kalau melebihi, balas
  `400 Bad Request` `{"error": "t melebihi durasi video"}`.
- Format invalid (huruf, negatif) → `400 Bad Request`
  `{"error": "parameter t tidak valid"}`.

**Response:**
- Sukses: `200 OK`, `Content-Type: video/mp4`,
  `Cache-Control: no-store`, body = fMP4 stream dari ffmpeg.
- Tidak ada `Content-Length` (sama seperti behavior sekarang).
- Tetap respect `r.Context()` cancel → ffmpeg di-kill. Jangan ada zombie
  process.

**Backward compat:** kalau `t` tidak dikirim atau `t=0`, behavior sama persis
dengan sekarang. Endpoint existing tidak break.

---

## 4. Tahap Implementasi

> Kerjakan **berurutan**. Setiap step ada perintah verifikasi — pastikan
> hijau dulu sebelum lanjut.

### Step 1 — Backend: terima param `t` di `HandleTranscode`

**File:** `internal/server/handlers.go`

Cari fungsi `HandleTranscode`. Tambah parsing `t` setelah parse `relPath`,
sebelum panggil `transcode.Stream(...)`.

```go
// Parse param ?t=<detik>. Kalau kosong/invalid → 0 (dari awal).
var startSec float64
if tStr := strings.TrimSpace(r.URL.Query().Get("t")); tStr != "" {
    parsed, perr := strconv.ParseFloat(tStr, 64)
    if perr != nil || parsed < 0 {
        writeJSON(w, http.StatusBadRequest, map[string]string{
            "error": "parameter t tidak valid",
        })
        return
    }
    // Validasi: t tidak boleh ≥ durasi (kasih buffer 0.5 detik)
    if probe.Duration > 0 && parsed >= probe.Duration-0.5 {
        writeJSON(w, http.StatusBadRequest, map[string]string{
            "error": "t melebihi durasi video",
        })
        return
    }
    startSec = parsed
}
```

> Pastikan `probe` sudah ter-fetch sebelum cek durasi (lihat fungsi sekarang —
> `transcode.Probe(target, info.ModTime())` sudah dipanggil di atas, taruh
> parsing `t` setelah itu).

Lalu **teruskan `startSec` ke `transcode.Stream`**:

```go
if err := transcode.Stream(r.Context(), target, probe, startSec, w); err != nil {
    return
}
```

> Signature `Stream` akan diubah di Step 2.

### Step 2 — Backend: tambah parameter `startSec` di `transcode.Stream`

**File:** `internal/transcode/transcode.go`

#### 2a. Update signature

Cari fungsi:

```go
func Stream(ctx context.Context, absPath string, probe *ProbeResult, out io.Writer) error {
```

Ubah jadi:

```go
func Stream(ctx context.Context, absPath string, probe *ProbeResult, startSec float64, out io.Writer) error {
```

#### 2b. Update `buildFFmpegArgs` agar terima `startSec`

Cari:

```go
func buildFFmpegArgs(absPath string, probe *ProbeResult) []string {
```

Ubah jadi:

```go
func buildFFmpegArgs(absPath string, probe *ProbeResult, startSec float64) []string {
```

Tambahkan `-ss` **sebelum `-i`** (input seek — jauh lebih cepat daripada
output seek karena ffmpeg lompat ke keyframe terdekat tanpa decode penuh):

```go
base := []string{
    "-hide_banner", "-loglevel", "error",
}
// Input seek: pakai -ss SEBELUM -i (fast, lompat ke keyframe terdekat).
// Hanya tambahkan kalau startSec > 0 untuk hindari overhead di playback awal.
if startSec > 0 {
    base = append(base, "-ss", strconv.FormatFloat(startSec, 'f', 3, 64))
}
base = append(base,
    "-i", absPath,
    "-map", "0:v:0",
    "-map", "0:a:0?",
)
```

> Jangan lupa `import "strconv"` di file ini (cek apakah sudah ada).

#### 2c. Pass `startSec` ke `buildFFmpegArgs`

Di body `Stream`, ubah:

```go
args := buildFFmpegArgs(absPath, probe)
```

jadi:

```go
args := buildFFmpegArgs(absPath, probe, startSec)
```

#### 2d. Update log strategy

Tambahkan info startSec di log supaya gampang debug:

```go
log.Printf("[transcode] start: %s (%s, t=%.1fs)", absPath, strategy, startSec)
```

#### 2e. Verifikasi build

```cmd
go build ./...
```

Harus hijau, tanpa error.

### Step 3 — Backend: jalankan unit test (kalau ada)

```cmd
go test ./internal/transcode/...
go test ./internal/server/...
```

Kalau ada test yang mock `Stream`, mungkin perlu diupdate signature-nya.
Cek file `*_test.go` di folder yang sama. Kalau test lama masih pakai
4-arg signature → tambahkan `0` sebagai arg ke-4.

### Step 4 — Backend: smoke test manual

Jalankan server:

```cmd
go run main.go
```

Test endpoint pakai curl/browser:

1. Tanpa `t` (backward compat):
   ```
   http://localhost:8080/api/transcode?path=video.mkv
   ```
   Harus mulai dari awal — sama seperti sebelumnya.

2. Dengan `t=10`:
   ```
   http://localhost:8080/api/transcode?path=video.mkv&t=10
   ```
   Output video harus mulai dari ~detik 10.

3. `t` invalid:
   ```
   http://localhost:8080/api/transcode?path=video.mkv&t=abc
   ```
   Harus dapat `400 Bad Request` `{"error":"parameter t tidak valid"}`.

4. `t` melebihi durasi (mis. video 60 detik, request `t=999`):
   ```
   http://localhost:8080/api/transcode?path=video.mkv&t=999
   ```
   Harus dapat `400 Bad Request`.

### Step 5 — Frontend: ekspos durasi asli ke player state

**File:** `web/cplayer.js`

Player saat ini mengandalkan `cplayer.video.duration`. Untuk video transcode
yang di-reload dari `?t=<offset>`, `video.duration` **tidak mencakup full
durasi** — hanya sisa dari titik mulai. Kita harus simpan durasi asli
terpisah.

Tambahkan field state baru di object `cplayer.state` (ada di awal file):

```js
state: {
  // ... field yang sudah ada, JANGAN dihapus ...
  transcodeOffset: 0,    // detik offset saat ini untuk video transcode (0 = dari awal)
  totalDuration: 0,       // durasi penuh video dari probe (untuk display & seek)
  isTranscoded: false,    // true kalau src berasal dari /api/transcode
  pendingSeek: null,      // detik tujuan saat seek sedang dalam proses (untuk debounce)
},
```

### Step 6 — Frontend: fetch durasi penuh dari `/api/probe`

**File yang diubah:** `web/app.js` (di fungsi `openPlayer`).

Cari blok ini di `openPlayer`:

```js
if (typeof setPlayerItem === 'function') setPlayerItem(item, filePathOf(item));
if (typeof setQueue === 'function') setQueue(state.allItems, item);
```

Tambahkan **setelah** baris-baris itu (sebelum `if (item.streamable === 'video')`):

```js
// Untuk video transcode, fetch durasi penuh dari probe agar progress bar
// menunjukkan total durasi (bukan sisa dari titik mulai).
if (item.needs_transcode && item.streamable === 'video') {
  fetch('/api/probe?path=' + encodeURIComponent(filePathOf(item)))
    .then(r => r.ok ? r.json() : null)
    .then(probe => {
      if (probe && probe.duration && typeof setTotalDuration === 'function') {
        setTotalDuration(probe.duration, true /*isTranscoded*/);
      }
    })
    .catch(() => { /* probe gagal — fallback ke video.duration native */ });
} else {
  if (typeof setTotalDuration === 'function') setTotalDuration(0, false);
}
```

### Step 7 — Frontend: tambah setter `setTotalDuration` di cplayer.js

**File:** `web/cplayer.js`

Tambahkan helper baru di bagian akhir file (dekat `setPlayerItem`):

```js
// Set durasi penuh + flag transcode dari /api/probe.
// Dipanggil dari app.js sebelum video di-load.
function setTotalDuration(durationSec, isTranscoded) {
  cplayer.state.totalDuration = durationSec || 0;
  cplayer.state.isTranscoded  = !!isTranscoded;
  cplayer.state.transcodeOffset = 0;
}
```

### Step 8 — Frontend: ubah `seekToPointer` untuk video transcode

**File:** `web/cplayer.js`

Cari fungsi `seekToPointer`:

```js
function seekToPointer(e) {
  if (!cplayer.dom.progress || !cplayer.video) return;
  const rect = cplayer.dom.progress.getBoundingClientRect();
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  if (isFinite(cplayer.video.duration)) {
    cplayer.video.currentTime = ratio * cplayer.video.duration;
  }
  updateProgressUI();
}
```

Ubah jadi:

```js
function seekToPointer(e) {
  if (!cplayer.dom.progress || !cplayer.video) return;
  const rect = cplayer.dom.progress.getBoundingClientRect();
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

  const fullDur = effectiveDuration();
  if (!isFinite(fullDur) || fullDur <= 0) return;
  const targetTime = ratio * fullDur;

  if (cplayer.state.isTranscoded) {
    // Video transcode: tidak bisa native seek, harus reload src dengan ?t=...
    requestTranscodeSeek(targetTime);
  } else {
    // Native: seek HTML5 seperti biasa
    cplayer.video.currentTime = targetTime;
  }
  updateProgressUI();
}
```

Tambahkan helper `effectiveDuration` dan `requestTranscodeSeek` (taruh dekat
`seekToPointer`):

```js
// Durasi efektif untuk display: total durasi (transcoded) atau video.duration (native)
function effectiveDuration() {
  if (cplayer.state.isTranscoded && cplayer.state.totalDuration > 0) {
    return cplayer.state.totalDuration;
  }
  return cplayer.video?.duration ?? 0;
}

// Reload <video>.src dengan offset baru. Pakai debounce 250ms agar drag
// progress bar tidak spawn banyak request ffmpeg.
let _seekDebounceTimer = null;
function requestTranscodeSeek(targetSec) {
  cplayer.state.pendingSeek = targetSec;
  clearTimeout(_seekDebounceTimer);
  _seekDebounceTimer = setTimeout(() => {
    const path = cplayer.state.currentPath;
    if (!path) return;
    const t = Math.max(0, Math.floor(cplayer.state.pendingSeek));
    cplayer.state.transcodeOffset = t;
    const url = '/api/transcode?path=' + encodeURIComponent(path) +
                '&t=' + encodeURIComponent(t);
    const v = cplayer.video;
    const wasPaused = v.paused;
    v.src = url;
    v.load();
    // Auto play setelah ready, kecuali user memang lagi pause
    if (!wasPaused) {
      v.addEventListener('canplay', () => v.play().catch(() => {}), { once: true });
    }
    cplayer.state.pendingSeek = null;
  }, 250);
}
```

### Step 9 — Frontend: update display waktu & progress bar

**File:** `web/cplayer.js`

Saat video transcode di-reload dari offset, `video.currentTime` akan mulai
dari 0 (atau mendekati 0). Tapi UI harus menampilkan **time absolut** =
`offset + video.currentTime`.

Ganti fungsi `updateProgressUI`:

```js
function updateProgressUI() {
  if (!cplayer.video || !cplayer.dom.played || !cplayer.dom.handle) return;
  const dur = effectiveDuration();
  const cur = effectiveCurrentTime();
  const pct = isFinite(dur) && dur > 0 ? (cur / dur) * 100 : 0;
  cplayer.dom.played.style.width = pct + '%';
  cplayer.dom.handle.style.left  = pct + '%';
  if (cplayer.dom.progress) {
    cplayer.dom.progress.setAttribute('aria-valuenow', Math.round(pct));
  }
  updateTimeUI();
}
```

Ganti `updateTimeUI`:

```js
function updateTimeUI() {
  if (!cplayer.dom.time || !cplayer.video) return;
  const cur = formatTime(effectiveCurrentTime());
  const dur = formatTime(effectiveDuration());
  cplayer.dom.time.textContent = cur + ' / ' + dur;
}
```

Tambahkan helper baru:

```js
function effectiveCurrentTime() {
  const native = cplayer.video?.currentTime ?? 0;
  if (cplayer.state.isTranscoded) {
    return cplayer.state.transcodeOffset + native;
  }
  return native;
}
```

### Step 10 — Frontend: update double-tap skip & keyboard shortcut

**File:** `web/cplayer.js`

Ada beberapa tempat yang langsung set `v.currentTime = ... + skip`. Untuk
video transcode, ini tidak akan berfungsi (atau hanya seek dalam segmen
sekarang). Bungkus jadi helper.

Tambahkan helper:

```js
// Helper universal untuk skip ±N detik. Otomatis pilih native seek atau
// reload transcode.
function seekRelative(deltaSec) {
  const cur = effectiveCurrentTime();
  const target = Math.max(0, Math.min(effectiveDuration() || 0, cur + deltaSec));
  if (cplayer.state.isTranscoded) {
    requestTranscodeSeek(target);
  } else if (cplayer.video) {
    cplayer.video.currentTime = target;
  }
}
```

Kemudian **ganti** semua tempat yang langsung tulis
`v.currentTime = ... ± angka` di handler gesture (`setupGestureEvents`) dan
keyboard (`setupKeyboardShortcuts`) jadi `seekRelative(±angka)`.

Tempat yang harus diganti (cari dengan grep `currentTime = `):

| Lokasi | Pattern lama | Ganti jadi |
|---|---|---|
| Double-tap (`setupGestureEvents`) | `v.currentTime = Math.max(0, Math.min(v.duration \|\| 0, v.currentTime + skip));` | `seekRelative(skip);` |
| `ArrowLeft` | `v.currentTime = Math.max(0, v.currentTime - 5);` | `seekRelative(-5);` |
| `ArrowRight` | `v.currentTime = Math.min(v.duration \|\| 0, v.currentTime + 5);` | `seekRelative(5);` |
| `j` | `v.currentTime = Math.max(0, v.currentTime - 10);` | `seekRelative(-10);` |
| `l` | `v.currentTime = Math.min(v.duration \|\| 0, v.currentTime + 10);` | `seekRelative(10);` |
| Number 0–9 | `v.currentTime = pct * (v.duration \|\| 0);` | Lihat block khusus di bawah |

Untuk number 0–9 (jump ke persentase), pakai logika absolut:

```js
if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey) {
  e.preventDefault();
  const pct = parseInt(e.key) / 10;
  const target = pct * (effectiveDuration() || 0);
  if (cplayer.state.isTranscoded) {
    requestTranscodeSeek(target);
  } else {
    cplayer.video.currentTime = target;
  }
  showControls();
  return;
}
```

Frame seek (`,` dan `.` saat paused) **biarkan saja pakai
`v.currentTime ± 1/30`** — frame-by-frame seeking di video transcode terlalu
mahal (reload server tiap frame). Tambahkan guard:

```js
case ',':
  e.preventDefault();
  if (v.paused && !cplayer.state.isTranscoded) {
    v.currentTime = Math.max(0, v.currentTime - 1/30);
  }
  showControls();
  break;
case '.':
  e.preventDefault();
  if (v.paused && !cplayer.state.isTranscoded) {
    v.currentTime = Math.min(v.duration || 0, v.currentTime + 1/30);
  }
  showControls();
  break;
```

### Step 11 — Frontend: update hover preview waktu

**File:** `web/cplayer.js`

Cari `updateHoverTime`:

```js
function updateHoverTime(e) {
  if (!cplayer.dom.hoverTime || !cplayer.video) return;
  const rect = cplayer.dom.progress.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  if (!isFinite(cplayer.video.duration)) return;
  const time = ratio * cplayer.video.duration;
  cplayer.dom.hoverTime.textContent = formatTime(time);
  cplayer.dom.hoverTime.style.left = x + 'px';
}
```

Ganti `cplayer.video.duration` jadi `effectiveDuration()`:

```js
function updateHoverTime(e) {
  if (!cplayer.dom.hoverTime || !cplayer.video) return;
  const rect = cplayer.dom.progress.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, x / rect.width));
  const dur = effectiveDuration();
  if (!isFinite(dur) || dur <= 0) return;
  const time = ratio * dur;
  cplayer.dom.hoverTime.textContent = formatTime(time);
  cplayer.dom.hoverTime.style.left = x + 'px';
}
```

### Step 12 — Frontend: handle resume position untuk transcoded video

**File:** `web/cplayer.js`

Listener `loadedmetadata` saat ini menulis `v.currentTime = saved` untuk
resume. Untuk video transcode, ini tidak boleh dipakai langsung (karena
video.duration di stream offset bukan total). Bungkus dengan
`requestTranscodeSeek`:

Cari di `setupVideoEvents`:

```js
v.addEventListener('loadedmetadata', () => {
  updateTimeUI();
  const path = cplayer.state.currentPath;
  if (path) {
    const saved = parseFloat(localStorage.getItem('cp_pos_' + path) || '0');
    if (saved > 5 && isFinite(v.duration) && saved < v.duration - 10) {
      v.currentTime = saved;
      showToastFromPlayer(`▶ Lanjut dari ${formatTime(saved)}`);
    }
  }
});
```

Ganti jadi:

```js
v.addEventListener('loadedmetadata', () => {
  updateTimeUI();
  const path = cplayer.state.currentPath;
  if (!path) return;

  // Skip auto-resume kalau sudah di-reload dari offset (transcodeOffset > 0)
  if (cplayer.state.transcodeOffset > 0) return;

  const saved = parseFloat(localStorage.getItem('cp_pos_' + path) || '0');
  const fullDur = effectiveDuration();
  if (saved > 5 && isFinite(fullDur) && saved < fullDur - 10) {
    if (cplayer.state.isTranscoded) {
      requestTranscodeSeek(saved);
      showToastFromPlayer(`▶ Lanjut dari ${formatTime(saved)}`);
    } else {
      v.currentTime = saved;
      showToastFromPlayer(`▶ Lanjut dari ${formatTime(saved)}`);
    }
  }
});
```

Listener `timeupdate` juga perlu menyimpan `effectiveCurrentTime()` (bukan
`v.currentTime`) supaya saat resume nanti dapet posisi absolut:

Cari:

```js
if (Math.floor(v.currentTime) % 5 === 0 && cplayer.state.currentPath) {
  localStorage.setItem('cp_pos_' + cplayer.state.currentPath, v.currentTime);
}
```

Ganti jadi:

```js
if (Math.floor(v.currentTime) % 5 === 0 && cplayer.state.currentPath) {
  localStorage.setItem('cp_pos_' + cplayer.state.currentPath,
    effectiveCurrentTime());
}
```

### Step 13 — Frontend: reset state di `resetCplayer`

**File:** `web/cplayer.js`

Cari fungsi `resetCplayer`. Tambahkan reset field baru:

```js
cplayer.state.transcodeOffset = 0;
cplayer.state.totalDuration   = 0;
cplayer.state.isTranscoded    = false;
cplayer.state.pendingSeek     = null;
clearTimeout(_seekDebounceTimer);
```

Jangan lupa `_seekDebounceTimer` adalah variable di file scope (deklarasi
sudah ada di Step 8).

### Step 14 — (Opsional, *boleh skip*) Subtitle alignment untuk transcoded seek

**Issue:** kalau video transcode di-reload dari `?t=600`, output fMP4 mulai
dari timestamp 0 (karena `-reset_timestamps 1` di ffmpeg). Tapi file
subtitle (.srt/.vtt) timestamp-nya absolut. Jadi cue subtitle akan
mismatch sebesar `transcodeOffset` detik.

**Quick workaround (RECOMMENDED untuk versi pertama):**

Hapus dan re-attach `<track>` setiap kali `requestTranscodeSeek` dipanggil,
TAPI **shift semua cue secara JavaScript** lewat event `cuechange` di
TextTrack. Atau lebih simple: **tampilkan toast peringatan** kalau user seek
di video transcode bersubtitle:

```js
// Di requestTranscodeSeek, tepat setelah set v.src:
if (cplayer.state.ccEnabled && cplayer.video.textTracks.length > 0) {
  showToastFromPlayer('⚠ Subtitle mungkin offset setelah lompat — disable & enable lagi kalau perlu');
}
```

**Solusi proper (tinggalkan untuk follow-up issue):**

Tambah flag `-output_ts_offset <startSec>` di ffmpeg supaya output fMP4
timestamp-nya absolut, lalu set `mediaGroup` di `<track>` atau gunakan
WebVTT cue offset. **Skip dulu dari issue ini** — terlalu kompleks untuk
junior.

> Kalau ragu, **lewati Step 14**. Subtitle akan kelihatan offset setelah
> seek pertama, tapi ini dapat di-tolerir untuk MVP. Buat follow-up issue
> "Fix subtitle alignment after transcoded seek".

---

## 5. Testing Checklist

Lakukan SEMUA dari atas ke bawah. Centang ✅ yang sudah diverifikasi.

### 5.1 Backend

- [ ] `go build ./...` sukses tanpa error.
- [ ] `go vet ./...` bersih.
- [ ] Existing test masih hijau: `go test ./...`.
- [ ] `curl http://localhost:8080/api/transcode?path=video.mkv` → playable
  dari awal (regresi check).
- [ ] `curl http://localhost:8080/api/transcode?path=video.mkv&t=10` →
  playable dari ~detik 10 (cek pakai `ffprobe` atau VLC).
- [ ] `curl http://localhost:8080/api/transcode?path=video.mkv&t=abc` →
  status 400 + JSON error.
- [ ] `curl http://localhost:8080/api/transcode?path=video.mkv&t=99999` →
  status 400 + JSON error.
- [ ] Cancel request di tengah jalan (Ctrl+C curl) → log server tidak
  menyisakan zombie ffmpeg process (cek Task Manager).

### 5.2 Frontend — file native (`/api/stream`)

> **Wajib tidak regresi.** File MP4/WebM/MP3.

- [ ] Buka MP4. Drag progress bar ke tengah → langsung lompat (sama seperti
  sebelumnya).
- [ ] Tombol panah kiri/kanan, j/l, double-tap → masih jalan.
- [ ] Tombol angka 0-9 → masih jalan.
- [ ] Resume position masih jalan (tutup di menit 5, buka lagi → lanjut).
- [ ] Subtitle masih jalan.

### 5.3 Frontend — file transcode (`/api/transcode`)

> Pakai file MKV HEVC, AVI, atau WMV untuk test.

- [ ] Buka MKV → mulai play dari awal.
- [ ] Drag progress bar ke menit 10 → setelah ~250ms (debounce) +
  ffmpeg startup, video reload dari menit 10.
- [ ] Label waktu menampilkan `10:00 / 30:00` (bukan `0:00 / 20:00`).
- [ ] Hover progress bar di menit 20 → tooltip menampilkan `20:00`.
- [ ] Double-tap kanan → skip +10 detik dari waktu absolut sekarang.
- [ ] Keyboard `5` → lompat ke 50% durasi total.
- [ ] Drag-drag-drag progress bar berkali-kali → tidak spawn 10 ffmpeg
  bersamaan (debounce kerja).
- [ ] Tutup player → resume next time bekerja (tetap di menit absolut yg
  benar).
- [ ] Concurrent: 2 user buka MKV berbeda → tidak deadlock (ada semaphore
  `maxConcurrentTranscodes = 2`, ini aman).

### 5.4 Frontend — edge case

- [ ] Buka audio MP3 → tidak kena perubahan (bukan video). Aman.
- [ ] Buka WebM → native Range, seek tetap jalan.
- [ ] ffmpeg tidak terinstall → kalau buka MKV, error message jelas
  (existing behavior).
- [ ] Refresh halaman saat video transcode lagi play di menit 10 → setelah
  buka lagi, resume kembali ke menit 10 (atau dekatnya).

---

## 6. File yang Boleh & Tidak Boleh Disentuh

### Boleh diubah (target issue ini)

```
internal/server/handlers.go     # parsing param ?t=
internal/transcode/transcode.go # signature Stream + buildFFmpegArgs
web/cplayer.js                  # state, seek logic, UI display
web/app.js                      # fetch /api/probe untuk durasi total
issue.md                        # dokumen ini sendiri (kalau perlu update)
```

### **Jangan disentuh** (sudah jalan)

```
internal/transcode/probe.go         # probe ffprobe & cache
internal/embed/                     # embedded subtitle extractor
internal/subtitle/                  # subtitle parser
internal/files/files.go             # file listing
internal/media/media.go             # deteksi format
internal/server/auth.go             # PIN & session
internal/server/config.go           # config loader
internal/live/                      # live stream feature
internal/netinfo/                   # detect LAN IP
web/index.html                      # struktur HTML player (sudah pas)
web/style.css                       # styling
web/live.js                         # live tab
*_test.go                           # update HANYA kalau ada compile error
                                    # akibat ganti signature Stream
```

> Kalau perlu modifikasi file di kolom kanan, **STOP dan tanya**. Mungkin
> ada cara lain yang tidak invasif.

---

## 7. Catatan & Potensi Masalah

### 7.1 Latency seek di video transcode

Karena setiap seek = restart ffmpeg + buffer ulang, ada **delay 1–3 detik**
sebelum video mulai play di posisi baru. Ini **expected behavior**.
Tampilkan spinner (sudah ada di `#player-spinner`) saat reload.

Pastikan spinner muncul saat `requestTranscodeSeek` dipanggil:

```js
// Di awal requestTranscodeSeek (setelah clearTimeout):
if (cplayer.dom.spinner) cplayer.dom.spinner.classList.remove('hidden');
```

Spinner sudah otomatis di-hide oleh listener `canplay` yang ada.

### 7.2 Keyframe alignment

ffmpeg `-ss` SEBELUM `-i` lompat ke **keyframe terdekat**, bukan persis ke
detik yang diminta. Jadi kalau user minta `t=600`, video bisa mulai di
`598` atau `601` tergantung GOP size. Ini **trade-off untuk speed** —
input seek bisa 100x lebih cepat dari output seek (`-ss` setelah `-i` =
decode dari awal sampai detik target).

Kalau user mau akurasi lebih tinggi, pakai `-ss` setelah `-i` (lambat),
tapi untuk LAN streaming, accuracy ±2 detik **dapat diterima**.

### 7.3 Rapid seek storm

Kalau user drag progress bar bolak-balik 10x dalam 1 detik, debounce
250ms akan cancel request lama. Tapi kalau debounce dilewati (>250ms gap),
bisa spawn beberapa ffmpeg. Semaphore di `transcode.go`
(`maxConcurrentTranscodes = 2`) sebagai safety net. Ini **sudah aman**,
tidak perlu perubahan.

### 7.4 Subtitle offset

Lihat Step 14. Subtitle akan offset sebesar `transcodeOffset` setelah seek.
Boleh diabaikan untuk versi pertama. Catat di follow-up issue.

### 7.5 Bagaimana kalau user pakai HP / browser lama?

`<video>.load()` adalah API HTML5 standar — semua browser modern (Chrome,
Safari, Firefox, Edge) support. Tidak butuh polyfill.

iOS Safari: tested → OK. Android Chrome: OK.

---

## 8. Definition of Done

Issue dianggap selesai kalau:

1. ✅ Semua testing checklist di Section 5 hijau.
2. ✅ Kode di-commit dengan pesan jelas, mis.
   `feat(transcode): time-seek via ?t= param + frontend seek reload`.
3. ✅ Dokumentasi: tambah baris di README.md bagian "API Reference":

   ```
   | `GET` | `/api/transcode` | `?path=<rel>&t=<detik>` | Stream fMP4 dari posisi t |
   ```

4. ✅ Komen TODO di `handlers.go` (`// TODO: Implementasi Range request /
   HLS untuk seek-friendly playback (follow-up issue)`) dihapus atau
   diupdate.
5. ✅ Tidak ada regresi di video native, audio, subtitle, fullscreen,
   queue.
6. ✅ Kalau ada follow-up subtitle alignment yang di-skip (Step 14), buat
   issue baru terpisah dengan judul **"Fix subtitle cue alignment after
   transcoded seek"**.

---

## 9. Rangkuman untuk yang Buru-buru

```
Backend (Go):
  handlers.go      → parse ?t= float, validasi, teruskan ke Stream(ctx, path, probe, t, w)
  transcode.go     → Stream nerima startSec; tambah "-ss <t>" sebelum "-i" di ffmpeg args

Frontend (JS):
  app.js           → openPlayer fetch /api/probe untuk durasi penuh
  cplayer.js       → state baru: transcodeOffset, totalDuration, isTranscoded
                     helper: effectiveDuration(), effectiveCurrentTime(),
                              seekRelative(), requestTranscodeSeek()
                     ganti semua v.currentTime = ... di handler seek jadi
                     seekRelative()/requestTranscodeSeek()
                     update updateProgressUI, updateTimeUI, updateHoverTime
                     pakai effective*() bukan video.* langsung
                     reset field baru di resetCplayer

Test:
  Native files (mp4/webm/mp3)   → tidak regresi
  Transcode files (mkv/avi/wmv) → seek bekerja dengan delay 1-3 detik
  Subtitle alignment            → boleh offset (follow-up issue)
```

Selesai.
