'use strict';

// ===== Custom Player (cplayer) =====
// Menggantikan HTML5 <video controls> default dengan UI kontrol custom.
// Engine tetap <video> HTML5, tapi semua kontrol dibangun manual.

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
    singleTapTimer: null,
    touchStart: null,
    gestureTimer: null,
  },
};

// ===== Inisialisasi =====

function initCplayer() {
  cplayer.video = document.getElementById('player-video');
  cplayer.dom = {
    container:   document.getElementById('cplayer'),
    controls:    document.getElementById('cplayer-controls'),
    playBtn:     document.getElementById('cplayer-play'),
    centerPlay:  document.getElementById('cplayer-center-play'),
    time:        document.getElementById('cplayer-time'),
    progress:    document.getElementById('cplayer-progress'),
    buffered:    document.getElementById('cplayer-progress-buffered'),
    played:      document.getElementById('cplayer-progress-played'),
    handle:      document.getElementById('cplayer-progress-handle'),
    speedBtn:    document.getElementById('cplayer-speed'),
    speedMenu:   document.getElementById('cplayer-speed-menu'),
    fsBtn:       document.getElementById('cplayer-fs'),
    ccBtn:       document.getElementById('cplayer-cc'),
    gesture:     document.getElementById('cplayer-gesture'),
    gestureIcon: document.getElementById('cplayer-gesture-icon'),
    gestureText: document.getElementById('cplayer-gesture-text'),
    skipBack:    document.getElementById('cplayer-skip-back'),
    skipFwd:     document.getElementById('cplayer-skip-fwd'),
  };

  // Restore preferences dari localStorage
  const savedVol   = parseFloat(localStorage.getItem('cp_volume') || '1');
  const savedSpeed = parseFloat(localStorage.getItem('cp_speed')  || '1');
  cplayer.video.volume      = isFinite(savedVol)   ? savedVol   : 1;
  cplayer.state.speed       = isFinite(savedSpeed) ? savedSpeed : 1;
  cplayer.video.playbackRate = cplayer.state.speed;
  if (cplayer.dom.speedBtn) {
    cplayer.dom.speedBtn.textContent = cplayer.state.speed.toFixed(2).replace('.00','') + 'x';
  }

  setupVideoEvents();
  setupControlEvents();
  setupGestureEvents();
  setupKeyboardShortcuts();
}

// ===== Tahap 4: Video Events =====

function setupVideoEvents() {
  const v = cplayer.video;

  v.addEventListener('loadedmetadata', () => {
    updateTimeUI();
    // Aktifkan subtitle jika ada
    if (v.textTracks.length > 0 && cplayer.state.ccEnabled) {
      v.textTracks[0].mode = 'showing';
    }
  });

  v.addEventListener('timeupdate', () => {
    if (!cplayer.state.isDragging) updateProgressUI();
  });

  v.addEventListener('progress', updateBufferedUI);

  v.addEventListener('play', () => {
    if (cplayer.dom.playBtn)    cplayer.dom.playBtn.textContent = '⏸';
    if (cplayer.dom.centerPlay) cplayer.dom.centerPlay.classList.add('hidden');
    resetHideTimer();
  });

  v.addEventListener('pause', () => {
    if (cplayer.dom.playBtn)    cplayer.dom.playBtn.textContent = '▶';
    if (cplayer.dom.centerPlay) cplayer.dom.centerPlay.classList.remove('hidden');
    showControls();
  });

  v.addEventListener('ended', () => {
    if (cplayer.dom.playBtn)    cplayer.dom.playBtn.textContent = '↺';
    if (cplayer.dom.centerPlay) {
      cplayer.dom.centerPlay.textContent = '↺';
      cplayer.dom.centerPlay.classList.remove('hidden');
    }
    showControls();
  });

  v.addEventListener('waiting', () => {
    const sp = document.getElementById('player-spinner');
    if (sp) sp.classList.remove('hidden');
  });

  v.addEventListener('canplay', () => {
    const sp = document.getElementById('player-spinner');
    if (sp) sp.classList.add('hidden');
  });

  // Fullscreen change — update ikon tombol
  document.addEventListener('fullscreenchange', () => {
    if (cplayer.dom.fsBtn) {
      cplayer.dom.fsBtn.textContent = document.fullscreenElement ? '⛶' : '⛶';
      cplayer.dom.fsBtn.setAttribute('aria-label',
        document.fullscreenElement ? 'Keluar fullscreen' : 'Fullscreen');
    }
    showControls();
  });
}

// ===== Tahap 4: Control Events =====

function setupControlEvents() {
  const v = cplayer.video;

  // Play/Pause button
  if (cplayer.dom.playBtn) {
    cplayer.dom.playBtn.addEventListener('click', () => {
      togglePlayPause();
      showControls();
    });
  }

  // Center play button
  if (cplayer.dom.centerPlay) {
    cplayer.dom.centerPlay.addEventListener('click', () => {
      if (v.ended) {
        v.currentTime = 0;
        cplayer.dom.centerPlay.textContent = '▶';
      }
      togglePlayPause();
      showControls();
    });
  }

  // Progress bar — pointer events (works for mouse + touch)
  if (cplayer.dom.progress) {
    cplayer.dom.progress.addEventListener('pointerdown', (e) => {
      cplayer.state.isDragging = true;
      cplayer.dom.progress.classList.add('dragging');
      cplayer.dom.progress.setPointerCapture(e.pointerId);
      seekToPointer(e);
      showControls();
    });
    cplayer.dom.progress.addEventListener('pointermove', (e) => {
      if (!cplayer.state.isDragging) return;
      seekToPointer(e);
    });
    cplayer.dom.progress.addEventListener('pointerup', () => {
      cplayer.state.isDragging = false;
      cplayer.dom.progress.classList.remove('dragging');
      resetHideTimer();
    });
    cplayer.dom.progress.addEventListener('pointercancel', () => {
      cplayer.state.isDragging = false;
      cplayer.dom.progress.classList.remove('dragging');
    });
  }

  // Fullscreen button
  if (cplayer.dom.fsBtn) {
    cplayer.dom.fsBtn.addEventListener('click', () => {
      toggleFullscreen();
      showControls();
    });
  }

  // Speed button — toggle menu
  if (cplayer.dom.speedBtn && cplayer.dom.speedMenu) {
    cplayer.dom.speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = cplayer.dom.speedMenu.classList.contains('hidden');
      closeAllPopups();
      if (isHidden) cplayer.dom.speedMenu.classList.remove('hidden');
      showControls();
    });

    cplayer.dom.speedMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-speed]');
      if (!btn) return;
      const speed = parseFloat(btn.dataset.speed);
      setSpeed(speed);
      closeAllPopups();
      showControls();
    });
  }

  // CC button — toggle subtitle
  if (cplayer.dom.ccBtn) {
    cplayer.dom.ccBtn.addEventListener('click', () => {
      toggleCC();
      showControls();
    });
  }

  // Klik di luar popup → tutup
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#cplayer-speed-menu') &&
        !e.target.closest('#cplayer-speed')) {
      closeAllPopups();
    }
  });

  // Pointer move di container → show controls
  if (cplayer.dom.container) {
    cplayer.dom.container.addEventListener('pointermove', () => {
      showControls();
    });
  }
}

// ===== Tahap 5: Auto-hide Controls =====

function showControls() {
  if (!cplayer.dom.container) return;
  cplayer.dom.container.classList.remove('hide-controls');
  resetHideTimer();
}

function hideControls() {
  if (!cplayer.video || !cplayer.dom.container) return;
  if (!cplayer.video.paused && !cplayer.state.isDragging) {
    cplayer.dom.container.classList.add('hide-controls');
  }
}

function resetHideTimer() {
  clearTimeout(cplayer.state.hideTimer);
  cplayer.state.hideTimer = setTimeout(hideControls, 3000);
}

// ===== Tahap 6: Gesture Mobile =====

function setupGestureEvents() {
  if (!cplayer.dom.container) return;

  // Double-tap kiri/kanan untuk skip ±10 detik
  // Tap tunggal untuk toggle controls (dengan delay 300ms untuk bedakan dari double-tap)
  cplayer.dom.container.addEventListener('click', (e) => {
    // Skip kalau klik di controls atau tombol
    if (e.target.closest('.cplayer-controls') ||
        e.target.closest('.cplayer-center-play') ||
        e.target.closest('.cplayer-popup')) return;

    const now = Date.now();
    const rect = cplayer.dom.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const isRight = x > rect.width / 2;

    if (now - cplayer.state.lastTap < 300 &&
        Math.abs(x - cplayer.state.lastTapX) < 80) {
      // Double-tap terdeteksi
      clearTimeout(cplayer.state.singleTapTimer);
      cplayer.state.lastTap = 0;
      const skip = isRight ? 10 : -10;
      cplayer.video.currentTime = Math.max(0,
        Math.min(cplayer.video.duration || 0, cplayer.video.currentTime + skip));
      showSkipIndicator(isRight);
      showControls();
    } else {
      // Tap pertama — tunggu 300ms untuk pastikan bukan double-tap
      cplayer.state.lastTap = now;
      cplayer.state.lastTapX = x;
      clearTimeout(cplayer.state.singleTapTimer);
      cplayer.state.singleTapTimer = setTimeout(() => {
        // Single tap: toggle controls
        if (cplayer.dom.container.classList.contains('hide-controls')) {
          showControls();
        } else {
          hideControls();
        }
      }, 300);
    }
  });

  // Swipe vertikal: sisi kanan = volume, sisi kiri = brightness
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
    const dy = cplayer.state.touchStart.y - t.clientY; // atas = positif
    // Hanya proses swipe vertikal dominan
    if (Math.abs(dy) < Math.abs(dx) || Math.abs(dy) < 10) return;

    const delta = dy / 200;
    if (cplayer.state.touchStart.isRight) {
      // Volume
      const newVol = Math.max(0, Math.min(1, cplayer.state.touchStart.startVol + delta));
      cplayer.video.volume = newVol;
      cplayer.video.muted = newVol === 0;
      localStorage.setItem('cp_volume', newVol.toFixed(2));
      showGesture(newVol === 0 ? '🔇' : '🔊', Math.round(newVol * 100) + '%');
    } else {
      // Brightness (via CSS filter)
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

function showSkipIndicator(isRight) {
  const el = isRight ? cplayer.dom.skipFwd : cplayer.dom.skipBack;
  if (!el) return;
  // Re-trigger animasi dengan clone trick
  el.classList.remove('hidden');
  el.style.animation = 'none';
  el.offsetHeight; // reflow
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

// ===== Tahap 7: Subtitle =====

function setupSubtitle(item, filePathFn) {
  if (!cplayer.video || !cplayer.dom.ccBtn) return;

  // Hapus track lama
  const oldTracks = cplayer.video.querySelectorAll('track');
  oldTracks.forEach(t => t.remove());

  if (item.has_subtitle && item.streamable === 'video') {
    const track = document.createElement('track');
    track.kind    = 'subtitles';
    track.label   = 'Subtitle';
    track.srclang = 'id';
    track.default = true;
    track.src = '/api/subtitle?path=' + encodeURIComponent(filePathFn(item));
    cplayer.video.appendChild(track);

    cplayer.dom.ccBtn.classList.remove('hidden');
    cplayer.state.ccEnabled = true;
    cplayer.dom.ccBtn.classList.add('active');

    // Set mode setelah metadata loaded
    cplayer.video.addEventListener('loadedmetadata', () => {
      if (cplayer.video.textTracks.length > 0) {
        cplayer.video.textTracks[0].mode = 'showing';
      }
    }, { once: true });
  } else {
    cplayer.dom.ccBtn.classList.add('hidden');
    cplayer.state.ccEnabled = false;
    cplayer.dom.ccBtn.classList.remove('active');
  }
}

function toggleCC() {
  const tracks = cplayer.video.textTracks;
  if (!tracks || tracks.length === 0) return;
  cplayer.state.ccEnabled = !cplayer.state.ccEnabled;
  tracks[0].mode = cplayer.state.ccEnabled ? 'showing' : 'hidden';
  if (cplayer.dom.ccBtn) {
    cplayer.dom.ccBtn.classList.toggle('active', cplayer.state.ccEnabled);
  }
}

// ===== Tahap 8: Keyboard Shortcuts =====

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const playerOverlay = document.getElementById('player-overlay');
    if (!playerOverlay || playerOverlay.classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlayPause();
        showControls();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        cplayer.video.currentTime = Math.max(0, cplayer.video.currentTime - 5);
        showControls();
        break;
      case 'ArrowRight':
        e.preventDefault();
        cplayer.video.currentTime = Math.min(
          cplayer.video.duration || 0, cplayer.video.currentTime + 5);
        showControls();
        break;
      case 'ArrowUp':
        e.preventDefault();
        cplayer.video.volume = Math.min(1, cplayer.video.volume + 0.05);
        localStorage.setItem('cp_volume', cplayer.video.volume.toFixed(2));
        showGesture('🔊', Math.round(cplayer.video.volume * 100) + '%');
        showControls();
        break;
      case 'ArrowDown':
        e.preventDefault();
        cplayer.video.volume = Math.max(0, cplayer.video.volume - 0.05);
        localStorage.setItem('cp_volume', cplayer.video.volume.toFixed(2));
        showGesture('🔊', Math.round(cplayer.video.volume * 100) + '%');
        showControls();
        break;
      case 'f':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'm':
        e.preventDefault();
        cplayer.video.muted = !cplayer.video.muted;
        showGesture(cplayer.video.muted ? '🔇' : '🔊',
          cplayer.video.muted ? 'Mute' : Math.round(cplayer.video.volume * 100) + '%');
        showControls();
        break;
      case 'c':
        if (cplayer.dom.ccBtn && !cplayer.dom.ccBtn.classList.contains('hidden')) {
          toggleCC();
          showControls();
        }
        break;
    }
  });
}

// ===== Helper Functions =====

function togglePlayPause() {
  if (!cplayer.video) return;
  if (cplayer.video.paused || cplayer.video.ended) {
    if (cplayer.video.ended) cplayer.video.currentTime = 0;
    cplayer.video.play().catch(() => {});
  } else {
    cplayer.video.pause();
  }
}

function toggleFullscreen() {
  if (!cplayer.dom.container) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    cplayer.dom.container.requestFullscreen().catch(() => {});
  }
}

function setSpeed(speed) {
  cplayer.state.speed = speed;
  cplayer.video.playbackRate = speed;
  localStorage.setItem('cp_speed', speed);
  if (cplayer.dom.speedBtn) {
    const label = speed === 1 ? '1x' : speed + 'x';
    cplayer.dom.speedBtn.textContent = label;
  }
  // Update active state di menu
  if (cplayer.dom.speedMenu) {
    cplayer.dom.speedMenu.querySelectorAll('[data-speed]').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
    });
  }
}

function closeAllPopups() {
  const speedMenu = document.getElementById('cplayer-speed-menu');
  if (speedMenu) speedMenu.classList.add('hidden');
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

function updateProgressUI() {
  if (!cplayer.video || !cplayer.dom.played || !cplayer.dom.handle) return;
  const dur = cplayer.video.duration;
  const cur = cplayer.video.currentTime;
  const pct = isFinite(dur) && dur > 0 ? (cur / dur) * 100 : 0;
  cplayer.dom.played.style.width = pct + '%';
  cplayer.dom.handle.style.left  = pct + '%';
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

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s}`
    : `${m}:${s}`;
}

// ===== Tahap 9: Reset saat close =====

function resetCplayer() {
  clearTimeout(cplayer.state.hideTimer);
  clearTimeout(cplayer.state.singleTapTimer);
  clearTimeout(cplayer.state.gestureTimer);

  if (cplayer.dom.container) {
    cplayer.dom.container.classList.remove('hide-controls');
  }
  if (cplayer.dom.gesture) {
    cplayer.dom.gesture.classList.add('hidden');
  }
  if (cplayer.dom.skipBack) cplayer.dom.skipBack.classList.add('hidden');
  if (cplayer.dom.skipFwd)  cplayer.dom.skipFwd.classList.add('hidden');

  // Reset brightness
  if (cplayer.video) {
    cplayer.video.style.filter = '';
  }

  // Reset play button
  if (cplayer.dom.playBtn) cplayer.dom.playBtn.textContent = '▶';
  if (cplayer.dom.centerPlay) {
    cplayer.dom.centerPlay.textContent = '▶';
    cplayer.dom.centerPlay.classList.add('hidden');
  }

  // Reset progress
  if (cplayer.dom.played) cplayer.dom.played.style.width = '0';
  if (cplayer.dom.buffered) cplayer.dom.buffered.style.width = '0';
  if (cplayer.dom.handle) cplayer.dom.handle.style.left = '0';
  if (cplayer.dom.time) cplayer.dom.time.textContent = '0:00 / 0:00';

  // Tutup popup
  closeAllPopups();

  cplayer.state.isDragging = false;
  cplayer.state.touchStart = null;
  cplayer.state.lastTap = 0;
}
