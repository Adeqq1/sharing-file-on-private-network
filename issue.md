# Issue: Custom Media Player dengan Kontrol Penuh & Subtitle

## Ringkasan Masalah

Pemain video yang ada di LAN Hub saat ini hanya pakai HTML5 `<video controls>` default. Tampilan dan kontrolnya bergantung pada browser (Chrome Android beda dengan Safari iOS), dan **tidak punya fitur penting** untuk pengalaman menonton serius:

- ❌ Tidak ada subtitle (file `.srt` tidak dikenali, padahal hampir semua anime/film punya)
- ❌ Tidak ada kontrol kecepatan playback (1.25x, 1.5x, 2x)
- ❌ Tidak ada keyboard shortcut (space, arrows, F)
- ❌ Tidak ada gesture mobile (double-tap seek, swipe brightness/volume)
- ❌ UI inkonsisten antar browser
- ❌ Tidak ada mini player saat scroll

## Tujuan

Bangun **media player custom** yang menggantikan player default. Player ini fully controllable lewat JavaScript, memberikan kontrol seragam di semua browser, dan punya semua fitur yang dibutuhkan untuk nonton di HP dengan nyaman.

> **CATATAN PENTING**: Player baru ini menggantikan player browser yang sudah ada (HTML5 default), TIDAK mengganggu fitur "Buka dengan App di HP" — itu tetap dengan flow `.m3u`. Custom player ini hanya untuk file yang `streamable` (MP4, WebM, MP3, dll).

Use case nyata:
- Nonton film MP4 dengan subtitle SRT yang ada di folder yang sama.
- Nonton kuliah online di 1.5x supaya cepat.
- Sambil rebahan, double-tap kanan layar untuk skip 10 detik.
- Swipe atas-bawah di sisi kanan layar untuk volume, sisi kiri untuk brightness.

---

## Konsep Penting

### Apa yang dimaksud "custom player"?
Element `<video>` HTML5 tetap dipakai — itu engine pemutaran. Tapi atribut `controls` dilepas, dan kita bangun **UI kontrol sendiri** dari `<div>`/`<button>` yang manipulate properti `<video>` lewat JavaScript:

| Yang ingin dilakukan | API yang dipakai |
|---|---|
| Play/pause | `video.play()`, `video.pause()` |
| Seek ke posisi | `video.currentTime = ...` |
| Volume | `video.volume`, `video.muted` |
| Kecepatan | `video.playbackRate` |
| Fullscreen | `video.requestFullscreen()` |
| Subtitle | `<track>` element + `video.textTracks` |
| Buffering progress | `video.buffered` |
| Update tiap detik | event `timeupdate`, `loadedmetadata`, `progress` |

### Subtitle WebVTT
Browser HTML5 hanya support format **WebVTT** (`.vtt`), bukan SRT. Tapi konversi SRT → VTT itu sederhana sekali (cuma tambah header `WEBVTT` dan ganti koma ke titik di timestamp). Kita bikin endpoint Go yang konversi on-the-fly.

### Yang TIDAK kita lakukan di issue ini
- ❌ Tidak transcoding video (tetap zero ffmpeg dependency)
- ❌ Tidak pakai library video player pihak ketiga (Plyr, Video.js, dll). Tetap vanilla.
- ❌ Tidak hapus fitur "Buka dengan App di HP" — itu tetap untuk MKV/AVI yang browser tidak bisa.
- ❌ Tidak support multi-audio track atau chapter (terlalu kompleks).

---

## Batasan & Prinsip

- **Vanilla JS/CSS/HTML** — tidak boleh pakai Plyr, Video.js, dll.
- **Mobile-first** — desain untuk layar kecil dulu, desktop bonus.
- **Tetap responsive** dan dark-mode aware (ikuti CSS variables yang ada).
- **Tidak ganti `<video>` element** — hanya hilangkan atribut `controls` dan tambah UI di luarnya.
- **Pertahankan fitur lama** — close button, PiP, error handling tetap.
- **Aksesibilitas dasar** — semua tombol punya `aria-label`, kontras teks minimal AA.

---

## Tahap 1 — Backend: Endpoint Subtitle (Opsional tapi Recommended)

### Tujuan
Punya endpoint yang baca file `.srt`/`.vtt` di folder yang sama dengan video, lalu kirim sebagai WebVTT yang bisa dibaca `<track>`.

### Steps

1. Buat package baru `internal/subtitle` dengan satu file `subtitle.go`. Isinya satu fungsi konverter SRT → VTT:
   ```go
   package subtitle

   import (
       "regexp"
       "strings"
   )

   var (
       // Pattern timestamp SRT: 00:00:01,500 --> 00:00:04,000
       commaTimestamp = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)
   )

   // SRTToVTT mengkonversi konten SRT menjadi WebVTT.
   // Perubahan: tambah header "WEBVTT", ganti "," di timestamp jadi ".".
   func SRTToVTT(srtContent string) string {
       // Normalisasi line ending
       srtContent = strings.ReplaceAll(srtContent, "\r\n", "\n")
       // Ganti "00:00:01,500" → "00:00:01.500"
       converted := commaTimestamp.ReplaceAllString(srtContent, "$1.$2")
       return "WEBVTT\n\n" + converted
   }
   ```

2. Buat handler `HandleSubtitle` di `internal/server/handlers.go`:
   ```go
   // GET /api/subtitle?path=<video-path>&lang=<id|en|...>
   // Cari file subtitle dengan basename sama (mis. "film.mp4" → cari "film.srt" atau "film.id.srt").
   // Kalau .vtt langsung serve, kalau .srt konversi ke VTT.
   func HandleSubtitle(cfg *Config) http.HandlerFunc { ... }
   ```

   Logic:
   - Validasi path video (pakai `resolveSafeOrRespond`).
   - Ambil basename tanpa ekstensi (mis. `film.mp4` → `film`).
   - Coba urut: `<base>.<lang>.vtt`, `<base>.<lang>.srt`, `<base>.vtt`, `<base>.srt`.
   - Kalau VTT ditemukan → langsung serve dengan `Content-Type: text/vtt`.
   - Kalau SRT ditemukan → baca, konversi via `subtitle.SRTToVTT`, serve sebagai VTT.
   - Tidak ada → 404 JSON.

3. Daftarkan route di `server.go`: `mux.HandleFunc("/api/subtitle", HandleSubtitle(cfg))`.

4. Tambah field di response `/api/files` untuk indikasi file punya subtitle:
   ```go
   type Item struct {
       // ...
       HasSubtitle bool `json:"has_subtitle"`
   }
   ```
   Logic: saat list folder, untuk setiap file video, scan folder yang sama untuk `<base>.{srt,vtt}`. Cache hasilnya per request.

### DoD
- File `film.mp4` + `film.srt` di folder yang sama → `GET /api/subtitle?path=film.mp4` mengembalikan WebVTT yang valid (header `WEBVTT`).
- File `film.vtt` → diserve apa adanya.
- Tidak ada → 404 JSON.
- Field `has_subtitle: true` muncul di `/api/files` untuk video yang punya subtitle.
- Unit test `SRTToVTT` di `subtitle_test.go`.

---

## Tahap 2 — Frontend: Struktur HTML Player Custom

### Tujuan
Bangun struktur HTML player baru yang menggantikan `<video controls>` default.

### Steps

1. Edit `web/index.html` — ganti seluruh isi `<div class="player-body">` jadi struktur baru:
   ```html
   <div class="player-body">
     <div class="cplayer" id="cplayer">
       <!-- Video element TANPA controls -->
       <video id="player-video" class="cplayer-video" playsinline preload="metadata"></video>

       <!-- Audio mode (untuk MP3) — fallback dengan controls default -->
       <div id="player-audio-wrap" class="player-audio-wrap hidden">
         <div class="player-audio-art">🎵</div>
         <p id="player-audio-title" class="player-audio-title"></p>
         <audio id="player-audio" controls preload="metadata"></audio>
       </div>

       <!-- Spinner loading -->
       <div id="player-spinner" class="player-spinner hidden">
         <div class="spinner-ring"></div>
       </div>

       <!-- Center play overlay (tap to play saat paused) -->
       <button id="cplayer-center-play" class="cplayer-center-play hidden" aria-label="Play">▶</button>

       <!-- Gesture indicators (volume, brightness, seek) -->
       <div id="cplayer-gesture" class="cplayer-gesture hidden">
         <span id="cplayer-gesture-icon">🔊</span>
         <span id="cplayer-gesture-text">50%</span>
       </div>

       <!-- Skip indicators (double-tap kiri/kanan) -->
       <div id="cplayer-skip-back" class="cplayer-skip-indicator skip-left hidden">
         <span>⏪</span><span>-10s</span>
       </div>
       <div id="cplayer-skip-fwd" class="cplayer-skip-indicator skip-right hidden">
         <span>⏩</span><span>+10s</span>
       </div>

       <!-- Bottom controls bar -->
       <div id="cplayer-controls" class="cplayer-controls">
         <!-- Progress bar -->
         <div class="cplayer-progress" id="cplayer-progress">
           <div class="cplayer-progress-buffered" id="cplayer-progress-buffered"></div>
           <div class="cplayer-progress-played" id="cplayer-progress-played"></div>
           <div class="cplayer-progress-handle" id="cplayer-progress-handle"></div>
         </div>

         <!-- Buttons row -->
         <div class="cplayer-btnrow">
           <button id="cplayer-play" class="cplayer-btn" aria-label="Play/Pause">▶</button>
           <span class="cplayer-time" id="cplayer-time">0:00 / 0:00</span>
           <div class="cplayer-spacer"></div>
           <button id="cplayer-cc" class="cplayer-btn cplayer-cc-btn hidden" aria-label="Subtitle">CC</button>
           <button id="cplayer-speed" class="cplayer-btn" aria-label="Speed">1.0x</button>
           <button id="cplayer-fs" class="cplayer-btn" aria-label="Fullscreen">⛶</button>
         </div>
       </div>

       <!-- Speed menu (popup) -->
       <div id="cplayer-speed-menu" class="cplayer-popup hidden">
         <button class="cplayer-popup-item" data-speed="0.5">0.5x</button>
         <button class="cplayer-popup-item" data-speed="0.75">0.75x</button>
         <button class="cplayer-popup-item" data-speed="1.0">1.0x (Normal)</button>
         <button class="cplayer-popup-item" data-speed="1.25">1.25x</button>
         <button class="cplayer-popup-item" data-speed="1.5">1.5x</button>
         <button class="cplayer-popup-item" data-speed="2.0">2.0x</button>
       </div>

       <!-- Subtitle menu -->
       <div id="cplayer-cc-menu" class="cplayer-popup hidden">
         <button class="cplayer-popup-item" data-cc="off">Off</button>
         <button class="cplayer-popup-item" data-cc="on">On</button>
       </div>

       <!-- Error state -->
       <div id="player-error" class="player-error hidden">
         <div class="player-error-icon">⚠️</div>
         <p id="player-error-msg"></p>
         <p class="player-error-hint">Coba "Buka dengan App di HP" untuk format ini.</p>
       </div>
     </div>
   </div>
   ```

### DoD
- Struktur HTML render tanpa error di console.
- Tidak ada styling dulu di tahap ini (kontrol terlihat berantakan, itu wajar).

---

## Tahap 3 — Frontend: CSS Player Custom

### Tujuan
Style player yang **mobile-first**, controls bisa hide/show, smooth transitions.

### Steps

Tambah blok CSS baru di `web/style.css` (paling bawah, ganti yang lama). Strukturnya:

```css
/* ===== Custom Player ===== */
.cplayer {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  overflow: hidden;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.cplayer-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

/* Center play button (saat paused) */
.cplayer-center-play {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 72px; height: 72px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,.6);
  color: #fff;
  font-size: 1.8rem;
  cursor: pointer;
  z-index: 5;
  transition: opacity .2s;
}

/* Gesture indicator (popup tengah saat swipe) */
.cplayer-gesture {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0,0,0,.75);
  color: #fff;
  padding: 14px 22px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 6;
  pointer-events: none;
}
.cplayer-gesture span:first-child { font-size: 1.6rem; }
.cplayer-gesture span:last-child { font-size: .85rem; }

/* Skip indicator (double-tap) */
.cplayer-skip-indicator {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0,0,0,.6);
  color: #fff;
  padding: 18px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: .8rem;
  pointer-events: none;
  animation: skipPulse .6s ease;
}
.cplayer-skip-indicator span:first-child { font-size: 1.3rem; }
.skip-left  { left: 12%; }
.skip-right { right: 12%; }
@keyframes skipPulse {
  0%   { opacity: 0; transform: translateY(-50%) scale(.8); }
  30%  { opacity: 1; transform: translateY(-50%) scale(1); }
  100% { opacity: 0; transform: translateY(-50%) scale(1.1); }
}

/* Controls bar (bottom) */
.cplayer-controls {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  padding: 8px 12px 12px;
  background: linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,0));
  z-index: 10;
  transition: opacity .25s, transform .25s;
}
.cplayer.hide-controls .cplayer-controls,
.cplayer.hide-controls .cplayer-center-play {
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
}

/* Progress bar */
.cplayer-progress {
  position: relative;
  height: 4px;
  background: rgba(255,255,255,.25);
  border-radius: 2px;
  margin-bottom: 8px;
  cursor: pointer;
  touch-action: none;
}
.cplayer-progress-buffered,
.cplayer-progress-played {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  border-radius: 2px;
}
.cplayer-progress-buffered { background: rgba(255,255,255,.45); width: 0; }
.cplayer-progress-played   { background: var(--primary); width: 0; }
.cplayer-progress-handle {
  position: absolute;
  top: 50%;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--primary);
  transform: translate(-50%, -50%);
  left: 0;
  opacity: 0;
  transition: opacity .15s;
}
.cplayer-progress:hover .cplayer-progress-handle,
.cplayer-progress.dragging .cplayer-progress-handle {
  opacity: 1;
}
/* Pakai progress bar lebih tinggi saat drag */
.cplayer-progress.dragging { height: 6px; }

/* Button row */
.cplayer-btnrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cplayer-btn {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 1rem;
  font-weight: 600;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  min-width: 40px;
  transition: background .15s;
}
.cplayer-btn:hover { background: rgba(255,255,255,.15); }
.cplayer-cc-btn.active { color: var(--primary); }
.cplayer-time {
  color: #fff;
  font-size: .82rem;
  font-variant-numeric: tabular-nums;
}
.cplayer-spacer { flex: 1; }

/* Popup menu (speed, cc) */
.cplayer-popup {
  position: absolute;
  bottom: 56px;
  right: 12px;
  background: rgba(0,0,0,.9);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 15;
  min-width: 140px;
}
.cplayer-popup-item {
  background: transparent;
  border: none;
  color: #fff;
  text-align: left;
  padding: 8px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: .85rem;
}
.cplayer-popup-item:hover  { background: rgba(255,255,255,.15); }
.cplayer-popup-item.active { background: var(--primary); }

/* Subtitle styling — pengganti default browser */
.cplayer-video::cue {
  background: rgba(0,0,0,.7);
  color: #fff;
  font-size: .9em;
  padding: 2px 6px;
  border-radius: 4px;
}

/* Desktop: progress bar lebih tinggi default */
@media (min-width: 768px) {
  .cplayer-progress { height: 5px; }
}
```

### DoD
- Player tampil dengan controls di bawah, latar gradient hitam.
- Tap di area video → controls hide. Tap lagi → controls show (logic-nya di Tahap 4, tapi struktur visual sudah benar).
- Progress bar terlihat di bawah, tombol di kanan.

---

## Tahap 4 — Frontend: Logic Player Inti (Play, Pause, Seek, Time)

### Tujuan
Bikin file baru `web/cplayer.js` (atau tambah di `app.js` di bagian player) yang handle interaksi dasar.

### Steps

1. Buat namespace untuk semua state player:
   ```js
   const cplayer = {
     video: null,
     dom: {},
     state: {
       isDragging: false,
       hideTimer: null,
       speed: 1.0,
       ccEnabled: false,
       lastTap: 0,
       lastTapX: 0,
     },
   };
   ```

2. Fungsi inisialisasi yang dipanggil sekali saat page load:
   ```js
   function initCplayer() {
     cplayer.video = $('player-video');
     cplayer.dom = {
       container: $('cplayer'),
       controls:  $('cplayer-controls'),
       playBtn:   $('cplayer-play'),
       centerPlay:$('cplayer-center-play'),
       time:      $('cplayer-time'),
       progress:  $('cplayer-progress'),
       buffered:  $('cplayer-progress-buffered'),
       played:    $('cplayer-progress-played'),
       handle:    $('cplayer-progress-handle'),
       speedBtn:  $('cplayer-speed'),
       speedMenu: $('cplayer-speed-menu'),
       fsBtn:     $('cplayer-fs'),
       ccBtn:     $('cplayer-cc'),
       ccMenu:    $('cplayer-cc-menu'),
       gesture:   $('cplayer-gesture'),
       gestureIcon: $('cplayer-gesture-icon'),
       gestureText: $('cplayer-gesture-text'),
       skipBack:  $('cplayer-skip-back'),
       skipFwd:   $('cplayer-skip-fwd'),
     };

     setupVideoEvents();
     setupControlEvents();
     setupGestureEvents();
     setupKeyboardShortcuts();
   }
   ```

3. Implementasi `setupVideoEvents()`:
   - `loadedmetadata` → update durasi total di `cplayer-time`.
   - `timeupdate` → update progress bar dan waktu (jangan saat dragging!).
   - `progress` → update buffered bar.
   - `play` → ubah ikon tombol jadi `⏸`, hide center-play.
   - `pause` → ubah ikon jadi `▶`, show center-play.
   - `ended` → show center-play dengan ikon replay.
   - `waiting` → tampilkan spinner.
   - `canplay` → hide spinner.

4. Format waktu:
   ```js
   function formatTime(seconds) {
     if (!isFinite(seconds)) return '0:00';
     const m = Math.floor(seconds / 60);
     const s = Math.floor(seconds % 60).toString().padStart(2, '0');
     const h = Math.floor(seconds / 3600);
     return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s}` : `${m}:${s}`;
   }
   ```

5. Implementasi `setupControlEvents()`:
   - Tap tombol play → toggle `video.play()` / `video.pause()`.
   - Tap center play → sama seperti play button.
   - Tap progress bar → seek ke posisi (`pointerdown` + `pointermove` + `pointerup`):
     ```js
     function onProgressDown(e) {
       cplayer.state.isDragging = true;
       cplayer.dom.progress.classList.add('dragging');
       seekToPointer(e);
     }
     function onProgressMove(e) {
       if (!cplayer.state.isDragging) return;
       seekToPointer(e);
     }
     function onProgressUp() {
       cplayer.state.isDragging = false;
       cplayer.dom.progress.classList.remove('dragging');
     }
     function seekToPointer(e) {
       const rect = cplayer.dom.progress.getBoundingClientRect();
       const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
       const ratio = Math.max(0, Math.min(1, x / rect.width));
       cplayer.video.currentTime = ratio * cplayer.video.duration;
       updateProgressUI();
     }
     ```
   - Tombol fullscreen → `cplayer.dom.container.requestFullscreen()` / `document.exitFullscreen()`.
   - Tombol speed → toggle `cplayer-speed-menu`. Klik item → set `video.playbackRate`, update text tombol.
   - Tap di luar menu → tutup menu.

### DoD
- Video play/pause via tombol bekerja.
- Progress bar update real-time saat playing.
- Drag progress bar bisa seek.
- Tombol fullscreen kerja.
- Tombol speed menampilkan menu, pilih kecepatan → video kecepatannya berubah.

---

## Tahap 5 — Frontend: Auto-Hide Controls + Tap Behavior

### Tujuan
Controls otomatis hilang setelah 3 detik tanpa interaksi. Tap pertama di video = show controls, tap saat controls show = hide.

### Steps

1. State `hideTimer` di state.
2. Fungsi `showControls()`:
   ```js
   function showControls() {
     cplayer.dom.container.classList.remove('hide-controls');
     resetHideTimer();
   }
   function hideControls() {
     // Hanya hide kalau video sedang play
     if (!cplayer.video.paused) {
       cplayer.dom.container.classList.add('hide-controls');
     }
   }
   function resetHideTimer() {
     clearTimeout(cplayer.state.hideTimer);
     cplayer.state.hideTimer = setTimeout(hideControls, 3000);
   }
   ```
3. Tap di area video (bukan di controls) toggle controls:
   ```js
   cplayer.video.addEventListener('click', (e) => {
     if (cplayer.dom.container.classList.contains('hide-controls')) {
       showControls();
     } else {
       hideControls();
     }
   });
   ```
4. Trigger `showControls()` saat: pointermove di container, video paused, drag progress.
5. Trigger `resetHideTimer()` setiap interaksi user (klik tombol, drag, dll).

### DoD
- Saat video playing, tunggu 3 detik tanpa interaksi → controls hilang dengan smooth transition.
- Tap lagi → controls muncul.
- Saat video paused, controls tetap visible.
- Drag progress bar → controls tetap visible selama dragging.

---

## Tahap 6 — Frontend: Gesture Mobile (Double-tap, Swipe Volume/Brightness)

### Tujuan
Gesture native ala YouTube/MX Player.

### Steps

1. **Double-tap kiri/kanan untuk skip ±10 detik:**
   ```js
   cplayer.video.addEventListener('click', (e) => {
     const now = Date.now();
     const rect = cplayer.dom.container.getBoundingClientRect();
     const x = e.clientX - rect.left;
     const isRight = x > rect.width / 2;

     if (now - cplayer.state.lastTap < 300 && Math.abs(x - cplayer.state.lastTapX) < 50) {
       // Double tap
       e.preventDefault();
       const skip = isRight ? 10 : -10;
       cplayer.video.currentTime = Math.max(0,
         Math.min(cplayer.video.duration, cplayer.video.currentTime + skip));
       showSkipIndicator(isRight);
       cplayer.state.lastTap = 0;
     } else {
       cplayer.state.lastTap = now;
       cplayer.state.lastTapX = x;
     }
   });

   function showSkipIndicator(isRight) {
     const el = isRight ? cplayer.dom.skipFwd : cplayer.dom.skipBack;
     el.classList.remove('hidden');
     // Animasi sudah di CSS, hide setelah selesai
     setTimeout(() => el.classList.add('hidden'), 600);
   }
   ```
   
   ⚠️ Hati-hati: jangan trigger toggle play/pause di tap kalau ini tap pertama dari double-tap. Logic-nya: simpan timer 300ms dari tap pertama, kalau dalam window tersebut ada tap kedua → cancel single-tap action.

2. **Swipe vertikal di sisi kiri = brightness, sisi kanan = volume:**
   ```js
   let touchStart = null;
   cplayer.dom.container.addEventListener('touchstart', (e) => {
     if (e.target.closest('.cplayer-controls')) return; // skip kalau di controls
     const t = e.touches[0];
     const rect = cplayer.dom.container.getBoundingClientRect();
     touchStart = {
       x: t.clientX, y: t.clientY,
       isRight: t.clientX - rect.left > rect.width / 2,
       startVol: cplayer.video.volume,
       startBright: getCurrentBrightness(), // pakai CSS filter
     };
   }, { passive: true });

   cplayer.dom.container.addEventListener('touchmove', (e) => {
     if (!touchStart) return;
     const t = e.touches[0];
     const dx = t.clientX - touchStart.x;
     const dy = touchStart.y - t.clientY; // swipe atas = positive
     // Hanya proses kalau swipe vertikal dominan
     if (Math.abs(dy) < Math.abs(dx)) return;
     const delta = dy / 200; // sensitivity
     if (touchStart.isRight) {
       const newVol = Math.max(0, Math.min(1, touchStart.startVol + delta));
       cplayer.video.volume = newVol;
       cplayer.video.muted = newVol === 0;
       showGesture('🔊', Math.round(newVol * 100) + '%');
     } else {
       const newBright = Math.max(.2, Math.min(1, touchStart.startBright + delta));
       setBrightness(newBright);
       showGesture('☀', Math.round(newBright * 100) + '%');
     }
   }, { passive: true });

   cplayer.dom.container.addEventListener('touchend', () => {
     touchStart = null;
     setTimeout(() => cplayer.dom.gesture.classList.add('hidden'), 500);
   }, { passive: true });

   function showGesture(icon, text) {
     cplayer.dom.gestureIcon.textContent = icon;
     cplayer.dom.gestureText.textContent = text;
     cplayer.dom.gesture.classList.remove('hidden');
   }
   ```

3. **Brightness via CSS filter** (kita tidak bisa kontrol screen brightness HP dari web, tapi bisa simulate via filter):
   ```js
   function getCurrentBrightness() {
     return parseFloat(cplayer.video.style.filter?.match(/brightness\(([\d.]+)\)/)?.[1] || 1);
   }
   function setBrightness(b) {
     cplayer.video.style.filter = `brightness(${b})`;
   }
   ```

### DoD
- Double-tap kanan → video skip +10 detik, indicator ⏩ muncul lalu fade.
- Double-tap kiri → skip -10 detik.
- Swipe atas-bawah di sisi kanan → volume berubah, indicator muncul.
- Swipe atas-bawah di sisi kiri → brightness video berubah (via CSS filter).
- Tap tunggal masih bisa toggle controls (tidak konflik dengan double-tap).

---

## Tahap 7 — Frontend: Subtitle Support

### Tujuan
Tampilkan subtitle SRT/VTT yang sudah di-konversi backend.

### Steps

1. Saat `openPlayer(item)` dipanggil, cek `item.has_subtitle`:
   ```js
   if (item.has_subtitle && item.streamable === 'video') {
     // Hapus track lama
     while (cplayer.video.firstChild) cplayer.video.removeChild(cplayer.video.firstChild);

     const track = document.createElement('track');
     track.kind = 'subtitles';
     track.label = 'Subtitle';
     track.srclang = 'id';
     track.default = true;
     track.src = '/api/subtitle?path=' + encodeURIComponent(filePathOf(item));
     cplayer.video.appendChild(track);

     // Tampilkan tombol CC
     cplayer.dom.ccBtn.classList.remove('hidden');
     cplayer.state.ccEnabled = true;
   } else {
     cplayer.dom.ccBtn.classList.add('hidden');
     cplayer.state.ccEnabled = false;
   }
   ```

2. Tombol CC toggle subtitle:
   ```js
   cplayer.dom.ccBtn.addEventListener('click', () => {
     const tracks = cplayer.video.textTracks;
     if (tracks.length === 0) return;
     cplayer.state.ccEnabled = !cplayer.state.ccEnabled;
     tracks[0].mode = cplayer.state.ccEnabled ? 'showing' : 'hidden';
     cplayer.dom.ccBtn.classList.toggle('active', cplayer.state.ccEnabled);
   });
   ```

3. Default mode subtitle saat load: pakai `mode = 'showing'` di event `loadedmetadata`:
   ```js
   cplayer.video.addEventListener('loadedmetadata', () => {
     if (cplayer.video.textTracks.length > 0) {
       cplayer.video.textTracks[0].mode = 'showing';
     }
   });
   ```

### DoD
- File `film.mp4` + `film.srt` di folder yang sama → tombol CC muncul.
- Subtitle tampil otomatis di bawah video.
- Tap CC → subtitle hide. Tap lagi → show.
- File tanpa subtitle → tombol CC tidak muncul.

---

## Tahap 8 — Frontend: Keyboard Shortcuts (Desktop)

### Tujuan
User di laptop browser bisa kontrol pakai keyboard.

### Steps

```js
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Hanya aktif saat player visible dan tidak fokus di input
    if ($('player-overlay').classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        cplayer.video.paused ? cplayer.video.play() : cplayer.video.pause();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        cplayer.video.currentTime = Math.max(0, cplayer.video.currentTime - 5);
        break;
      case 'ArrowRight':
        e.preventDefault();
        cplayer.video.currentTime = Math.min(cplayer.video.duration, cplayer.video.currentTime + 5);
        break;
      case 'ArrowUp':
        e.preventDefault();
        cplayer.video.volume = Math.min(1, cplayer.video.volume + .05);
        showGesture('🔊', Math.round(cplayer.video.volume * 100) + '%');
        break;
      case 'ArrowDown':
        e.preventDefault();
        cplayer.video.volume = Math.max(0, cplayer.video.volume - .05);
        showGesture('🔊', Math.round(cplayer.video.volume * 100) + '%');
        break;
      case 'f':
        e.preventDefault();
        document.fullscreenElement
          ? document.exitFullscreen()
          : cplayer.dom.container.requestFullscreen();
        break;
      case 'm':
        e.preventDefault();
        cplayer.video.muted = !cplayer.video.muted;
        break;
      case 'c':
        if (!cplayer.dom.ccBtn.classList.contains('hidden')) {
          cplayer.dom.ccBtn.click();
        }
        break;
    }
    showControls();
  });
}
```

### DoD
- Space/K → play/pause.
- Left/Right arrow → seek ±5 detik.
- Up/Down → volume.
- F → fullscreen.
- M → mute.
- C → toggle subtitle.

---

## Tahap 9 — Polish & Edge Cases

### Steps

1. **Restore filter brightness saat close player**: reset `video.style.filter` di `closePlayer()`.
2. **Cancel hideTimer saat close**: clear timer di `closePlayer()`.
3. **Saat fullscreen**, paksa controls visible kalau user gerakin pointer.
4. **Saat orientasi landscape mobile**, pastikan video fill screen tanpa cropping.
5. **Long-press progress bar** untuk preview frame (opsional, advanced).
6. **Remember preference**: simpan `playbackRate`, `volume`, `ccEnabled` di `localStorage` sehingga konsisten antar video.
7. **Buffer error handling**: kalau `video.error` set saat play, tampilkan `player-error` overlay.
8. **Update `closePlayer()`** untuk reset semua state custom player.

### DoD
- Reload halaman → setting volume/speed dari sebelumnya tetap dipakai.
- Putar video baru → playbackRate otomatis 1.0x kalau user belum pernah ganti.
- Close player → semua state reset, tidak ada timer leak.

---

## Tahap 10 — Update Dokumentasi

1. README: tambah subbab di bagian Streaming:
   ```markdown
   ### Custom Player Controls

   Player video LAN Hub punya kontrol custom seragam di semua browser:

   - **Tap** layar → toggle controls
   - **Double-tap kiri/kanan** → skip ±10 detik
   - **Swipe atas-bawah** sisi kanan → volume
   - **Swipe atas-bawah** sisi kiri → brightness
   - **Tombol speed** → 0.5x sampai 2.0x
   - **Tombol CC** → toggle subtitle (auto-detect file `.srt`/`.vtt` di folder yang sama)
   - **Tombol fullscreen** → masuk/keluar fullscreen

   #### Keyboard shortcuts (desktop):
   - `Space` / `K` — play/pause
   - `←` / `→` — seek ±5 detik
   - `↑` / `↓` — volume
   - `F` — fullscreen
   - `M` — mute
   - `C` — toggle subtitle

   #### Subtitle
   File subtitle dengan basename sama (mis. `film.srt` untuk `film.mp4`) otomatis terdeteksi.
   Format SRT akan dikonversi ke WebVTT secara otomatis.
   Untuk file dengan multiple bahasa, pakai `film.id.srt`, `film.en.srt`, dll.
   ```

2. Tambah note tentang subtitle di Troubleshooting:
   ```markdown
   ### Tombol CC tidak muncul padahal ada file subtitle
   - Pastikan nama subtitle sama dengan video (cuma beda ekstensi).
   - File subtitle harus `.srt` atau `.vtt`.
   - Refresh halaman setelah menambah subtitle baru.
   ```

### DoD
- README jelas menjelaskan semua gesture dan shortcut.

---

## Checklist Akhir Sebelum Dianggap Selesai

### Backend
- [ ] `internal/subtitle/subtitle.go` dengan `SRTToVTT`
- [ ] `subtitle_test.go` dengan test minimal
- [ ] `HandleSubtitle` endpoint di `handlers.go`
- [ ] Field `has_subtitle` di response `/api/files`

### Frontend Player
- [ ] HTML5 `<video>` tanpa atribut `controls`
- [ ] Custom controls: play/pause, progress, time, speed, fullscreen, CC
- [ ] Auto-hide controls 3 detik saat playing
- [ ] Tap toggle controls
- [ ] Double-tap kiri/kanan skip ±10s
- [ ] Swipe vertikal volume (kanan) & brightness (kiri)
- [ ] Speed menu (0.5x - 2.0x)
- [ ] Subtitle SRT/VTT support dengan toggle CC
- [ ] Keyboard shortcuts berfungsi di desktop
- [ ] Preferences disimpan di localStorage
- [ ] Reset state saat close player

### Dokumentasi
- [ ] README terupdate dengan gesture & shortcut

### Yang TIDAK boleh rusak
- [ ] Audio player tetap berfungsi (pakai `<audio controls>` lama, bukan custom)
- [ ] Tombol "Buka dengan App di HP" tetap berfungsi
- [ ] Open With laptop tetap berfungsi
- [ ] Download/Upload tetap berfungsi
- [ ] PIN auth tetap berfungsi

---

## Catatan untuk Implementer

- **Test wajib di HP nyata + landscape mode**. Browser desktop tidak bisa simulasi gesture touch dengan benar.
- **iOS Safari quirks**: 
  - `playsinline` WAJIB di video element. Tanpa ini, iOS otomatis maximize ke native player.
  - `volume` tidak bisa di-set programmatically di iOS Safari (dianggap user-controlled). Skip swipe volume di iOS atau tampilkan info "tidak didukung di iOS".
- **Audio player jangan diubah** — biarkan pakai `<audio controls>` default. Custom player ini fokus untuk video.
- **Subtitle SRT timing**: pastikan timestamp `00:00:01,500` (koma) jadi `00:00:01.500` (titik) — itu satu-satunya perbedaan format dengan VTT.
- **Performance**: jangan update DOM di setiap `timeupdate` (fires ~4x per detik). Pakai `requestAnimationFrame` atau throttle 250ms kalau perlu animasi smooth.
- **Aksesibilitas**: tetap pasang `aria-label` di setiap tombol custom — ini menggantikan label default browser yang hilang.
- **Pertahankan struktur file** yang sudah ada — tambah `cplayer.js` baru atau extend `app.js`, jangan rewrite besar-besaran.
- **Commit per tahap** dengan pesan jelas (`feat(player): tahap 1 backend subtitle`, dst).
- **Prioritas**: Tahap 2-5 wajib (struktur + controls dasar + auto-hide). Tahap 6-8 enhancement. Tahap 1 (subtitle) dan 9-10 paling akhir.
