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
    availableSubs: [],       // daftar subtitle dari /api/subtitles
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
  },
  abort: null, // AbortController untuk listener per-video
};

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
  };

  // Restore preferences dari localStorage
  const savedVol   = parseFloat(localStorage.getItem('cp_volume') || '1');
  const savedSpeed = parseFloat(localStorage.getItem('cp_speed')  || '1');
  cplayer.video.volume = isFinite(savedVol)   ? clampVolume(savedVol) : 1;
  cplayer.state.speed  = isFinite(savedSpeed) ? savedSpeed : 1;
  cplayer.video.playbackRate = cplayer.state.speed;
  updateSpeedLabel();
  updateVolumeUI();

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
    // Resume playback position (poin #13)
    const path = cplayer.state.currentPath;
    if (path) {
      const saved = parseFloat(localStorage.getItem('cp_pos_' + path) || '0');
      if (saved > 5 && isFinite(v.duration) && saved < v.duration - 10) {
        v.currentTime = saved;
        showToastFromPlayer(`▶ Lanjut dari ${formatTime(saved)}`);
      }
    }
  });

  // Pakai requestAnimationFrame untuk update progress (poin #22)
  v.addEventListener('timeupdate', () => {
    if (cplayer.state.isDragging) return;
    cancelAnimationFrame(cplayer.state.rafId);
    cplayer.state.rafId = requestAnimationFrame(updateProgressUI);

    // Save resume position throttled (tiap 5 detik)
    if (Math.floor(v.currentTime) % 5 === 0 && cplayer.state.currentPath) {
      localStorage.setItem('cp_pos_' + cplayer.state.currentPath, v.currentTime);
    }
  });

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
  });

  v.addEventListener('ended', () => {
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
    if (!document.fullscreenElement) {
      unlockOrientation();
    }
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

function showMainSettingsMenu() {
  if (!cplayer.dom.settingsMenu) return;
  const speedLabel = cplayer.state.speed === 1 ? 'Normal' : cplayer.state.speed + 'x';
  const subLabel = cplayer.state.ccEnabled
    ? (cplayer.state.availableSubs.find(s => s.lang === cplayer.state.currentLang)?.label || 'On')
    : 'Off';

  cplayer.dom.settingsMenu.innerHTML = `
    <button class="cplayer-popup-item" data-action="show-speed">
      <span>Kecepatan</span>
      <span class="popup-value">${speedLabel} ›</span>
    </button>
    <button class="cplayer-popup-item" data-action="show-cc">
      <span>Subtitle</span>
      <span class="popup-value">${subLabel} ›</span>
    </button>
  `;

  // Pasang listener
  cplayer.dom.settingsMenu.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'show-speed') showSpeedSubmenu();
      else if (action === 'show-cc') showSubSubmenu();
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
    ${subs.map(s => `
      <button class="cplayer-popup-item ${cplayer.state.ccEnabled && cplayer.state.currentLang === s.lang ? 'active' : ''}"
              data-lang="${s.lang}">
        ${s.label}
      </button>
    `).join('')}
  `;
  cplayer.dom.settingsMenu.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lang = btn.dataset.lang;
      if (lang === '__off') {
        toggleCC(false);
      } else {
        switchSubtitle(lang);
      }
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
      v.currentTime = Math.max(0,
        Math.min(v.duration || 0, v.currentTime + skip));
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
  if (!cplayer.video) return;

  // Hapus track lama
  cplayer.video.querySelectorAll('track').forEach(t => t.remove());
  cplayer.state.availableSubs = [];
  cplayer.state.currentLang = '';

  if (!item.has_subtitle || item.streamable !== 'video') {
    cplayer.state.ccEnabled = false;
    return;
  }

  // Fetch list subtitle dari backend
  try {
    const path = filePathFn(item);
    const res = await fetch('/api/subtitles?path=' + encodeURIComponent(path));
    const subs = await res.json();
    if (Array.isArray(subs) && subs.length > 0) {
      cplayer.state.availableSubs = subs;
      // Pilih default: prioritaskan 'id', lalu 'en', lalu yang pertama
      const preferred = subs.find(s => s.lang === 'id') ||
                        subs.find(s => s.lang === 'en') ||
                        subs[0];
      switchSubtitle(preferred.lang);
    }
  } catch {
    // Fallback ke single subtitle (lama)
    cplayer.state.availableSubs = [{ lang: '', label: 'Default' }];
    switchSubtitle('');
  }
}

function switchSubtitle(lang) {
  if (!cplayer.video || !cplayer.state.currentItem) return;

  // Hapus track lama (fix poin #6)
  cplayer.video.querySelectorAll('track').forEach(t => t.remove());

  const path = cplayer.state.currentPath;
  const url = '/api/subtitle?path=' + encodeURIComponent(path) +
              (lang ? '&lang=' + encodeURIComponent(lang) : '');
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = cplayer.state.availableSubs.find(s => s.lang === lang)?.label || 'Subtitle';
  track.srclang = lang || 'und';
  track.default = true;
  track.src = url;
  cplayer.video.appendChild(track);

  cplayer.state.currentLang = lang;
  cplayer.state.ccEnabled = true;

  // Update mode setelah track loaded
  track.addEventListener('load', () => {
    if (cplayer.video.textTracks.length > 0 && cplayer.state.ccEnabled) {
      cplayer.video.textTracks[cplayer.video.textTracks.length - 1].mode = 'showing';
    }
  }, { once: true });

  // Pakai timeout sebagai fallback kalau load event tidak fire
  setTimeout(() => {
    if (cplayer.video.textTracks.length > 0 && cplayer.state.ccEnabled) {
      cplayer.video.textTracks[cplayer.video.textTracks.length - 1].mode = 'showing';
    }
  }, 100);
}

function toggleCC(forceState) {
  const tracks = cplayer.video.textTracks;
  if (!tracks || tracks.length === 0) return;
  const newState = (forceState !== undefined) ? forceState : !cplayer.state.ccEnabled;
  cplayer.state.ccEnabled = newState;
  tracks[tracks.length - 1].mode = newState ? 'showing' : 'hidden';
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
      v.currentTime = pct * (v.duration || 0);
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
        v.currentTime = Math.max(0, v.currentTime - 5);
        showControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
        showControls();
        break;
      case 'j':
        e.preventDefault();
        v.currentTime = Math.max(0, v.currentTime - 10);
        showControls();
        break;
      case 'l':
        e.preventDefault();
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
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
      // Frame seeking
      case ',':
        e.preventDefault();
        if (v.paused) v.currentTime = Math.max(0, v.currentTime - 1/30);
        showControls();
        break;
      case '.':
        e.preventDefault();
        if (v.paused) v.currentTime = Math.min(v.duration || 0, v.currentTime + 1/30);
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
    // Kalau sedang CSS rotate, matikan dulu — fullscreen + screen lock akan handle rotasi.
    if (cplayer.state.cssRotated) {
      toggleCssRotate();
    }
    // Enter: set flag dulu agar klik ganda tidak memicu requestFullscreen kedua.
    cplayer.state.fsTransition = true;
    try {
      await cplayer.dom.container.requestFullscreen();
      // Lock orientasi SETELAH fullscreen aktif — screen.orientation.lock()
      // akan error kalau dipanggil sebelum fullscreen benar-benar aktif.
      await lockLandscape();
    } catch (_) { /* abaikan — user mungkin cancel atau browser tidak support */ }
    finally {
      // Selalu reset flag setelah selesai (berhasil atau gagal).
      cplayer.state.fsTransition = false;
    }

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
  if (isFinite(cplayer.video.duration)) {
    cplayer.video.currentTime = ratio * cplayer.video.duration;
  }
  updateProgressUI();
}

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

function updateProgressUI() {
  if (!cplayer.video || !cplayer.dom.played || !cplayer.dom.handle) return;
  const dur = cplayer.video.duration;
  const cur = cplayer.video.currentTime;
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
  const dur = cplayer.video.duration;
  if (!isFinite(dur) || dur === 0) return;
  const buf = cplayer.video.buffered;
  if (buf.length > 0) {
    const pct = (buf.end(buf.length - 1) / dur) * 100;
    cplayer.dom.buffered.style.width = pct + '%';
  }
}

function updateTimeUI() {
  if (!cplayer.dom.time || !cplayer.video) return;
  const cur = formatTime(cplayer.video.currentTime);
  const dur = formatTime(cplayer.video.duration);
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

  if (cplayer.dom.container) cplayer.dom.container.classList.remove('hide-controls');
  if (cplayer.dom.gesture)   cplayer.dom.gesture.classList.add('hidden');
  if (cplayer.dom.skipBack)  cplayer.dom.skipBack.classList.add('hidden');
  if (cplayer.dom.skipFwd)   cplayer.dom.skipFwd.classList.add('hidden');
  if (cplayer.dom.rippleLeft)  cplayer.dom.rippleLeft.classList.add('hidden');
  if (cplayer.dom.rippleRight) cplayer.dom.rippleRight.classList.add('hidden');
  if (cplayer.dom.hoverTime) cplayer.dom.hoverTime.classList.add('hidden');

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
