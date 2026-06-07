# Rencana Implementasi: Auto-Fullscreen + Tombol Kembali pada Player

> Dokumen ini ditujukan untuk **junior programmer** atau **AI model yang lebih murah**.
> Ikuti tahapan secara berurutan. Setiap langkah menyebut **file** dan **nomor baris** acuan,
> plus **potongan kode** yang bisa dijadikan contoh. Baca dulu bagian "Konteks" agar paham
> kenapa kodenya ditulis seperti ini.

---

## Konteks (wajib dibaca dulu)

Frontend ini **vanilla JS** — tidak ada framework, tidak ada build tool. Tiga file yang relevan:

- `web/index.html` — struktur HTML player.
- `web/app.js` — logika membuka/menutup player, daftar file, riwayat.
- `web/cplayer.js` — logika custom video player (fullscreen, kontrol, subtitle).

**Cara kerja player sekarang (penting):**

1. User tap baris file → handler di `web/app.js:286` memanggil `playItem(item)` (`web/app.js:322`).
2. `playItem()` memanggil `openPlayer(item)` (`web/app.js:478`) → overlay player muncul, video mulai loading & play otomatis.
3. Header player (`web/index.html:210-220`) berisi 3 tombol: **`✕` Tutup** (`#player-close`), **Download**, dan **PiP** (`#player-pip`).
4. Tombol `✕` saat ini menjalankan `closePlayer()` + `history.back()` (`web/app.js:1111-1114`). **Inilah tombol "yang punya fitur escape"** yang akan kita ubah jadi tombol **Kembali (←)**.
5. Fullscreen dikerjakan oleh `toggleFullscreen()` (`web/cplayer.js:1217`) — masuk fullscreen pada elemen `.cplayer` lalu mengunci orientasi ke landscape (`lockLandscape()`).

**Catatan arsitektur yang HARUS dipahami:**

- Yang masuk fullscreen adalah elemen `.cplayer` (`#cplayer`), **bukan** seluruh overlay. Artinya saat fullscreen, **header (tombol ←) tidak terlihat**. Ini normal dan sesuai desain. User keluar fullscreen dulu (tekan back fisik / Escape / swipe) → header muncul kembali → baru tekan ← untuk balik ke daftar file. (Lihat Tahap 2 langkah 4.)
- `requestFullscreen()` **hanya boleh dipanggil saat ada "user gesture"** (mis. di dalam handler klik). Kalau dipanggil setelah `await` yang menunda eksekusi, browser akan menolak. Karena itu auto-fullscreen kita panggil **langsung di `playItem()`**, masih dalam rangkaian sinkron dari klik user.

---

## Tujuan

1. **Fitur A — Auto-Fullscreen:** saat user menekan file **video**, player langsung masuk **fullscreen + kunci landscape** tanpa perlu menekan tombol fullscreen. (Hanya video; audio tidak.)
2. **Fitur B — Tombol Kembali:** ubah tombol `✕` di header menjadi tombol **Kembali (←)**. Saat ditekan: keluar fullscreen (kalau sedang fullscreen) → tutup player → **kembali ke daftar file pada posisi scroll yang sama** seperti sebelum file video ditekan.

---

## TAHAP 1 — Fitur A: Auto-Fullscreen saat Video Ditekan

### Langkah 1.1 — Buat fungsi `enterFullscreen()` di `web/cplayer.js`

Saat ini logika "masuk fullscreen" tercampur di dalam `toggleFullscreen()` (`web/cplayer.js:1217`). Kita pisahkan jadi fungsi sendiri agar bisa dipanggil ulang dari auto-fullscreen.

Tambahkan fungsi baru ini **tepat di atas** `toggleFullscreen()` (sekitar `web/cplayer.js:1216`):

```js
// Masuk fullscreen (idempotent): kalau sudah fullscreen / sedang transisi, tidak melakukan apa-apa.
// Dipanggil oleh tombol FS DAN oleh auto-fullscreen saat video dibuka.
async function enterFullscreen() {
  if (!cplayer.dom.container) return;
  if (document.fullscreenElement) return;   // sudah fullscreen → jangan dobel
  if (cplayer.state.fsTransition) return;    // sedang transisi → abaikan

  // Kalau sedang mode CSS-rotate, matikan dulu (fullscreen + screen lock akan urus rotasi).
  if (cplayer.state.cssRotated) toggleCssRotate();

  cplayer.state.fsTransition = true;
  try {
    await cplayer.dom.container.requestFullscreen();
    await lockLandscape();   // kunci orientasi SETELAH fullscreen aktif
  } catch (_) {
    // Diabaikan: iOS Safari tidak mendukung fullscreen pada <div>, atau user batal.
  } finally {
    cplayer.state.fsTransition = false;
  }
}
```

### Langkah 1.2 — Buat `toggleFullscreen()` memakai `enterFullscreen()` (refactor opsional tapi disarankan)

Agar tidak ada dua salinan logika yang bisa "drift", ubah cabang **enter** di `toggleFullscreen()` (`web/cplayer.js:1229-1245`) supaya memanggil `enterFullscreen()`.

Cari blok ini di dalam `toggleFullscreen()`:

```js
  } else {
    // Kalau sedang CSS rotate, matikan dulu — fullscreen + screen lock akan handle rotasi.
    if (cplayer.state.cssRotated) {
      toggleCssRotate();
    }
    // Enter: set flag dulu agar klik ganda tidak memicu requestFullscreen kedua.
    cplayer.state.fsTransition = true;
    try {
      await cplayer.dom.container.requestFullscreen();
      await lockLandscape();
    } catch (_) { /* abaikan — user mungkin cancel atau browser tidak support */ }
    finally {
      cplayer.state.fsTransition = false;
    }

    // Hint untuk iOS Safari ...
    if (IS_IOS && !sessionStorage.getItem('cp_rotateHint')) {
      ...
    }
  }
```

Ganti seluruh isi cabang `else` menjadi:

```js
  } else {
    await enterFullscreen();

    // Hint untuk iOS Safari yang tidak support screen.orientation.lock.
    if (IS_IOS && !sessionStorage.getItem('cp_rotateHint')) {
      sessionStorage.setItem('cp_rotateHint', '1');
      showToastFromPlayer('💡 Putar HP ke samping untuk landscape');
    }
  }
```

> Kalau ragu melakukan refactor ini, **boleh dilewati** — `enterFullscreen()` (Langkah 1.1) sudah cukup untuk auto-fullscreen. Tapi refactor ini mencegah bug ganda di masa depan.

### Langkah 1.3 — Panggil `enterFullscreen()` saat user tap video di `web/app.js`

Buka `playItem()` di `web/app.js:322`. Saat ini bagian akhirnya:

```js
  }
  openPlayer(item); // #9: pre-flight terpusat di playItem()
}
```

Ubah menjadi:

```js
  }
  openPlayer(item); // #9: pre-flight terpusat di playItem()

  // AUTO-FULLSCREEN: hanya untuk video, dipicu langsung dari tap user (user gesture masih aktif).
  // Audio tidak di-fullscreen-kan. iOS akan gagal diam-diam (di-catch di enterFullscreen).
  if (item.streamable === 'video' && typeof enterFullscreen === 'function') {
    enterFullscreen();
  }
}
```

**Kenapa di sini, bukan di dalam `openPlayer()`?**
`openPlayer()` juga dipanggil dari riwayat (`openPlayerFromHistory`) dan antrian next/prev — beberapa tanpa user gesture yang valid. Dengan menaruh di `playItem()` (entry-point dari tap baris), kita pastikan `requestFullscreen()` selalu dijalankan dalam konteks gesture user, sehingga tidak ditolak browser.

**Penting:** jangan menaruh `await` apa pun **sebelum** baris `enterFullscreen()` di jalur ini, karena akan menghilangkan "user activation" dan fullscreen jadi ditolak. `openPlayer()` bersifat sinkron (fetch di dalamnya `fire-and-forget`), jadi aman.

### Hasil yang diharapkan Tahap 1

- Tap file video di HP Android (Chrome) → langsung fullscreen + landscape, video mulai play.
- Tap file audio → player muncul normal, **tidak** fullscreen.
- iOS Safari → tidak fullscreen otomatis (keterbatasan platform; tidak error, tidak crash).

---

## TAHAP 2 — Fitur B: Ubah Tombol `✕` menjadi Tombol Kembali (←)

> Catatan: di codebase **tidak ada** fungsi bernama `minimize`. Tombol "yang punya fitur escape"
> adalah tombol `✕` (`#player-close`) yang sekarang menutup player. Kita ubah tampilan +
> perilakunya menjadi tombol **Kembali**. (Kalau ternyata yang dimaksud adalah tombol **PiP `⧉`**,
> lihat **Catatan Opsional** di akhir dokumen.)

### Langkah 2.1 — Ganti ikon `✕` menjadi panah kembali `←` di `web/index.html`

Cari baris `web/index.html:211`:

```html
<button id="player-close" class="icon-btn player-close-btn" aria-label="Tutup player">✕</button>
```

Ganti menjadi (ikon panah kiri + label "Kembali"):

```html
<button id="player-close" class="icon-btn player-close-btn" aria-label="Kembali" title="Kembali">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
  </svg>
</button>
```

> `id="player-close"` **JANGAN diubah** — banyak kode JS lain merujuk id ini. Kita hanya ganti isi/ikon dan label.

### Langkah 2.2 — Pastikan player keluar fullscreen saat ditutup (`web/app.js`)

Buka `closePlayer()` di `web/app.js:695`. Tambahkan exit-fullscreen di **baris paling awal** fungsi:

```js
function closePlayer() {
  // Keluar fullscreen dulu kalau sedang fullscreen (mis. ditutup saat masih fullscreen).
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  // Sync history sebelum tutup player
  if (typeof syncHistoryNow === 'function') syncHistoryNow();
  ...
```

Dengan ini, semua jalur penutup (tombol ←, Escape, tombol back fisik HP) otomatis keluar fullscreen — tidak perlu menduplikasi logika di tiap handler.

### Langkah 2.3 — Simpan posisi scroll saat membuka player (`web/app.js`)

Agar bisa "kembali ke tempat sebelum file video ditekan", kita catat posisi scroll **sebelum** player dibuka.

Buka `openPlayer()` di `web/app.js:478`. Di **baris paling awal** fungsi, tambahkan:

```js
function openPlayer(item) {
  // Simpan posisi scroll daftar file agar bisa dikembalikan saat user menekan Kembali.
  state.scrollBeforePlayer = window.scrollY;

  state.currentPlayerItem = item;
  ...
```

> `state` adalah objek global yang sudah dipakai di banyak tempat (mis. `state.currentPlayerItem`, `state.allItems`). Kita cukup menambah satu properti baru `scrollBeforePlayer`. Tidak perlu deklarasi khusus.

### Langkah 2.4 — Kembalikan posisi scroll saat player ditutup (`web/app.js`)

Masih di `web/app.js`, di bagian akhir `closePlayer()` (`web/app.js:712-715`):

```js
  // Refresh history cache dan re-render file list agar progress bar up-to-date
  loadHistoryCache().then(() => {
    if (state.allItems.length > 0) renderFiles(state.allItems);
  });
}
```

Ubah menjadi:

```js
  // Refresh history cache dan re-render file list agar progress bar up-to-date
  loadHistoryCache().then(() => {
    if (state.allItems.length > 0) renderFiles(state.allItems);
    // Kembalikan scroll ke posisi sebelum video dibuka (setelah daftar di-render ulang).
    if (typeof state.scrollBeforePlayer === 'number') {
      window.scrollTo(0, state.scrollBeforePlayer);
    }
  });
}
```

> `renderFiles()` membangun ulang daftar dan bisa mereset scroll ke atas. Karena itu kita panggil `window.scrollTo()` **setelah** `renderFiles()`, di dalam `.then()`.

### Langkah 2.5 — (Tidak perlu diubah) Handler tombol Kembali

Handler tombol `#player-close` di `web/app.js:1111-1114` **sudah benar** dan tidak perlu diubah:

```js
$('player-close').addEventListener('click', () => {
  closePlayer();
  if (history.state && history.state.player) history.back();
});
```

Karena exit-fullscreen sudah dipindah ke dalam `closePlayer()` (Langkah 2.2) dan restore-scroll sudah di dalam `closePlayer()` (Langkah 2.4), tombol ini otomatis: keluar fullscreen → tutup → balik ke daftar pada posisi scroll semula.

> Tombol back fisik HP (`popstate`, `web/app.js:1171`) dan Escape (`web/app.js:1188`) juga sudah memanggil `closePlayer()`, jadi keduanya ikut mendapat perilaku baru ini tanpa perubahan tambahan.

### Catatan UX fullscreen (jelaskan ke tester)

Karena yang fullscreen adalah `.cplayer` (bukan header), saat **sedang fullscreen** tombol ← di header **tidak terlihat**. Alur normal di HP:

1. Tap video → fullscreen landscape.
2. Tekan **back fisik HP** / **Escape** / **swipe** sekali → keluar fullscreen (browser default). Header dengan tombol ← muncul kembali.
3. Tekan **←** → tutup player, balik ke daftar file pada posisi semula.

Ini perilaku standar aplikasi video di mobile dan **bukan bug**.

---

## Ringkasan File yang Disentuh

| File | Perubahan |
|------|-----------|
| `web/cplayer.js` | Tambah fungsi `enterFullscreen()` (1.1); refactor `toggleFullscreen()` memakainya (1.2, opsional). |
| `web/app.js` | Panggil `enterFullscreen()` di `playItem()` untuk video (1.3); exit-fullscreen di awal `closePlayer()` (2.2); simpan `state.scrollBeforePlayer` di `openPlayer()` (2.3); restore scroll di `closePlayer()` (2.4). |
| `web/index.html` | Ganti ikon `✕` → panah `←`, label "Kembali" (2.1). |

Tidak ada perubahan backend (Go). Tidak ada perubahan CSS yang wajib (ikon SVG memakai `currentColor`, mengikuti style tombol header yang ada).

---

## Test Plan (centang setelah dites di browser nyata, bukan hanya baca kode)

**Fitur A — Auto-Fullscreen:**
- [ ] HP Android (Chrome): tap file **video** → langsung fullscreen + orientasi landscape, video play.
- [ ] Tap file **audio** → player muncul normal, TIDAK fullscreen.
- [ ] Desktop: tap video → masuk fullscreen (orientasi tidak relevan di desktop).
- [ ] iOS Safari: tap video → tidak error/crash (boleh tidak fullscreen — keterbatasan platform).
- [ ] Tap video yang butuh transcode (mkv) → tetap auto-fullscreen, tidak ada error console.

**Fitur B — Tombol Kembali:**
- [ ] Header menampilkan ikon panah `←` (bukan `✕`), `aria-label`/`title` = "Kembali".
- [ ] Scroll daftar file ke bawah → tap video di tengah daftar → tonton → keluar fullscreen → tekan `←` → kembali ke daftar **pada posisi scroll yang sama**.
- [ ] Tekan `←` saat masih fullscreen (mis. desktop) → keluar fullscreen DAN tutup player dalam satu aksi.
- [ ] Tombol **back fisik HP** menutup player dan mengembalikan posisi scroll.
- [ ] Tombol **Escape** (desktop) menutup player dan mengembalikan posisi scroll.
- [ ] Buka video dari **riwayat (history)** lalu tekan `←` → tidak error (scroll restore boleh ke atas jika berasal dari konteks berbeda).
- [ ] Progress bar / watch history tetap ter-update setelah kembali (regresi `closePlayer()`).

**Static check sebelum commit:**
- [ ] `gofmt -l .` dan `go vet ./...` bersih (memastikan tidak ada file Go yang tak sengaja berubah).
- [ ] Tidak ada error di console browser saat buka/tutup player berkali-kali.

---

## Catatan Opsional (kalau "minimize" yang dimaksud adalah tombol PiP `⧉`)

Kalau ternyata maksud "hapus minimize" adalah menghapus tombol **Picture-in-Picture** (`#player-pip`, `⧉`, `web/index.html:219`), bukan tombol `✕`:

1. Hapus elemen `<button id="player-pip" ...>` di `web/index.html:219`.
2. Hapus handler PiP di `web/app.js:1157-1168` dan referensi `playerPip` di `web/app.js:472, 504, 564, 566-571`.
3. Lalu jadikan tombol `✕` sebagai tombol Kembali sesuai Tahap 2.

**Konfirmasikan dulu ke pemilik task** sebelum mengerjakan opsi ini, karena menghilangkan PiP juga menghilangkan fitur "tonton sambil buka app lain".
