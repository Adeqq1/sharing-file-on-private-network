'use strict';

// ===== Custom Player (cplayer) — YouTube-like =====
// Menggantikan HTML5 <video controls> dengan UI custom konsisten antar browser.

const cplayer = {
  video: null,
  dom: {},
  state: {
    isDragging: false,
    hideTimer: null,
    speed: 1,
    ccEnabled: false,
    currentLang: '',         // kode bahasa subtitle yang aktif
    currentSubIdx: -1,       // index entry subtitle yang aktif di availableSubs
    availableSubs: [],       // daftar subtitle dari /api/subtitles (termasuk embedded)
    lastTap: 0,
    lastTapX: 0,
    touchStart: null,
    gestureTimer: null,
    currentItem: null,
    currentPath: '',         // path file video saat ini (untuk resume)
    queueItems: [],          // daftar video di folder yang sama
    queueIndex: -1,
    rafId: null,
    fsTransition: false,     // flag anti race-condition: true saat requestFullscreen sedang pending
    cssRotated: false,       // flag CSS rotate mode (putar player 90° tanpa fullscreen API)
    subScale: 2,             // pengali ukuran subtitle (1.5 / 2 / 3 / 4)
    // ── Seek support untuk video transcode ──
    transcodeOffset: 0,      // detik offset saat ini untuk video transcode (0 = dari awal)
    totalDuration: 0,        // durasi penuh video dari /api/probe (untuk display & seek)
    isTranscoded: false,     // true kalau continuous /api/transcode (?t= seek)
    isHLS: false,            // true kalau /api/hls — timeline absolut, seek native
    hls: null,               // instance hls.js aktif
    _hlsFallbackTried: false, // one-shot continuous fallback after fatal HLS
    pendingSeek: null,       // detik tujuan saat seek sedang dalam proses (untuk debounce)
    // ── Burn-in subtitle (PGS) ──
    burnSubIndex: -1,        // stream index PGS yang sedang di-burn-in (-1 = tidak ada)
    _subtitleBlobUrl: null,  // Blob URL subtitle aktif (untuk revoke saat ganti/close)
    _subtitleRawVtt: null,   // teks VTT absolut (untuk shift saat continuous seek)
    _activeTextTrack: null,  // text track aktif untuk sinkronisasi subtitle overlay
    _cueChangeHandler: null, // handler cuechange aktif agar bisa dicabut saat ganti track
    iosNativeFullscreen: false,
  },
  abort: null, // AbortController untuk listener per-video
};

// ── Konstanta seek ───────────────────────────────────────────────────────────
const SEEK_DEBOUNCE_MS  = 250; // ms tunggu setelah drag sebelum spawn ffmpeg
const RESUME_MIN_SEC    = 5;   // posisi tersimpan < 5 detik diabaikan
const RESUME_MARGIN_SEC = 10;  // posisi tersimpan < (durasi - 10s) agar tidak loop di akhir
// Detect iOS — volume tidak bisa diset programmatically
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// ===== Inisialisasi =====

function initCplayer() {
  cplayer.video = document.getElementById('player-video');
  cplayer.dom = {
    container:    document.getElementById('cplayer'),
    controls:     document.getElementById('cplayer-controls'),
    playBtn:      document.getElementById('cplayer-play'),
    centerPlay:   document.getElementById('cplayer-center-play'),
    time:         document.getElementById('cplayer-time'),
    progress:     document.getElementById('cplayer-progress'),
    buffered:     document.getElementById('cplayer-progress-buffered'),
    played:       document.getElementById('cplayer-progress-played'),
    handle:       document.getElementById('cplayer-progress-handle'),
    hoverTime:    document.getElementById('cplayer-hover-time'),
    muteBtn:      document.getElementById('cplayer-mute'),
    volSlider:    document.getElementById('cplayer-volume'),
    settingsBtn:  document.getElementById('cplayer-settings'),
    settingsMenu: document.getElementById('cplayer-settings-menu'),
    speedSubmenu: document.getElementById('cplayer-speed-submenu'),
    ccSubmenu:    document.getElementById('cplayer-cc-submenu'),
    fsBtn:        document.getElementById('cplayer-fs'),
    rotateBtn:    document.getElementById('cplayer-rotate'),
    prevBtn:      document.getElementById('cplayer-prev'),
    nextBtn:      document.getElementById('cplayer-next'),
    gesture:      document.getElementById('cplayer-gesture'),
    gestureIcon:  document.getElementById('cplayer-gesture-icon'),
    gestureText:  document.getElementById('cplayer-gesture-text'),
    skipBack:     document.getElementById('cplayer-skip-back'),
    skipFwd:      document.getElementById('cplayer-skip-fwd'),
    rippleLeft:   document.getElementById('cplayer-ripple-left'),
    rippleRight:  document.getElementById('cplayer-ripple-right'),
    spinner:      document.getElementById('player-spinner'),
    subtitle:     document.getElementById('cplayer-subtitle-overlay'),
  };

  // Restore preferences dari localStorage
  const savedVol      = parseFloat(localStorage.getItem('cp_volume')    || '1');
  const savedSpeed    = parseFloat(localStorage.getItem('cp_speed')     || '1');
  const savedSubScale = parseFloat(localStorage.getItem('cp_sub_scale') || '2');
  cplayer.video.volume    = isFinite(savedVol)      ? clampVolume(savedVol) : 1;
  cplayer.state.speed     = isFinite(savedSpeed)    ? savedSpeed    : 1;
  cplayer.state.subScale  = isFinite(savedSubScale) ? savedSubScale : 2;
  cplayer.video.playbackRate = cplayer.state.speed;
  updateSpeedLabel();
  updateVolumeUI();
  applySubtitleScale();

  // iOS: sembunyikan volume slider (tidak bisa diset programmatically)
  if (IS_IOS && cplayer.dom.volSlider) {
    cplayer.dom.volSlider.style.display = 'none';
    if (cplayer.dom.muteBtn) cplayer.dom.muteBtn.style.display = 'none';
  }

  setupVideoEvents();
  setupControlEvents();
  setupGestureEvents();
  setupKeyboardShortcuts();
}

// ===== Video Events =====

function setupVideoEvents() {
  const v = cplayer.video;

  v.addEventListener('loadedmetadata', () => {
    updateTimeUI();
    const path = cplayer.state.currentPath;
    if (!path) return;

    // HLS: resume lewat startPosition di attachHLSSource — jangan double-seek
    if (cplayer.state.isHLS) return;

    if (cplayer.state.transcodeOffset > 0) return;
    if (cplayer.state.pendingSeek != null) return;

    _tryResume(savedResumePosition(path));
  });

  // Pakai requestAnimationFrame untuk update progress (poin #22)
  let lastSyncTime = 0;
  v.addEventListener('timeupdate', () => {
    if (cplayer.state.isDragging) return;
    cancelAnimationFrame(cplayer.state.rafId);
    cplayer.state.rafId = requestAnimationFrame(updateProgressUI);

    const path = cplayer.state.currentPath;
    if (!path) return;

    // Save resume position throttled (tiap 5 detik)
    const cur = effectiveCurrentTime();
    if (Math.floor(v.currentTime) % 5 === 0) {
      localStorage.setItem('cp_pos_' + path, cur);
    }

    // Server sync tiap 10 detik
    const nowMs = Date.now();
    if (nowMs - lastSyncTime > 10000) {
      lastSyncTime = nowMs;
      fetch('/api/history/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          position_sec: cur,
          duration_sec: effectiveDuration() || 0,
        }),
      }).catch(() => { /* sync best-effort */ });
    }
  });

  // syncHistoryNow: flush posisi ke server segera (saat pause/ended/close)
  function syncHistoryNow() {
    const path = cplayer.state.currentPath;
    if (!path) return;
    const body = JSON.stringify({
      path,
      position_sec: effectiveCurrentTime(),
      duration_sec: effectiveDuration() || 0,
    });
    // sendBeacon dengan Blob agar Content-Type = application/json (bukan text/plain default)
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/history/update', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/history/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }
  // Expose ke app.js
  window.syncHistoryNow = syncHistoryNow;

  v.addEventListener('progress', updateBufferedUI);

  v.addEventListener('volumechange', () => {
    if (!IS_IOS) localStorage.setItem('cp_volume', v.volume.toFixed(2));
    updateVolumeUI();
  });

  v.addEventListener('play', () => {
    setPlayIcon(false);
    if (cplayer.dom.centerPlay) cplayer.dom.centerPlay.classList.add('hidden');
    resetHideTimer();
  });

  v.addEventListener('pause', () => {
    setPlayIcon(true);
    if (cplayer.dom.centerPlay) cplayer.dom.centerPlay.classList.remove('hidden');
    showControls();
    syncHistoryNow();
  });

  v.addEventListener('ended', () => {
    syncHistoryNow();
    // Hapus saved position kalau sudah selesai
    if (cplayer.state.currentPath) {
      localStorage.removeItem('cp_pos_' + cplayer.state.currentPath);
    }
    // Auto-play next jika ada queue (poin #19)
    if (cplayer.state.queueIndex >= 0 &&
        cplayer.state.queueIndex < cplayer.state.queueItems.length - 1) {
      playNextInQueue();
    } else {
      setPlayIcon(true, true);
      if (cplayer.dom.centerPlay) {
        cplayer.dom.centerPlay.innerHTML = svgIcon('replay');
        cplayer.dom.centerPlay.classList.remove('hidden');
      }
      showControls();
    }
  });

  v.addEventListener('waiting', () => {
    if (cplayer.dom.spinner) cplayer.dom.spinner.classList.remove('hidden');
  });
  v.addEventListener('canplay', () => {
    if (cplayer.dom.spinner) cplayer.dom.spinner.classList.add('hidden');
  });

  // Fullscreen change → update ikon + unlock orientasi saat exit
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenIcon();
    showControls();
    // Saat keluar fullscreen (via Escape, back button HP, swipe, dll),
    // pastikan orientasi di-unlock agar HP bisa rotate normal kembali.
    if (document.fullscreenElement) {
      if (cplayer.dom.container) cplayer.dom.container.classList.add('is-fullscreen');
    } else {
      unlockOrientation();
      if (cplayer.dom.container) cplayer.dom.container.classList.remove('is-fullscreen');

      // FIX: Jika keluar fullscreen BUKAN karena user menekan tombol FS player,
      // (misalnya karena hardware back button HP atau Escape), langsung tutup player.
      if (!cplayer.state.fsToggleClicked && typeof closePlayer === 'function') {
        const overlay = document.getElementById('player-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          closePlayer();
          if (history.state && history.state.player) history.back();
        }
      }
    }
    
    // Selalu reset flag setelah event tertangani
    cplayer.state.fsToggleClicked = false;
  });

  // iPhone/iOS Safari memakai native fullscreen player di luar DOM overlay kita.
  // Saat fullscreen native aktif, fallback ke subtitle native agar subtitle tetap muncul.
  v.addEventListener('webkitbeginfullscreen', () => {
    cplayer.state.iosNativeFullscreen = true;
    syncSubtitlePresentation();
  });
  v.addEventListener('webkitendfullscreen', () => {
    cplayer.state.iosNativeFullscreen = false;
    syncSubtitlePresentation();
  });
}

// ===== Control Events =====

function setupControlEvents() {
  const v = cplayer.video;

  // Play/Pause
  if (cplayer.dom.playBtn) {
    cplayer.dom.playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
      showControls();
    });
  }
  if (cplayer.dom.centerPlay) {
    cplayer.dom.centerPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (v.ended) v.currentTime = 0;
      togglePlayPause();
      showControls();
    });
  }

  // Mute button
  if (cplayer.dom.muteBtn) {
    cplayer.dom.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      v.muted = !v.muted;
      showControls();
    });
  }

  // Volume slider
  if (cplayer.dom.volSlider) {
    cplayer.dom.volSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) / 100;
      v.volume = val;
      v.muted = val === 0;
      showControls();
    });
    // Cegah click bubble agar tidak toggle play/pause
    cplayer.dom.volSlider.addEventListener('click', (e) => e.stopPropagation());
  }

  // Progress bar — pointer events
  if (cplayer.dom.progress) {
    cplayer.dom.progress.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      cplayer.state.isDragging = true;
      cplayer.dom.progress.classList.add('dragging');
      cplayer.dom.progress.setPointerCapture(e.pointerId);
      seekToPointer(e);
      showControls();
    });
    cplayer.dom.progress.addEventListener('pointermove', (e) => {
      // Hover preview waktu (poin #9)
      updateHoverTime(e);
      if (cplayer.state.isDragging) seekToPointer(e);
    });
    cplayer.dom.progress.addEventListener('pointerup', () => {
      cplayer.state.isDragging = false;
      cplayer.dom.progress.classList.remove('dragging');
      // Flush seek segera saat user lepas mouse/jari — skip sisa debounce
      // agar seek terasa responsif (tidak perlu tunggu 250ms lagi).
      if (cplayer.state.pendingSeek != null && cplayer.state.isTranscoded) {
        clearTimeout(_seekDebounceTimer);
        _flushTranscodeSeek();
      }
      resetHideTimer();
    });
    cplayer.dom.progress.addEventListener('pointerleave', () => {
      if (cplayer.dom.hoverTime) cplayer.dom.hoverTime.classList.add('hidden');
    });
    cplayer.dom.progress.addEventListener('pointerenter', () => {
      if (cplayer.dom.hoverTime) cplayer.dom.hoverTime.classList.remove('hidden');
    });
    cplayer.dom.progress.addEventListener('pointercancel', () => {
      cplayer.state.isDragging = false;
      cplayer.dom.progress.classList.remove('dragging');
    });
  }

  // Fullscreen
  if (cplayer.dom.fsBtn) {
    cplayer.dom.fsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
  }

  // Rotate layar (CSS-based, tanpa fullscreen API — bekerja di semua browser)
  if (cplayer.dom.rotateBtn) {
    cplayer.dom.rotateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCssRotate();
    });
  }

  // Settings (gear) — toggle main menu
  if (cplayer.dom.settingsBtn && cplayer.dom.settingsMenu) {
    cplayer.dom.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = cplayer.dom.settingsMenu.classList.contains('hidden');
      closeAllPopups();
      if (isHidden) {
        showMainSettingsMenu();
        cplayer.dom.settingsMenu.classList.remove('hidden');
      }
      showControls();
      pauseHideTimer();
    });
  }

  // Prev/Next queue (poin #19)
  if (cplayer.dom.prevBtn) {
    cplayer.dom.prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevInQueue();
    });
  }
  if (cplayer.dom.nextBtn) {
    cplayer.dom.nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextInQueue();
    });
  }

  // Klik di luar popup → tutup
  document.addEventListener('click', (e) => {
    if (e.target.closest('#cplayer-settings-menu') ||
        e.target.closest('#cplayer-settings')) return;
    closeAllPopups();
  });

  // Pointer move di container → show controls
  if (cplayer.dom.container) {
    cplayer.dom.container.addEventListener('pointermove', () => {
      showControls();
    });
  }
}

// ===== Settings Menu (gear icon) =====

const SUB_SIZE_LABELS = { 1.5: 'Kecil', 2: 'Normal', 3: 'Besar', 4: 'Sangat Besar' };

function showMainSettingsMenu() {
  if (!cplayer.dom.settingsMenu) return;
  const speedLabel = cplayer.state.speed === 1 ? 'Normal' : cplayer.state.speed + 'x';
  const subLabel = cplayer.state.ccEnabled
    ? (cplayer.state.availableSubs.find(s => s.lang === cplayer.state.currentLang)?.label || 'On')
    : 'Off';
  const subSizeLabel = SUB_SIZE_LABELS[cplayer.state.subScale] || 'Normal';

  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item" data-action="show-speed">
      <span>Kecepatan</span>
      <span class="popup-value">${speedLabel} ›</span>
    </button>
    <button class="cplayer-popup-item" data-action="show-cc">
      <span>Subtitle</span>
      <span class="popup-value">${subLabel} ›</span>
    </button>
    <button class="cplayer-popup-item" data-action="show-subsize">
      <span>Ukuran Subtitle</span>
      <span class="popup-value">${subSizeLabel} ›</span>
    </button>
  `;

  // Pasang listener
  cplayer.dom.settingsMenu.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'show-speed') showSpeedSubmenu();
      else if (action === 'show-cc') showSubSubmenu();
      else if (action === 'show-subsize') showSubSizeSubmenu();
    });
  });
}

function showSpeedSubmenu() {
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item popup-back" data-action="back">‹ Kecepatan</button>
    ${speeds.map(s => `
      <button class="cplayer-popup-item ${s === cplayer.state.speed ? 'active' : ''}"
              data-speed="${s}">
        ${s === 1 ? 'Normal' : s + 'x'}
      </button>
    `).join('')}
  `;
  cplayer.dom.settingsMenu.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSpeed(parseFloat(btn.dataset.speed));
      closeAllPopups();
    });
  });
  cplayer.dom.settingsMenu.querySelector('[data-action="back"]')
    .addEventListener('click', (e) => { e.stopPropagation(); showMainSettingsMenu(); });
}

function showSubSubmenu() {
  const subs = cplayer.state.availableSubs;
  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item popup-back" data-action="back">‹ Subtitle</button>
    <button class="cplayer-popup-item ${!cplayer.state.ccEnabled ? 'active' : ''}" data-lang="__off">Off</button>
    ${subs.map((s, idx) => `
      <button class="cplayer-popup-item ${cplayer.state.ccEnabled && cplayer.state.currentLang === s.lang && cplayer.state.currentSubIdx === idx ? 'active' : ''}"
              data-sub-idx="${idx}">
        ${s.label}
      </button>
    `).join('')}
  `;
  cplayer.dom.settingsMenu.querySelectorAll('[data-sub-idx]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.subIdx);
      const entry = cplayer.state.availableSubs[idx];
      if (entry) {
        cplayer.state.currentSubIdx = idx;
        switchSubtitleEntry(entry);
      }
      closeAllPopups();
    });
  });
  cplayer.dom.settingsMenu.querySelectorAll('[data-lang="__off"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCC(false);
      closeAllPopups();
    });
  });
  cplayer.dom.settingsMenu.querySelector('[data-action="back"]')
    .addEventListener('click', (e) => { e.stopPropagation(); showMainSettingsMenu(); });
}

function showSubSizeSubmenu() {
  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item popup-back" data-action="back">‹ Ukuran Subtitle</button>
    ${Object.entries(SUB_SIZE_LABELS).map(([scale, label]) => `
      <button class="cplayer-popup-item ${parseFloat(scale) === cplayer.state.subScale ? 'active' : ''}"
              data-subscale="${scale}">
        ${label}
      </button>
    `).join('')}
  `;
  cplayer.dom.settingsMenu.querySelectorAll('[data-subscale]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setSubtitleScale(parseFloat(btn.dataset.subscale));
      closeAllPopups();
    });
  });
  cplayer.dom.settingsMenu.querySelector('[data-action="back"]')
    .addEventListener('click', (e) => { e.stopPropagation(); showMainSettingsMenu(); });
}

// ===== Auto-hide Controls =====

function showControls() {
  if (!cplayer.dom.container) return;
  cplayer.dom.container.classList.remove('hide-controls');
  resetHideTimer();
}

function hideControls() {
  if (!cplayer.video || !cplayer.dom.container) return;
  if (!cplayer.video.paused && !cplayer.state.isDragging &&
      cplayer.dom.settingsMenu.classList.contains('hidden')) {
    cplayer.dom.container.classList.add('hide-controls');
  }
}

function resetHideTimer() {
  clearTimeout(cplayer.state.hideTimer);
  cplayer.state.hideTimer = setTimeout(hideControls, 3000);
}

function pauseHideTimer() {
  clearTimeout(cplayer.state.hideTimer);
}

// ===== Gesture Mobile =====
// FIX poin #1: HAPUS lag 300ms — tap langsung toggle, double-tap detect via timing.

function setupGestureEvents() {
  if (!cplayer.dom.container) return;
  const v = cplayer.video;

  // Tap di video → toggle controls/play (responsif tanpa delay)
  // Double-tap di sisi kiri/kanan → skip ±10s
  v.addEventListener('click', (e) => {
    const now = Date.now();
    const rect = cplayer.dom.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isRight = x > rect.width / 2;

    const isDoubleTap = (now - cplayer.state.lastTap < 300) &&
                       (Math.abs(x - cplayer.state.lastTapX) < 80);

    if (isDoubleTap) {
      // Double-tap: skip
      cplayer.state.lastTap = 0;
      const skip = isRight ? 10 : -10;
      seekRelative(skip);
      showSkipIndicator(isRight);
      showRipple(isRight, e.clientX - rect.left, e.clientY - rect.top);
      showControls();
    } else {
      // Single-tap: TANPA delay (fix poin #1).
      // Behavior YouTube-style:
      //   - Mobile (touch): toggle controls
      //   - Desktop (mouse): toggle play/pause
      cplayer.state.lastTap = now;
      cplayer.state.lastTapX = x;

      if (e.pointerType === 'mouse' || (e.pointerType === undefined && !('ontouchstart' in window))) {
        togglePlayPause();
      } else {
        if (cplayer.dom.container.classList.contains('hide-controls')) {
          showControls();
        } else {
          hideControls();
        }
      }
    }
  });

  // Swipe vertikal — fix poin #2: skip volume swipe di iOS
  cplayer.dom.container.addEventListener('touchstart', (e) => {
    if (e.target.closest('.cplayer-controls') ||
        e.target.closest('.cplayer-popup')) return;
    const t = e.touches[0];
    const rect = cplayer.dom.container.getBoundingClientRect();
    cplayer.state.touchStart = {
      x: t.clientX,
      y: t.clientY,
      isRight: (t.clientX - rect.left) > rect.width / 2,
      startVol: cplayer.video.volume,
      startBright: getCurrentBrightness(),
    };
  }, { passive: true });

  cplayer.dom.container.addEventListener('touchmove', (e) => {
    if (!cplayer.state.touchStart) return;
    const t = e.touches[0];
    const dx = t.clientX - cplayer.state.touchStart.x;
    const dy = cplayer.state.touchStart.y - t.clientY;
    if (Math.abs(dy) < Math.abs(dx) || Math.abs(dy) < 10) return;

    const delta = dy / 200;
    if (cplayer.state.touchStart.isRight) {
      // Volume — skip di iOS (read-only, fix poin #2)
      if (IS_IOS) {
        showGesture('🔊', 'Atur volume di tombol HP');
        return;
      }
      const newVol = clampVolume(cplayer.state.touchStart.startVol + delta);
      cplayer.video.volume = newVol;
      cplayer.video.muted = newVol === 0;
      showGesture(newVol === 0 ? '🔇' : '🔊', Math.round(newVol * 100) + '%');
    } else {
      // Brightness via CSS filter
      const newBright = Math.max(0.2, Math.min(1, cplayer.state.touchStart.startBright + delta));
      setBrightness(newBright);
      showGesture('☀', Math.round(newBright * 100) + '%');
    }
  }, { passive: true });

  cplayer.dom.container.addEventListener('touchend', () => {
    cplayer.state.touchStart = null;
    clearTimeout(cplayer.state.gestureTimer);
    cplayer.state.gestureTimer = setTimeout(() => {
      if (cplayer.dom.gesture) cplayer.dom.gesture.classList.add('hidden');
    }, 600);
  }, { passive: true });
}

// Ripple animation untuk double-tap (poin #15)
function showRipple(isRight, x, y) {
  const el = isRight ? cplayer.dom.rippleRight : cplayer.dom.rippleLeft;
  if (!el) return;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 600);
}

function showSkipIndicator(isRight) {
  const el = isRight ? cplayer.dom.skipFwd : cplayer.dom.skipBack;
  if (!el) return;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = '';
  setTimeout(() => el.classList.add('hidden'), 650);
}

function showGesture(icon, text) {
  if (!cplayer.dom.gesture) return;
  cplayer.dom.gestureIcon.textContent = icon;
  cplayer.dom.gestureText.textContent = text;
  cplayer.dom.gesture.classList.remove('hidden');
}

function getCurrentBrightness() {
  const filter = cplayer.video.style.filter || '';
  const match = filter.match(/brightness\(([\d.]+)\)/);
  return match ? parseFloat(match[1]) : 1;
}

function setBrightness(b) {
  cplayer.video.style.filter = `brightness(${b.toFixed(2)})`;
}

// ===== Subtitle (multi-language) — fix poin #5, #6 =====

async function setupSubtitle(item, filePathFn) {
  console.log('[sub] setupSubtitle dipanggil', { name: item.name, streamable: item.streamable });
  if (!cplayer.video) {
    console.warn('[sub] cplayer.video null, batal');
    return;
  }

  // Hapus track lama
  cplayer.video.querySelectorAll('track').forEach(t => t.remove());
  detachSubtitleOverlayTrack();
  hideSubtitleOverlay();
  cplayer.state.availableSubs = [];
  cplayer.state.currentLang = '';

  if (item.streamable !== 'video') {
    cplayer.state.ccEnabled = false;
    return;
  }

  // Fetch list subtitle dari backend (gabungan external + embedded)
  try {
    const path = filePathFn(item);
    console.log('[sub] fetch /api/subtitles untuk', path);
    const res = await fetch('/api/subtitles?path=' + encodeURIComponent(path));
    console.log('[sub] /api/subtitles status', res.status);
    const subs = await res.json();
    console.log('[sub] subs found:', subs);
    if (Array.isArray(subs) && subs.length > 0) {
      // Simpan semua field termasuk source, track, dan image untuk embedded
      cplayer.state.availableSubs = subs;

      // Pilih default: prioritaskan text-based 'id' external, lalu 'en', lalu yang pertama text-based
      // Jangan auto-aktifkan PGS/image-based — terlalu berat dan butuh reload video
      const textBased = subs.filter(s => !s.image);
      console.log('[sub] textBased count:', textBased.length, '— image-based count:', subs.length - textBased.length);
      const preferred =
        textBased.find(s => s.lang === 'id' && s.source === 'external') ||
        textBased.find(s => s.lang === 'en' && s.source === 'external') ||
        textBased.find(s => s.lang === 'id') ||
        textBased.find(s => s.lang === 'en') ||
        textBased[0];
      console.log('[sub] preferred:', preferred);

      if (preferred) {
        switchSubtitleEntry(preferred);
      } else if (subs.some(s => s.image)) {
        // Hanya ada PGS — kasih hint, jangan auto-burn (mahal)
        console.warn('[sub] hanya ada PGS, butuh burn-in manual');
        showToastFromPlayer('💬 Subtitle tersedia (image-based). Aktifkan dari menu CC.');
      }
    } else {
      console.warn('[sub] tidak ada subtitle untuk file ini');
    }
  } catch (err) {
    console.error('[sub] error fetch /api/subtitles:', err);
    // Fallback ke single subtitle (lama)
    cplayer.state.availableSubs = [{ lang: '', label: 'Default', source: 'external' }];
    switchSubtitleEntry(cplayer.state.availableSubs[0]);
  }
}

// switchSubtitle dipanggil dari menu CC dengan lang string (backward compat)
function switchSubtitle(lang) {
  const entry = cplayer.state.availableSubs.find(s => s.lang === lang);
  if (entry) {
    switchSubtitleEntry(entry);
  } else {
    // Fallback: buat entry minimal
    switchSubtitleEntry({ lang, label: lang || 'Default', source: 'external' });
  }
}

// switchSubtitleEntry menangani pemilihan subtitle berdasarkan entry lengkap
// (termasuk field source, track, dan image untuk embedded subtitle).
function switchSubtitleEntry(entry) {
  console.log('[sub] switchSubtitleEntry:', entry);
  if (!cplayer.video) {
    console.warn('[sub] no video, abort');
    return;
  }
  if (!cplayer.state.currentItem) {
    console.warn('[sub] no currentItem, abort');
    return;
  }

  // Hapus track lama (fix poin #6)
  cplayer.video.querySelectorAll('track').forEach(t => t.remove());
  detachSubtitleOverlayTrack();
  hideSubtitleOverlay();
  // Cabut Blob URL lama agar tidak memory leak
  if (cplayer.state._subtitleBlobUrl) {
    URL.revokeObjectURL(cplayer.state._subtitleBlobUrl);
    cplayer.state._subtitleBlobUrl = null;
  }

  const path = cplayer.state.currentPath;

  // Image-based (PGS/VobSub) → burn-in via continuous /api/transcode
  if (entry.image && entry.track !== undefined) {
    console.log('[sub] image-based → burn-in transcode, track:', entry.track);
    showToastFromPlayer('🎨 Memuat ulang dengan subtitle ditanam ke video...');
    const curPos = effectiveCurrentTime();
    const t = Math.max(0, Math.floor(curPos));
    cplayer.state.currentLang = entry.lang || '';
    cplayer.state.ccEnabled = true;
    cplayer.state.burnSubIndex = entry.track;
    cplayer.state.isHLS = false;
    cplayer.state.isTranscoded = true;
    cplayer.state.transcodeOffset = t;
    destroyHLS();
    const params = new URLSearchParams({ path, t: String(t), burnSub: String(entry.track) });
    const url = '/api/transcode?' + params.toString();
    const wasPaused = cplayer.video.paused;
    cplayer.video.src = url;
    cplayer.video.load();
    if (!wasPaused) {
      cplayer.video.addEventListener('canplay', () => cplayer.video.play().catch(() => {}), { once: true });
    }
    return;
  }

  // KASUS NORMAL: subtitle text-based (external .srt/.vtt atau embedded ASS/SRT).
  // Gunakan fetch() + Blob URL, bukan <track src="..."> langsung.
  //
  // Alasan: pada mobile browser (iOS Safari / Android Chrome), <track> yang
  // di-append ke <video> yang belum punya src, atau yang mode-nya 'disabled',
  // tidak akan di-fetch sama sekali. Blob URL menghindari masalah ini karena
  // data sudah ada di memori — browser tidak perlu fetch lagi saat mode di-set.
  const apiUrl = '/api/subtitle?path=' + encodeURIComponent(path) +
                 (entry.lang ? '&lang=' + encodeURIComponent(entry.lang) : '');
  console.log('[sub] fetch subtitle:', apiUrl);

  cplayer.state.currentLang = entry.lang || '';
  cplayer.state.ccEnabled = true;

  fetch(apiUrl)
    .then(res => {
      console.log('[sub] /api/subtitle status:', res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(rawVtt => {
      if (!cplayer.video || cplayer.state.currentPath !== path) return;
      cplayer.state._subtitleRawVtt = rawVtt;
      attachShiftedSubtitleTrack(entry, rawVtt);
      showToastFromPlayer('💬 Subtitle: ' + (entry.label || entry.lang || 'Default'));
    })
    .catch(err => {
      console.error('[sub] fetch subtitle gagal:', err);
      showToastFromPlayer('⚠ Subtitle gagal dimuat: ' + (err.message || 'error'));
    });
}

// parseVttTime: "HH:MM:SS.mmm" or "MM:SS.mmm" → seconds
function parseVttTime(s) {
  const p = String(s).trim().split(':');
  if (p.length === 3) {
    return (+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2]);
  }
  if (p.length === 2) {
    return (+p[0]) * 60 + parseFloat(p[1]);
  }
  return parseFloat(s) || 0;
}

function formatVttTime(sec) {
  if (sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec - h * 3600 - m * 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(whole, 2)}.${pad(ms, 3)}`;
}

// shiftVttText: absolute VTT → stream-relative (subtract offset after continuous ?t= seek).
// Cues that end before offset are dropped; start clamped to 0.
function shiftVttText(raw, offsetSec) {
  const off = Number(offsetSec) || 0;
  if (!raw || off <= 0.05) return raw;
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  const tsRe = /^(\d{1,2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}\.\d{3}|\d{1,2}:\d{2}\.\d{3})(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(tsRe);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    let start = parseVttTime(m[1]) - off;
    let end = parseVttTime(m[2]) - off;
    if (end <= 0) {
      // skip cue + following text lines until blank
      while (i + 1 < lines.length && lines[i + 1].trim() !== '') i++;
      continue;
    }
    if (start < 0) start = 0;
    out.push(formatVttTime(start) + ' --> ' + formatVttTime(end) + (m[3] || ''));
  }
  return out.join('\n');
}

// attachShiftedSubtitleTrack: build Blob URL from absolute VTT shifted by transcodeOffset.
function attachShiftedSubtitleTrack(entry, rawVtt) {
  if (!cplayer.video || !rawVtt) return;
  const offset = (cplayer.state.isTranscoded && !cplayer.state.isHLS)
    ? (cplayer.state.transcodeOffset || 0)
    : 0;
  const shifted = shiftVttText(rawVtt, offset);
  if (cplayer.state._subtitleBlobUrl) {
    URL.revokeObjectURL(cplayer.state._subtitleBlobUrl);
    cplayer.state._subtitleBlobUrl = null;
  }
  detachSubtitleOverlayTrack();
  hideSubtitleOverlay();
  cplayer.video.querySelectorAll('track').forEach(t => t.remove());

  const blob = new Blob([shifted], { type: 'text/vtt' });
  const blobUrl = URL.createObjectURL(blob);
  cplayer.state._subtitleBlobUrl = blobUrl;

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = (entry && entry.label) || 'Subtitle';
  track.srclang = (entry && entry.lang) || 'und';
  track.src = blobUrl;
  track.default = true;
  cplayer.video.appendChild(track);

  const tt = cplayer.video.textTracks[cplayer.video.textTracks.length - 1];
  if (tt) {
    tt.mode = 'hidden';
    attachSubtitleOverlayTrack(tt);
  }
}

function toggleCC(forceState) {
  const newState = (forceState !== undefined) ? forceState : !cplayer.state.ccEnabled;

  // Burn-in Off → reload continuous without burnSub
  if (!newState && cplayer.state.burnSubIndex >= 0 && (cplayer.state.isHLS || cplayer.state.isTranscoded)) {
    const path = cplayer.state.currentPath;
    if (path) {
      showToastFromPlayer('🔄 Memuat ulang tanpa subtitle...');
      const t = Math.max(0, Math.floor(effectiveCurrentTime()));
      cplayer.state.burnSubIndex = -1;
      cplayer.state.ccEnabled = false;
      cplayer.state.isHLS = false;
      cplayer.state.isTranscoded = true;
      cplayer.state.transcodeOffset = t;
      destroyHLS();
      const params = new URLSearchParams({ path, t: String(t) });
      const url = '/api/transcode?' + params.toString();
      const wasPaused = cplayer.video.paused;
      cplayer.video.src = url;
      cplayer.video.load();
      if (!wasPaused) {
        cplayer.video.addEventListener('canplay', () => cplayer.video.play().catch(() => {}), { once: true });
      }
      return;
    }
  }

  // Normal: toggle HTML5 textTrack
  const tracks = cplayer.video.textTracks;
  if (!tracks || tracks.length === 0) {
    cplayer.state.ccEnabled = newState;
    hideSubtitleOverlay();
    return;
  }
  cplayer.state.ccEnabled = newState;
  syncSubtitlePresentation();
}

function cueTextToHTML(text) {
  const template = document.createElement('template');
  template.innerHTML = String(text || '');

  const allowed = new Set(['B', 'I', 'U', 'BR']);
  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createDocumentFragment();
    }

    const tag = node.tagName.toUpperCase();
    if (!allowed.has(tag)) {
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(child => frag.appendChild(sanitizeNode(child)));
      return frag;
    }

    const el = document.createElement(tag.toLowerCase());
    node.childNodes.forEach(child => el.appendChild(sanitizeNode(child)));
    return el;
  };

  const out = document.createElement('div');
  template.content.childNodes.forEach(node => out.appendChild(sanitizeNode(node)));
  return out.innerHTML.replace(/\n/g, '<br>');
}

function hideSubtitleOverlay() {
  if (!cplayer.dom.subtitle) return;
  cplayer.dom.subtitle.innerHTML = '';
  cplayer.dom.subtitle.classList.add('hidden');
}

function activeSubtitleTrack() {
  const tracks = cplayer.video?.textTracks;
  if (!tracks || tracks.length === 0) return null;
  return tracks[tracks.length - 1];
}

function syncSubtitlePresentation() {
  const track = activeSubtitleTrack();
  if (!track) {
    hideSubtitleOverlay();
    return;
  }

  if (!cplayer.state.ccEnabled) {
    track.mode = 'hidden';
    hideSubtitleOverlay();
    return;
  }

  if (cplayer.state.iosNativeFullscreen) {
    track.mode = 'showing';
    hideSubtitleOverlay();
    return;
  }

  track.mode = 'hidden';
  renderActiveCueOverlay();
}

function renderActiveCueOverlay() {
  if (!cplayer.dom.subtitle) return;
  if (!cplayer.state.ccEnabled || !cplayer.state._activeTextTrack) {
    hideSubtitleOverlay();
    return;
  }

  const activeCues = cplayer.state._activeTextTrack.activeCues;
  if (!activeCues || activeCues.length === 0) {
    hideSubtitleOverlay();
    return;
  }

  const lines = [];
  for (let i = 0; i < activeCues.length; i++) {
    const cue = activeCues[i];
    const text = typeof cue.text === 'string' ? cue.text.trim() : '';
    if (text) lines.push(cueTextToHTML(text));
  }

  if (lines.length === 0) {
    hideSubtitleOverlay();
    return;
  }

  cplayer.dom.subtitle.innerHTML = lines.join('<br>');
  cplayer.dom.subtitle.classList.remove('hidden');
}

function detachSubtitleOverlayTrack() {
  const track = cplayer.state._activeTextTrack;
  const handler = cplayer.state._cueChangeHandler;
  if (track && handler) {
    try {
      track.removeEventListener('cuechange', handler);
    } catch (_) {
      // ignore - some browsers use EventTarget without strict remove semantics
    }
  }
  cplayer.state._activeTextTrack = null;
  cplayer.state._cueChangeHandler = null;
}

function attachSubtitleOverlayTrack(track) {
  if (!track) return;
  detachSubtitleOverlayTrack();
  const handler = () => renderActiveCueOverlay();
  cplayer.state._activeTextTrack = track;
  cplayer.state._cueChangeHandler = handler;
  track.addEventListener('cuechange', handler);
  syncSubtitlePresentation();
}

// ===== Keyboard Shortcuts =====

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const playerOverlay = document.getElementById('player-overlay');
    if (!playerOverlay || playerOverlay.classList.contains('hidden')) return;
    // Skip kalau fokus di input/textarea/range slider
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const v = cplayer.video;

    // Number 0-9: jump ke percentage video (poin #16)
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

    switch (e.key) {
      case ' ': case 'k':
        e.preventDefault();
        togglePlayPause();
        showControls();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        seekRelative(-5);
        showControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        seekRelative(5);
        showControls();
        break;
      case 'j':
        e.preventDefault();
        seekRelative(-10);
        showControls();
        break;
      case 'l':
        e.preventDefault();
        seekRelative(10);
        showControls();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!IS_IOS) {
          v.volume = clampVolume(v.volume + 0.05);
          showGesture('🔊', Math.round(v.volume * 100) + '%');
        }
        showControls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (!IS_IOS) {
          v.volume = clampVolume(v.volume - 0.05);
          showGesture('🔊', Math.round(v.volume * 100) + '%');
        }
        showControls();
        break;
      case 'f':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'm':
        e.preventDefault();
        v.muted = !v.muted;
        showGesture(v.muted ? '🔇' : '🔊',
          v.muted ? 'Mute' : Math.round(v.volume * 100) + '%');
        showControls();
        break;
      case 'c':
        if (cplayer.state.availableSubs.length > 0) {
          toggleCC();
          showControls();
        }
        break;
      // Frame seeking — hanya untuk video native (transcode terlalu mahal per-frame)
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
    }
  });
}

// ===== Helpers =====

// ===== Orientation Lock (auto-landscape saat fullscreen di HP) =====

// Deteksi apakah device support orientation lock.
// Hanya true di HP/tablet dengan touch input — desktop selalu false.
function canLockOrientation() {
  try {
    return (
      typeof screen !== 'undefined' &&
      screen.orientation != null &&
      typeof screen.orientation.lock === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    );
  } catch (_) {
    return false;
  }
}

// Lock ke landscape — hanya boleh dipanggil saat fullscreen sudah aktif.
// Kalau gagal (desktop, iOS, user denied), fullscreen tetap jalan normal.
async function lockLandscape() {
  if (!canLockOrientation()) return;
  try {
    await screen.orientation.lock('landscape');
  } catch (err) {
    // Banyak browser lempar error walaupun API ada (mis. desktop, atau user denied).
    // Tidak masalah — fullscreen tetap jalan, hanya orientasi tidak ter-lock.
    console.debug('orientation lock gagal:', err.message);
  }
}

// Lepas lock orientasi — no-op kalau tidak support atau sudah unlock.
function unlockOrientation() {
  try {
    if (
      typeof screen !== 'undefined' &&
      screen.orientation != null &&
      typeof screen.orientation.unlock === 'function'
    ) {
      screen.orientation.unlock();
    }
  } catch (_) {
    // ignore — beberapa browser lempar error saat unlock tanpa lock sebelumnya
  }
}

function togglePlayPause() {
  if (!cplayer.video) return;
  if (cplayer.video.paused || cplayer.video.ended) {
    if (cplayer.video.ended) cplayer.video.currentTime = 0;
    cplayer.video.play().catch(() => {});
  } else {
    cplayer.video.pause();
  }
}

// Toggle CSS rotate — putar player 90° tanpa fullscreen API.
// Bekerja di semua browser termasuk iOS Safari.
// Saat masuk fullscreen, rotate mode di-reset agar tidak konflik.
function toggleCssRotate() {
  if (!cplayer.dom.container) return;

  cplayer.state.cssRotated = !cplayer.state.cssRotated;
  cplayer.dom.container.classList.toggle('css-rotated', cplayer.state.cssRotated);
  document.body.classList.toggle('cp-rotated-active', cplayer.state.cssRotated);

  // Update tombol: menyala saat aktif
  if (cplayer.dom.rotateBtn) {
    cplayer.dom.rotateBtn.classList.toggle('active', cplayer.state.cssRotated);
    cplayer.dom.rotateBtn.setAttribute(
      'aria-label',
      cplayer.state.cssRotated ? 'Kembali tegak' : 'Putar layar'
    );
    cplayer.dom.rotateBtn.title = cplayer.state.cssRotated ? 'Kembali tegak' : 'Putar layar';
  }

  showControls();
}

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

// Refactor ke async/await agar konsisten — tidak ada double-wrap Promise.
// Flag fsTransition mencegah race condition saat user double-tap tombol
// fullscreen sebelum requestFullscreen() selesai (review 1.1 + 1.4).
async function toggleFullscreen() {
  if (!cplayer.dom.container) return;

  // Guard: abaikan klik berikutnya selama transisi fullscreen sedang berjalan.
  if (cplayer.state.fsTransition) return;

  if (document.fullscreenElement) {
    // Exit: unlock orientasi dulu, lalu keluar fullscreen.
    unlockOrientation();
    try {
      await document.exitFullscreen();
    } catch (_) { /* abaikan — browser mungkin sudah keluar fullscreen */ }
  } else {
    await enterFullscreen();

    // Hint untuk iOS Safari yang tidak support screen.orientation.lock.
    // Tampilkan sekali per session agar tidak mengganggu.
    if (IS_IOS && !sessionStorage.getItem('cp_rotateHint')) {
      sessionStorage.setItem('cp_rotateHint', '1');
      showToastFromPlayer('💡 Putar HP ke samping untuk landscape');
    }
  }
}

function setSpeed(speed) {
  cplayer.state.speed = speed;
  cplayer.video.playbackRate = speed;
  localStorage.setItem('cp_speed', speed);
  updateSpeedLabel();
}

function applySubtitleScale() {
  if (!cplayer.dom.container) return;
  cplayer.dom.container.style.setProperty('--cp-sub-scale', cplayer.state.subScale);
}

function setSubtitleScale(scale) {
  cplayer.state.subScale = scale;
  localStorage.setItem('cp_sub_scale', scale);
  applySubtitleScale();
}

function updateSpeedLabel() {
  if (!cplayer.dom.settingsBtn) return;
  // Settings button selalu menampilkan ⚙ saja, label di dalam menu
}

function closeAllPopups() {
  if (cplayer.dom.settingsMenu) cplayer.dom.settingsMenu.classList.add('hidden');
  resetHideTimer();
}

function clampVolume(v) {
  return Math.max(0, Math.min(1, v));
}

function seekToPointer(e) {
  if (!cplayer.dom.progress || !cplayer.video) return;
  const rect = cplayer.dom.progress.getBoundingClientRect();
  const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

  const fullDur = effectiveDuration();
  if (!isFinite(fullDur) || fullDur <= 0) return;
  const targetTime = ratio * fullDur;

  if (cplayer.state.isTranscoded && !cplayer.state.isHLS) {
    // Continuous fMP4: reload src dengan ?t=...
    requestTranscodeSeek(targetTime);
  } else {
    // Native / HLS: timeline absolut
    cplayer.video.currentTime = targetTime;
  }
  updateProgressUI();
}

// ── Seek helpers untuk video transcode ──────────────────────────────────────

// effectiveDuration: durasi penuh untuk display.
// Transcode continuous / HLS: totalDuration dari probe; native: video.duration.
function effectiveDuration() {
  if ((cplayer.state.isTranscoded || cplayer.state.isHLS) && cplayer.state.totalDuration > 0) {
    return cplayer.state.totalDuration;
  }
  return cplayer.video?.duration ?? 0;
}

// effectiveCurrentTime: posisi absolut (offset hanya untuk continuous ?t= path).
function effectiveCurrentTime() {
  const native = cplayer.video?.currentTime ?? 0;
  if (cplayer.state.isTranscoded && !cplayer.state.isHLS) {
    return cplayer.state.transcodeOffset + native;
  }
  return native;
}

// seekRelative: skip ±N detik.
function seekRelative(deltaSec) {
  const cur = effectiveCurrentTime();
  const target = Math.max(0, Math.min(effectiveDuration() || 0, cur + deltaSec));
  if (cplayer.state.isTranscoded && !cplayer.state.isHLS) {
    requestTranscodeSeek(target);
  } else if (cplayer.video) {
    cplayer.video.currentTime = target;
  }
}

// Debounce timer untuk requestTranscodeSeek — file scope agar bisa di-clear di resetCplayer.
let _seekDebounceTimer = null;

// requestTranscodeSeek: reload <video>.src dengan offset baru.
// Pakai debounce SEEK_DEBOUNCE_MS agar drag progress bar tidak spawn banyak request ffmpeg.
// Spinner ditampilkan di dalam setTimeout (bukan di luar) agar tidak stuck
// kalau seek dibatalkan sebelum debounce habis.
function requestTranscodeSeek(targetSec) {
  cplayer.state.pendingSeek = targetSec;
  clearTimeout(_seekDebounceTimer);
  _seekDebounceTimer = setTimeout(() => _flushTranscodeSeek(), SEEK_DEBOUNCE_MS);
}

// _flushTranscodeSeek: eksekusi seek segera (dipanggil dari debounce atau pointerup).
function _flushTranscodeSeek() {
  const path = cplayer.state.currentPath;
  if (!path || cplayer.state.pendingSeek == null) return;

  const t = Math.max(0, Math.floor(cplayer.state.pendingSeek));
  cplayer.state.pendingSeek = null;

  // Skip only if already near absolute position (not just same offset)
  const curAbs = effectiveCurrentTime();
  if (Math.abs(t - curAbs) < 1 && cplayer.video && !cplayer.video.ended) {
    return;
  }

  if (cplayer.dom.spinner) cplayer.dom.spinner.classList.remove('hidden');

  cplayer.state.transcodeOffset = t;

  const params = { path, t };
  if (cplayer.state.burnSubIndex >= 0) {
    params.burnSub = cplayer.state.burnSubIndex;
  }
  const url = '/api/transcode?' + new URLSearchParams(params).toString();
  const v = cplayer.video;
  const wasPaused = v.paused;

  const activeSubEntry = cplayer.state.availableSubs[cplayer.state.currentSubIdx];
  const rawVtt = cplayer.state._subtitleRawVtt;
  const ccWasEnabled = cplayer.state.ccEnabled && cplayer.state.burnSubIndex < 0 && rawVtt;

  if (cplayer.state._subtitleBlobUrl) {
    URL.revokeObjectURL(cplayer.state._subtitleBlobUrl);
    cplayer.state._subtitleBlobUrl = null;
  }
  detachSubtitleOverlayTrack();
  hideSubtitleOverlay();
  v.querySelectorAll('track').forEach(tr => tr.remove());

  v.src = url;
  v.load();

  // Re-attach shifted subtitles (absolute VTT − offset) after stream ready
  if (ccWasEnabled && activeSubEntry) {
    v.addEventListener('canplay', () => {
      if (!cplayer.video || cplayer.state.currentPath !== path) return;
      if (cplayer.dom.spinner) cplayer.dom.spinner.classList.add('hidden');
      attachShiftedSubtitleTrack(activeSubEntry, rawVtt);
    }, { once: true });
  }

  if (!wasPaused) {
    v.addEventListener('canplay', () => {
      if (cplayer.dom.spinner) cplayer.dom.spinner.classList.add('hidden');
      v.play().catch(() => {});
    }, { once: true });
  } else {
    v.addEventListener('canplay', () => {
      if (cplayer.dom.spinner) cplayer.dom.spinner.classList.add('hidden');
    }, { once: true });
  }
}

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

function updateBufferedUI() {
  if (!cplayer.video || !cplayer.dom.buffered) return;
  const dur = effectiveDuration();
  if (!isFinite(dur) || dur === 0) return;
  const buf = cplayer.video.buffered;
  if (buf.length > 0) {
    // Continuous ?t= only: buffered relative to offset. HLS/native: absolute.
    const offset = (cplayer.state.isTranscoded && !cplayer.state.isHLS) ? (cplayer.state.transcodeOffset || 0) : 0;
    const bufferedEnd = buf.end(buf.length - 1) + offset;
    const pct = Math.min(100, (bufferedEnd / dur) * 100);
    cplayer.dom.buffered.style.width = pct + '%';
  }
}

function updateTimeUI() {
  if (!cplayer.dom.time || !cplayer.video) return;
  const cur = formatTime(effectiveCurrentTime());
  const dur = formatTime(effectiveDuration());
  cplayer.dom.time.textContent = cur + ' / ' + dur;
}

function updateVolumeUI() {
  if (cplayer.dom.volSlider && !IS_IOS) {
    cplayer.dom.volSlider.value = Math.round(cplayer.video.volume * 100);
  }
  if (cplayer.dom.muteBtn) {
    let icon;
    if (cplayer.video.muted || cplayer.video.volume === 0) {
      icon = svgIcon('volumeMute');
    } else if (cplayer.video.volume < 0.5) {
      icon = svgIcon('volumeLow');
    } else {
      icon = svgIcon('volumeHigh');
    }
    cplayer.dom.muteBtn.innerHTML = icon;
  }
}

function setPlayIcon(isPaused, isEnded) {
  if (cplayer.dom.playBtn) {
    cplayer.dom.playBtn.innerHTML = isEnded
      ? svgIcon('replay')
      : (isPaused ? svgIcon('play') : svgIcon('pause'));
  }
}

function updateFullscreenIcon() {
  if (cplayer.dom.fsBtn) {
    cplayer.dom.fsBtn.innerHTML = document.fullscreenElement
      ? svgIcon('fsExit')
      : svgIcon('fsEnter');
    cplayer.dom.fsBtn.setAttribute('aria-label',
      document.fullscreenElement ? 'Keluar fullscreen' : 'Fullscreen');
  }
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s}`
    : `${m}:${s}`;
}

// ===== SVG Icons (poin #14 — ganti emoji jadi SVG) =====

const SVG_PATHS = {
  play:        'M8 5v14l11-7z',
  pause:       'M6 4h4v16H6zM14 4h4v16h-4z',
  replay:      'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  volumeHigh:  'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volumeLow:   'M7 9v6h4l5 5V4l-5 5H7z',
  volumeMute:  'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  fsEnter:     'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsExit:      'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  settings:    'M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z',
  prev:        'M6 6h2v12H6zM9.5 12l8.5 6V6z',
  next:        'M6 18l8.5-6L6 6v12zM16 6h2v12h-2z',
  close:       'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};

function svgIcon(name) {
  const path = SVG_PATHS[name];
  if (!path) return '';
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
}

// ===== Queue (autoplay next) — poin #19 =====

function setQueue(items, currentItem) {
  // Filter hanya video yang streamable
  const videos = items.filter(i =>
    !i.is_dir && i.streamable === 'video');
  videos.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  cplayer.state.queueItems = videos;
  cplayer.state.queueIndex = videos.findIndex(i => i.name === currentItem.name);
  updateQueueButtons();
}

function updateQueueButtons() {
  const idx = cplayer.state.queueIndex;
  const total = cplayer.state.queueItems.length;
  if (cplayer.dom.prevBtn) {
    cplayer.dom.prevBtn.disabled = idx <= 0;
    cplayer.dom.prevBtn.style.display = total > 1 ? '' : 'none';
  }
  if (cplayer.dom.nextBtn) {
    cplayer.dom.nextBtn.disabled = idx < 0 || idx >= total - 1;
    cplayer.dom.nextBtn.style.display = total > 1 ? '' : 'none';
  }
}

function playPrevInQueue() {
  if (cplayer.state.queueIndex <= 0) return;
  const item = cplayer.state.queueItems[cplayer.state.queueIndex - 1];
  if (typeof openPlayer === 'function') openPlayer(item);
}

function playNextInQueue() {
  const idx = cplayer.state.queueIndex;
  if (idx < 0 || idx >= cplayer.state.queueItems.length - 1) return;
  const item = cplayer.state.queueItems[idx + 1];
  if (typeof openPlayer === 'function') openPlayer(item);
}

// Helper untuk toast (delegasi ke app.js)
function showToastFromPlayer(msg) {
  if (typeof showToast === 'function') showToast(msg);
}

// ===== Reset saat close =====

function resetCplayer() {
  clearTimeout(cplayer.state.hideTimer);
  clearTimeout(cplayer.state.gestureTimer);
  cancelAnimationFrame(cplayer.state.rafId);

  if (cplayer.dom.container) cplayer.dom.container.classList.remove('hide-controls', 'is-fullscreen');
  if (cplayer.dom.gesture)   cplayer.dom.gesture.classList.add('hidden');
  if (cplayer.dom.skipBack)  cplayer.dom.skipBack.classList.add('hidden');
  if (cplayer.dom.skipFwd)   cplayer.dom.skipFwd.classList.add('hidden');
  if (cplayer.dom.rippleLeft)  cplayer.dom.rippleLeft.classList.add('hidden');
  if (cplayer.dom.rippleRight) cplayer.dom.rippleRight.classList.add('hidden');
  if (cplayer.dom.hoverTime) cplayer.dom.hoverTime.classList.add('hidden');
  hideSubtitleOverlay();
  detachSubtitleOverlayTrack();

  if (cplayer.video) cplayer.video.style.filter = '';

  setPlayIcon(true);
  if (cplayer.dom.centerPlay) {
    cplayer.dom.centerPlay.innerHTML = svgIcon('play');
    cplayer.dom.centerPlay.classList.add('hidden');
  }

  if (cplayer.dom.played)   cplayer.dom.played.style.width = '0';
  if (cplayer.dom.buffered) cplayer.dom.buffered.style.width = '0';
  if (cplayer.dom.handle)   cplayer.dom.handle.style.left = '0';
  if (cplayer.dom.time)     cplayer.dom.time.textContent = '0:00 / 0:00';

  closeAllPopups();
  updateVolumeUI();
  updateFullscreenIcon();

  cplayer.state.isDragging = false;
  cplayer.state.touchStart = null;
  cplayer.state.lastTap = 0;
  cplayer.state.queueItems = [];
  cplayer.state.queueIndex = -1;
  cplayer.state.fsTransition = false; // reset flag transisi fullscreen
  cplayer.state.currentSubIdx = -1;  // reset index subtitle aktif
  cplayer.state.iosNativeFullscreen = false;

  destroyHLS();
  cplayer.state.transcodeOffset = 0;
  cplayer.state.totalDuration   = 0;
  cplayer.state.isTranscoded    = false;
  cplayer.state.isHLS           = false;
  cplayer.state._hlsFallbackTried = false;
  cplayer.state._hlsWatchdog    = null;
  cplayer.state.pendingSeek     = null;
  cplayer.state.burnSubIndex    = -1;
  clearTimeout(_seekDebounceTimer);

  if (cplayer.state._subtitleBlobUrl) {
    URL.revokeObjectURL(cplayer.state._subtitleBlobUrl);
    cplayer.state._subtitleBlobUrl = null;
  }
  cplayer.state._subtitleRawVtt = null;

  // Reset CSS rotate kalau masih aktif saat player ditutup
  if (cplayer.state.cssRotated) {
    cplayer.state.cssRotated = false;
    if (cplayer.dom.container) cplayer.dom.container.classList.remove('css-rotated');
    document.body.classList.remove('cp-rotated-active');
    if (cplayer.dom.rotateBtn) {
      cplayer.dom.rotateBtn.classList.remove('active');
      cplayer.dom.rotateBtn.setAttribute('aria-label', 'Putar layar');
      cplayer.dom.rotateBtn.title = 'Putar layar';
    }
  }
}

// Setter untuk app.js
function setPlayerItem(item, path) {
  cplayer.state.currentItem = item;
  cplayer.state.currentPath = path;
}

// setTotalDuration: dipanggil dari app.js setelah /api/probe berhasil.
// Menyimpan durasi penuh dan menandai video sebagai transcode.
// Kalau durationSec = 0 dan isTranscoded = true, flag isTranscoded tetap di-set
// agar effectiveDuration() tahu ini transcoded (fallback ke video.duration native
// sampai probe balik dengan durasi sesungguhnya).
//
// BUG FIX: jangan reset transcodeOffset di sini.
// Fungsi ini dipanggil async (setelah /api/probe selesai). Kalau user sudah
// seek ke menit 10 sebelum probe balik, reset offset ke 0 akan membuat
// effectiveCurrentTime() salah hitung dan bisa memicu resume dari awal.
// transcodeOffset hanya boleh di-reset di resetCplayer() (saat player ditutup)
// atau di _flushTranscodeSeek() (saat seek baru dimulai).
function setTotalDuration(durationSec, isTranscoded) {
  const wasZero = cplayer.state.totalDuration === 0;
  cplayer.state.totalDuration = durationSec || 0;
  // isHLS: treat as seekable native timeline; isTranscoded only for continuous ?t= path
  if (cplayer.state.isHLS) {
    cplayer.state.isTranscoded = false;
  } else {
    cplayer.state.isTranscoded = !!isTranscoded;
  }

  // HLS resume via startPosition — jangan double-seek dari probe callback
  if (cplayer.state.isHLS) return;

  if (wasZero && durationSec > 0 && cplayer.state.currentPath) {
    const path = cplayer.state.currentPath;
    const currentAbsPos = effectiveCurrentTime();
    if (currentAbsPos < RESUME_MIN_SEC) {
      _tryResume(savedResumePosition(path));
    }
  }
}

// destroyHLS: lepas hls.js agar tidak leak buffer antar video.
function destroyHLS() {
  clearTimeout(cplayer.state._hlsWatchdog);
  cplayer.state._hlsWatchdog = null;
  if (cplayer.state.hls) {
    try {
      cplayer.state.hls.destroy();
    } catch (_) { /* ignore */ }
    cplayer.state.hls = null;
  }
}

// savedResumePosition: history server / localStorage untuk path aktif.
function savedResumePosition(path) {
  if (!path) return 0;
  const histEntry = window.watchHistoryByPath?.[path];
  if (histEntry && !histEntry.completed && histEntry.position_sec > 0) {
    return histEntry.position_sec;
  }
  return parseFloat(localStorage.getItem('cp_pos_' + path) || '0') || 0;
}

// attachHLSSource: pasang playlist HLS ke <video>.
// opts: { resumeAt, autoplay }
// resumeAt / startPosition: minta segmen target dulu (bukan seg 0).
function attachHLSSource(playlistURL, opts) {
  opts = opts || {};
  const v = cplayer.video;
  if (!v) return;

  destroyHLS();
  cplayer.state.isHLS = true;
  cplayer.state.isTranscoded = false;
  cplayer.state.transcodeOffset = 0;

  let resumeAt = opts.resumeAt;
  if (resumeAt == null) {
    resumeAt = savedResumePosition(cplayer.state.currentPath);
  }
  const autoplay = opts.autoplay !== false;
  const startAt = (typeof resumeAt === 'number' && resumeAt > RESUME_MIN_SEC) ? resumeAt : -1;

  const onReady = () => {
    // startPosition sudah di-set di config hls; fallback currentTime untuk native
    if (startAt > 0 && (!cplayer.state.hls || v.currentTime < RESUME_MIN_SEC)) {
      try { v.currentTime = startAt; } catch (_) {}
    }
    if (autoplay) v.play().catch(() => {});
    if (startAt > RESUME_MIN_SEC) {
      showToastFromPlayer(`▶ Lanjut dari ${formatTime(startAt)}`);
    }
  };

  if (cplayer.dom.spinner) cplayer.dom.spinner.classList.remove('hidden');

  // Watchdog: no media in 45s → continuous fallback (never spinner forever)
  clearTimeout(cplayer.state._hlsWatchdog);
  cplayer.state._hlsWatchdog = setTimeout(() => {
    if (!cplayer.state.isHLS || !cplayer.video) return;
    if (cplayer.video.readyState >= 2) return; // HAVE_CURRENT_DATA+
    console.warn('[hls] watchdog: no canplay — fallback continuous');
    fallbackContinuousTranscode(startAt, autoplay);
  }, 45000);

  function fallbackContinuousTranscode(at, doPlay) {
    clearTimeout(cplayer.state._hlsWatchdog);
    if (cplayer.state._hlsFallbackTried) return;
    cplayer.state._hlsFallbackTried = true;
    destroyHLS();
    const path = cplayer.state.currentPath;
    if (!path) return;
    showToastFromPlayer('⚠ HLS gagal — fallback stream kontinu…');
    cplayer.state.isHLS = false;
    cplayer.state.isTranscoded = true;
    let url = '/api/transcode?path=' + encodeURIComponent(path);
    if (cplayer.state.burnSubIndex >= 0) url += '&burnSub=' + cplayer.state.burnSubIndex;
    const t = (typeof at === 'number' && at > 0) ? Math.floor(at) : 0;
    if (t > 0) {
      url += '&t=' + t;
      cplayer.state.transcodeOffset = t;
    }
    v.src = url;
    v.load();
    if (doPlay) v.addEventListener('canplay', () => {
      if (cplayer.dom.spinner) cplayer.dom.spinner.classList.add('hidden');
      v.play().catch(() => {});
    }, { once: true });
  }

  if (window.Hls && Hls.isSupported()) {
    const hlsOpts = {
      enableWorker: true,
      maxBufferLength: 8,
      maxMaxBufferLength: 16,
      maxBufferSize: 12 * 1000 * 1000,
      maxBufferHole: 0.5,
      startLevel: -1,
      fragLoadTimeout: 120000,
      manifestLoadingTimeOut: 30000,
      levelLoadingTimeOut: 30000,
      fragLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 1000,
    };
    if (startAt > 0) {
      hlsOpts.startPosition = startAt;
    }
    const hls = new Hls(hlsOpts);
    cplayer.state.hls = hls;
    hls.loadSource(playlistURL);
    hls.attachMedia(v);
    // Play after first frag buffered — not only MANIFEST_PARSED
    let played = false;
    const tryPlay = () => {
      if (played) return;
      played = true;
      clearTimeout(cplayer.state._hlsWatchdog);
      onReady();
    };
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // light start; real play after FRAG_BUFFERED if media still empty
      if (v.readyState >= 2) tryPlay();
    });
    hls.on(Hls.Events.FRAG_BUFFERED, () => tryPlay());
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      console.error('[hls] fatal', data.type, data.details);
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      fallbackContinuousTranscode(startAt, autoplay);
    });
    return;
  }

  // Safari/iOS tanpa MSE: native HLS — seek setelah metadata
  if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = playlistURL;
    v.load();
    v.addEventListener('loadedmetadata', onReady, { once: true });
    return;
  }

  // Fallback: continuous transcode
  cplayer.state.isHLS = false;
  cplayer.state.isTranscoded = true;
  const path = cplayer.state.currentPath;
  let url = '/api/transcode?path=' + encodeURIComponent(path || '');
  if (cplayer.state.burnSubIndex >= 0) {
    url += '&burnSub=' + cplayer.state.burnSubIndex;
  }
  if (startAt > 0) {
    url += '&t=' + Math.floor(startAt);
    cplayer.state.transcodeOffset = Math.floor(startAt);
  }
  v.src = url;
  v.load();
  if (autoplay) v.addEventListener('canplay', () => v.play().catch(() => {}), { once: true });
}

// _tryResume: coba resume ke posisi tersimpan kalau valid.
function _tryResume(saved) {
  if (!saved || saved <= 0) return;
  const fullDur = effectiveDuration();
  if (!isFinite(fullDur) || fullDur <= 0) return;
  if (saved <= RESUME_MIN_SEC) return;
  if (saved >= fullDur - RESUME_MARGIN_SEC) return;

  const currentAbsPos = effectiveCurrentTime();
  if (currentAbsPos > RESUME_MIN_SEC) return;

  if (cplayer.state.isTranscoded && !cplayer.state.isHLS) {
    requestTranscodeSeek(saved);
  } else if (cplayer.video) {
    cplayer.video.currentTime = saved;
  }
  showToastFromPlayer(`▶ Lanjut dari ${formatTime(saved)}`);
}
