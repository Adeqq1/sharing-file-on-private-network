## Code Review — feat(player): subtitle size control

Fitur dan pendekatannya bagus: pakai satu CSS variable `--cp-sub-scale` lalu membungkus semua `font-size` dengan `calc()` adalah cara yang bersih dan otomatis ikut ke semua breakpoint. Persist ke `localStorage` juga sudah benar. Tapi ada **satu bug penting** dan beberapa hal yang bisa diimprove.

### 🔴 Bug — nilai scale di submenu tidak cocok dengan label & default

Ada dua "sumber kebenaran" yang berbeda:

```js
// cplayer.js:415  — dipakai untuk label di menu utama
const SUB_SIZE_LABELS = { 0.8: 'Kecil', 1: 'Normal', 1.25: 'Besar', 1.5: 'Sangat Besar' };

// cplayer.js:510  — opsi yang benar-benar muncul di submenu
const options = [
  { scale: 1.5, label: 'Kecil' },
  { scale: 2,   label: 'Normal' },
  { scale: 3,   label: 'Besar' },
  { scale: 4,   label: 'Sangat Besar' },
];
```

Akibatnya:

1. **Default tidak pernah ter-highlight.** `subScale` default = `1`, tapi `1` bukan salah satu opsi submenu → tidak ada item ber-`active` saat pertama dibuka.
2. **"Normal" malah memperbesar 2×.** Memilih "Normal" menyetel `scale = 2`, kebalikan dari maksudnya (dan PR description bilang Normal = `1×`).
3. **Label di menu utama salah.** `SUB_SIZE_LABELS[subScale]` di-lookup pakai nilai `2/3/4` yang tidak ada di map → jatuh ke fallback `'Normal'`, jadi "Besar" dan "Sangat Besar" pun tampil sebagai "Normal".
4. Faktor sampai `4×` digabung dengan base mobile-fullscreen `0.56rem` bikin ukuran jadi sulit diprediksi antar-breakpoint.

**Fix:** samakan nilai submenu dengan `SUB_SIZE_LABELS` (`0.8 / 1 / 1.25 / 1.5`), sesuai PR description.

### 🟡 Improvement — hilangkan duplikasi (single source of truth)

`SUB_SIZE_LABELS` dan array `options` mengkode mapping yang sama. Karena keduanya terpisah, mereka sudah keburu divergen (itu akar bug di atas). Cukup turunkan submenu dari satu map:

```js
function showSubSizeSubmenu() {
  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item popup-back" data-action="back">‹ Ukuran Subtitle</button>
    ${Object.entries(SUB_SIZE_LABELS).map(([scale, label]) => `
      <button class="cplayer-popup-item ${parseFloat(scale) === cplayer.state.subScale ? 'active' : ''}"
              data-subscale="${scale}">${label}</button>
    `).join('')}
  `;
  // ...listener sama seperti sekarang
}
```

Dengan begitu menambah/mengubah ukuran cukup di satu tempat dan label utama + active-state selalu konsisten.

### 🟢 Catatan kecil (opsional)
- `setSubtitleScale` sebaiknya memvalidasi `scale` terhadap key yang dikenal sebelum disimpan, supaya nilai aneh dari localStorage (mis. dari versi lama) tidak ikut terpakai. Saat ini sudah ada guard `isFinite()` di restore — cukup, tapi belum mengikat ke set nilai yang valid.
- Penanganan `.is-fullscreen` lewat event `fullscreenchange` + reset di `resetCplayer()` sudah rapi 👍

Selain bug nilai scale di atas, sisanya solid.
