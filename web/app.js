'use strict';

// ===== State =====
const state = {
  currentPath: '',
  searchQuery: '',
  allItems: [],
  currentPlayerItem: null, // item yang sedang dibuka di player
  // Sortir (bisa diatur user, diingat di localStorage)
  sortBy: localStorage.getItem('sort_by') || 'name',      // 'name' | 'size' | 'date' | 'type'
  sortDir: localStorage.getItem('sort_dir') || 'asc',     // 'asc' | 'desc'
  // #10: foldersFirst sekarang punya toggle di Settings — tidak lagi dead config
  foldersFirst: localStorage.getItem('folders_first') !== 'false', // default true
};

// ===== DOM refs =====
const $ = (id) => document.getElementById(id);
const loginScreen = $('login-screen');
const appEl       = $('app');
const fileList    = $('file-list');
const errorBox    = $('error-box');
const emptyMsg    = $('empty-msg');
const breadcrumb  = $('breadcrumb');
const searchInput = $('search-input');
const toast       = $('toast');
const uploadInput = $('upload-input');

// ===== Theme System =====
const THEME_ICONS = {
  light: '<path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2v-2H2v2zm18 0h2v-2h-2v2zM11 2v2h2V2h-2zm0 18v2h2v-2h-2zM5.99 4.58l-1.41 1.41 1.79 1.79 1.41-1.41-1.79-1.79zm12.37 12.37l-1.41 1.41 1.79 1.79 1.41-1.41-1.79-1.79zm1.79-10.96l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zM7.76 17.66l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79z" fill="currentColor"/>',
  dark:  '<path d="M9.37 5.51c-.18.64-.27 1.31-.27 1.99 0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27C17.45 17.19 14.93 19 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49zM12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" fill="currentColor"/>',
  auto:  '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>',
};
const THEME_LABELS = { light: 'Light', dark: 'Dark', auto: 'Auto' };

function applyTheme(mode) {
  localStorage.setItem('theme', mode);
  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }
  const icon = $('theme-icon');
  if (icon) icon.innerHTML = THEME_ICONS[mode];
  const lbl = $('theme-label-settings');
  if (lbl) lbl.textContent = THEME_LABELS[mode];
}

function cycleTheme() {
  const cur = localStorage.getItem('theme') || 'auto';
  const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
  applyTheme(next);
}

$('btn-theme').addEventListener('click', cycleTheme);
const btnThemeSettings = $('btn-theme-settings');
if (btnThemeSettings) btnThemeSettings.addEventListener('click', cycleTheme);

// Init theme sebelum render
applyTheme(localStorage.getItem('theme') || 'auto');

// ===== Tab Switching =====
let activeTab = 'home';

function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll('[data-tab]').forEach(el => {
    if (el.tagName === 'A') el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll('section[data-tab]').forEach(s => {
    s.classList.toggle('hidden', s.dataset.tab !== tabName);
  });
  // Sembunyikan file actions saat bukan di tab home
  [$('btn-refresh'), $('btn-upload')].forEach(btn => {
    if (btn) btn.style.display = tabName === 'home' ? '' : 'none';
  });
  if (tabName === 'live' && typeof initLiveTab === 'function') initLiveTab();
  if (tabName === 'history') renderHistory();
}

document.querySelectorAll('[data-tab]').forEach(el => {
  if (el.tagName === 'A') {
    el.addEventListener('click', (e) => { e.preventDefault(); switchTab(el.dataset.tab); });
  }
});

// ===== View Toggle (List / Grid) =====
const savedView = localStorage.getItem('view_mode') || 'list';
if (savedView === 'grid') fileList.classList.add('grid-mode');
$('view-list').classList.toggle('active', savedView === 'list');
$('view-grid').classList.toggle('active', savedView === 'grid');

$('view-list').addEventListener('click', () => {
  fileList.classList.remove('grid-mode');
  localStorage.setItem('view_mode', 'list');
  $('view-list').classList.add('active');
  $('view-grid').classList.remove('active');
});
$('view-grid').addEventListener('click', () => {
  fileList.classList.add('grid-mode');
  localStorage.setItem('view_mode', 'grid');
  $('view-grid').classList.add('active');
  $('view-list').classList.remove('active');
});

// ===== Skeleton Loading =====
function showSkeleton(count = 6) {
  fileList.innerHTML = Array(count).fill(0).map(() => `
    <li class="skeleton-item">
      <div class="skeleton skeleton-icon"></div>
      <div class="skeleton-text">
        <div class="skeleton skeleton-line"></div>
        <div class="skeleton skeleton-line short"></div>
      </div>
    </li>
  `).join('');
  emptyMsg.classList.add('hidden');
  hideError();
}

// ===== Emoji icons =====
const EXT_ICONS = {
  mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',
  mp3: '🎵', flac: '🎵', wav: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', webp: '🖼️', svg: '🖼️',
  pdf: '📕', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
  txt: '📄', md: '📄', log: '📄', csv: '📄',
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
  js: '💻', ts: '💻', go: '💻', py: '💻', html: '💻', css: '💻', json: '💻',
};

function getIcon(item) {
  if (item.is_dir) return '📁';
  return EXT_ICONS[item.ext] || '📄';
}

// ===== Format helpers =====
function formatSize(bytes) {
  if (bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function filePathOf(item) {
  return state.currentPath ? state.currentPath + '/' + item.name : item.name;
}

// ===== API helpers =====
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) { location.reload(); throw new Error('Unauthorized'); }
  return res;
}

// ===== File loading =====
async function loadFiles(relPath = '') {
  state.currentPath = relPath;
  state.searchQuery = '';
  searchInput.value = '';
  showSkeleton();

  // Fetch history dan files secara paralel
  await loadHistoryCache();

  try {
    const res = await apiFetch('/api/files?path=' + encodeURIComponent(relPath));
    const data = await res.json();
    if (!res.ok) {
      fileList.innerHTML = '';
      showError(data.error || 'Gagal memuat file.');
      return;
    }
    state.allItems = data.items || [];
    renderBreadcrumb(data.path || '');
    renderFiles(state.allItems);
  } catch {
    fileList.innerHTML = '';
    showError('Tidak dapat terhubung ke server. Pastikan server berjalan.');
  }
}

// ===== Sortir =====

// sortItems mengurutkan array item berdasarkan state.sortBy / sortDir / foldersFirst.
// #5: mod_time di-parse sekali ke angka sebelum sort agar tidak ada O(n log n) Date allocation.
function sortItems(items) {
  const dir = state.sortDir === 'desc' ? -1 : 1;
  // Precompute numeric mtime sekali per item
  const withMtime = items.map(i => ({ i, mtime: i.mod_time ? Date.parse(i.mod_time) : 0 }));
  withMtime.sort((a, b) => {
    const ai = a.i, bi = b.i;
    // Folder selalu di atas kalau foldersFirst aktif (tidak terpengaruh asc/desc)
    if (state.foldersFirst && ai.is_dir !== bi.is_dir) {
      return ai.is_dir ? -1 : 1;
    }
    let cmp = 0;
    switch (state.sortBy) {
      case 'size':
        cmp = (ai.size || 0) - (bi.size || 0);
        break;
      case 'date':
        // #5: bandingkan angka, bukan new Date()
        cmp = a.mtime - b.mtime;
        break;
      case 'type':
        // urutkan by ekstensi, fallback ke nama
        cmp = (ai.ext || '').localeCompare(bi.ext || '', 'id');
        if (cmp === 0) cmp = ai.name.localeCompare(bi.name, 'id');
        break;
      case 'name':
      default:
        cmp = ai.name.localeCompare(bi.name, 'id', { numeric: true });
        break;
    }
    return cmp * dir;
  });
  return withMtime.map(x => x.i);
}

function renderFiles(items) {
  fileList.innerHTML = '';

  const q = state.searchQuery.toLowerCase();
  const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
  const sorted = sortItems(filtered);

  if (sorted.length === 0) { emptyMsg.classList.remove('hidden'); return; }
  emptyMsg.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const item of sorted) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.setAttribute('role', 'listitem');

    const meta = item.is_dir
      ? 'Folder'
      : [formatSize(item.size), formatDate(item.mod_time)].filter(Boolean).join(' · ');

    // Badge: video/audio yang bisa diputar browser
    const streamBadge = item.streamable
      ? `<span class="stream-badge">${item.streamable === 'video' ? '▶ Video' : '♪ Audio'}</span>`
      : (item.native_play ? `<span class="native-badge">⬇ Download</span>` : '');

    // Progress bar untuk video yang ada di history
    const fullPath = state.currentPath ? state.currentPath + '/' + item.name : item.name;
    const histEntry = window.watchHistoryByPath?.[fullPath];
    let progressHTML = '';
    if (histEntry && histEntry.duration_sec > 0 && !histEntry.completed) {
      const pct = Math.min(100, (histEntry.position_sec / histEntry.duration_sec) * 100);
      progressHTML = `<div class="watch-progress"><div class="watch-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
    }

    // Tombol menu "⋯" untuk semua item (file & folder)
    const menuBtnHTML = `<button class="file-menu-btn" aria-label="Menu aksi" title="Aksi">⋯</button>`;
    // Untuk folder: tampilkan panah navigasi + tombol menu
    const arrowHTML = item.is_dir
      ? `<span class="file-arrow" aria-hidden="true">›</span>${menuBtnHTML}`
      : menuBtnHTML;

    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">${getIcon(item)}</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(item.name)}${streamBadge}</div>
        <div class="file-meta">${escapeHtml(meta)}</div>
        ${progressHTML}
      </div>
      ${arrowHTML}
    `;

    // Tap baris: navigasi folder / buka player / download (perilaku lama)
    li.addEventListener('click', (ev) => {
      // Jangan trigger kalau yang diklik adalah tombol menu
      if (ev.target.closest('.file-menu-btn')) return;

      if (item.is_dir) {
        loadFiles(state.currentPath ? state.currentPath + '/' + item.name : item.name);
        return;
      }
      if (item.streamable) {
        playItem(item); // #9: pre-flight terpusat di playItem()
      } else {
        downloadFile(item);
        showToast('⬇ Mendownload "' + item.name + '"');
      }
    });

    // Tombol menu "⋯": buka action sheet
    const menuBtn = li.querySelector('.file-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openItemMenu(item);
      });
    }

    frag.appendChild(li);
  }
  fileList.appendChild(frag);
}

// ===== Action Sheet (menu aksi per item) =====

const actionSheet = $('action-sheet');

// #9: playItem adalah single entry-point untuk memutar file — dipakai oleh
// tap baris DAN action sheet agar pre-flight logic tidak duplikat/drift.
function playItem(item) {
  if (item.needs_transcode && item.streamable === 'video') {
    // Cek antrian transcode (fire-and-forget)
    fetch('/api/transcode/status').then(r => r.ok ? r.json() : null).then(status => {
      if (status && !status.available) {
        showToast('⏳ Server sibuk transcode video lain. Tunggu beberapa detik...');
      }
    }).catch(() => {});

    // Warning HEVC (sekali per session, fire-and-forget)
    if (!sessionStorage.getItem('cp_hevcWarned')) {
      fetch('/api/probe?path=' + encodeURIComponent(filePathOf(item)))
        .then(r => r.ok ? r.json() : null)
        .then(probe => {
          if (!probe) return;
          const vc = (probe.streams || []).find(s => s.type === 'video');
          if (vc && (vc.codec === 'hevc' || vc.codec === 'h265' || vc.codec === 'av1')) {
            sessionStorage.setItem('cp_hevcWarned', '1');
            showToast('🎬 Codec ' + vc.codec.toUpperCase() + ' terdeteksi. Transcode butuh CPU besar.');
          }
        }).catch(() => {});
    }
  }
  openPlayer(item);

  // AUTO-FULLSCREEN: hanya untuk video, dipicu langsung dari tap user (user gesture masih aktif).
  // Audio tidak di-fullscreen-kan. iOS akan gagal diam-diam (di-catch di enterFullscreen).
  if (item.streamable === 'video' && typeof enterFullscreen === 'function') {
    enterFullscreen();
  }
}

function openItemMenu(item) {
  const title = $('action-sheet-title');
  const buttons = $('action-sheet-buttons');
  title.textContent = item.name;
  buttons.innerHTML = '';

  if (item.is_dir) {
    // Folder: masuk folder
    addSheetButton('📁 Buka Folder', () => {
      closeActionSheet();
      loadFiles(state.currentPath ? state.currentPath + '/' + item.name : item.name);
    });
    // Folder: download sebagai ZIP
    addSheetButton('🗜 Download (ZIP)', () => {
      closeActionSheet();
      downloadFolderZip(item);
    });
  } else {
    // File streamable: bisa diputar
    if (item.streamable) {
      addSheetButton('▶ Putar', () => {
        closeActionSheet();
        playItem(item); // #9: pakai playItem() — pre-flight lengkap termasuk HEVC warning
      });
    }
    // File: download
    addSheetButton('⬇ Download', () => {
      closeActionSheet();
      downloadFile(item);
      showToast('⬇ Mendownload "' + item.name + '"');
    });
  }

  actionSheet.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  // #7: push history state agar back button HP bisa tutup action sheet
  if (!history.state || !history.state.actionSheet) {
    history.pushState({ actionSheet: true }, '');
  }
}

function addSheetButton(label, onClick) {
  const b = document.createElement('button');
  b.className = 'action-sheet-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  $('action-sheet-buttons').appendChild(b);
}

function closeActionSheet() {
  if (actionSheet.classList.contains('hidden')) return;
  actionSheet.classList.add('hidden');
  document.body.style.overflow = '';
}

// ===== Download Folder sebagai ZIP =====

// #6: downloadFolderZip pakai fetch preflight HEAD agar error server (400/404)
// tidak menghasilkan file .zip berisi teks JSON yang membingungkan user.
async function downloadFolderZip(item) {
  const path = filePathOf(item);
  const url = '/api/download-zip?path=' + encodeURIComponent(path);

  // Preflight: cek apakah server siap sebelum trigger download
  try {
    const check = await fetch(url, { method: 'HEAD' });
    if (!check.ok) {
      showToast('❌ Gagal menyiapkan ZIP (server error ' + check.status + ')', true);
      return;
    }
  } catch {
    showToast('❌ Tidak dapat terhubung ke server', true);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = item.name + '.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('🗜 Menyiapkan ZIP "' + item.name + '"...');
}

// ===== Breadcrumb =====
function renderBreadcrumb(path) {
  breadcrumb.innerHTML = '';
  const homeBtn = document.createElement('span');
  homeBtn.className = 'breadcrumb-item';
  homeBtn.textContent = '🏠 Home';
  homeBtn.setAttribute('role', 'button');
  homeBtn.setAttribute('tabindex', '0');
  homeBtn.addEventListener('click', () => loadFiles(''));
  homeBtn.addEventListener('keydown', e => e.key === 'Enter' && loadFiles(''));
  breadcrumb.appendChild(homeBtn);

  if (!path) return;
  const parts = path.split('/').filter(Boolean);
  parts.forEach((part, idx) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = ' / ';
    breadcrumb.appendChild(sep);

    const isLast = idx === parts.length - 1;
    const span = document.createElement('span');
    span.textContent = part;
    if (isLast) {
      span.className = 'breadcrumb-current';
    } else {
      span.className = 'breadcrumb-item';
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      const targetPath = parts.slice(0, idx + 1).join('/');
      span.addEventListener('click', () => loadFiles(targetPath));
      span.addEventListener('keydown', e => e.key === 'Enter' && loadFiles(targetPath));
    }
    breadcrumb.appendChild(span);
  });
}

// ===== Player (streaming) =====
const playerOverlay = $('player-overlay');
const playerTitle   = $('player-title');
const playerPip     = $('player-pip');

let playerAbort = new AbortController();

// Buka player untuk format yang browser support (MP4, WebM, MP3, dll)
// atau format yang butuh transcode via /api/transcode (MKV, AVI, WMV, FLV, dll)
function openPlayer(item) {
  // Simpan posisi scroll daftar file agar bisa dikembalikan saat user menekan Kembali.
  state.scrollBeforePlayer = window.scrollY;

  state.currentPlayerItem = item;

  // Pilih URL stream berdasarkan format file
  const streamURL = pickStreamURL(item);

  playerAbort.abort();
  playerAbort = new AbortController();
  const sig = playerAbort.signal;

  const playerVideo     = $('player-video');
  const playerAudio     = $('player-audio');
  const playerAudioWrap = $('player-audio-wrap');
  const playerAudioTitle= $('player-audio-title');
  const playerSpinner   = $('player-spinner');
  const playerError     = $('player-error');
  const playerErrorMsg  = $('player-error-msg');

  // Reset state
  playerVideo.pause();
  playerAudio.pause();
  playerVideo.src = '';
  playerAudio.src = '';
  playerAudioWrap.classList.add('hidden');
  playerError.classList.add('hidden');
  playerSpinner.classList.remove('hidden');
  playerPip.classList.add('hidden');

  if (typeof resetCplayer === 'function') resetCplayer();

  playerTitle.textContent = item.name;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (typeof setPlayerItem === 'function') setPlayerItem(item, filePathOf(item));
  if (typeof setQueue === 'function') setQueue(state.allItems, item);

  // needs_transcode → HLS (timeline absolut). Probe isi totalDuration untuk progress bar.
  if (item.needs_transcode && item.streamable === 'video') {
    if (cplayer.state) cplayer.state.isHLS = true;
    if (typeof setTotalDuration === 'function') setTotalDuration(0, false);
    fetch('/api/probe?path=' + encodeURIComponent(filePathOf(item)))
      .then(r => r.ok ? r.json() : null)
      .then(probe => {
        if (!probe || !probe.duration) return;
        if (cplayer.state && cplayer.state.currentPath === filePathOf(item) && typeof setTotalDuration === 'function') {
          setTotalDuration(probe.duration, false);
        }
      })
      .catch(() => {});
  } else {
    if (typeof setTotalDuration === 'function') setTotalDuration(0, false);
  }

  if (!history.state || !history.state.player) {
    history.pushState({ player: true }, '');
  }

  if (item.streamable === 'video') {
    if (document.pictureInPictureEnabled) playerPip.classList.remove('hidden');

    playerVideo.addEventListener('leavepictureinpicture', () => {
      playerPip.innerHTML = '⧉'; playerPip.title = 'Picture in Picture';
    }, { signal: sig });
    playerVideo.addEventListener('enterpictureinpicture', () => {
      playerPip.innerHTML = '⊡'; playerPip.title = 'Keluar Picture in Picture';
    }, { signal: sig });

    playerVideo.addEventListener('canplay', () => {
      playerSpinner.classList.add('hidden');
      // Hapus pesan slow-transcode kalau ada
      const spinnerEl = $('player-spinner');
      if (spinnerEl) {
        const msg = spinnerEl.querySelector('.spinner-msg');
        if (msg) msg.remove();
      }
      playerVideo.play().catch(() => {});
    }, { once: true, signal: sig });

    // Untuk HEVC/transcode, tampilkan pesan informatif di spinner setelah 5 detik
    // agar user tahu ini normal, bukan hang.
    if (item.needs_transcode) {
      const slowTranscodeTimer = setTimeout(() => {
        const spinnerEl = $('player-spinner');
        if (spinnerEl && !spinnerEl.classList.contains('hidden') && !spinnerEl.querySelector('.spinner-msg')) {
          const msg = document.createElement('p');
          msg.className = 'spinner-msg';
          msg.textContent = 'Menyiapkan potongan video... (seek/resume pertama bisa 10–60 detik)';
          msg.style.cssText = 'color:#fff;font-size:.8rem;margin-top:8px;text-align:center;opacity:.8;padding:0 16px';
          spinnerEl.appendChild(msg);
        }
      }, 3000);
      playerAbort.signal.addEventListener('abort', () => clearTimeout(slowTranscodeTimer));
    }

    playerVideo.addEventListener('error', () => {
      playerSpinner.classList.add('hidden');
      const code = playerVideo.error?.code;
      const ext = (item.ext || '').toLowerCase();
      const isChunked = streamURL.startsWith('/api/hls') || streamURL.startsWith('/api/transcode');
      let msg;
      if (isChunked) {
        msg = 'Format ini tidak bisa diputar di browser. Server kamu mungkin belum punya ffmpeg, atau file rusak.';
      } else if (code === 4 && (ext === 'mkv' || ext === 'avi' || ext === 'wmv' || ext === 'flv')) {
        msg = `Format ${ext.toUpperCase()} tidak didukung browser ini. Coba Chrome Android atau download ke VLC/MX Player.`;
      } else {
        switch (code) {
          case 1: msg = 'Pemutaran dibatalkan.'; break;
          case 2: msg = 'Koneksi terputus. Cek WiFi.'; break;
          case 3: msg = 'File rusak atau codec tidak didukung browser ini.'; break;
          case 4: msg = 'Format video tidak didukung browser ini.'; break;
          default: msg = 'Gagal memutar video.';
        }
      }
      if (playerErrorMsg) playerErrorMsg.textContent = msg;
      if (playerError) playerError.classList.remove('hidden');
    }, { once: true, signal: sig });

    if (item.needs_transcode && !sessionStorage.getItem('cp_transcodeHint')) {
      sessionStorage.setItem('cp_transcodeHint', '1');
      setTimeout(() => showToast('🎬 Streaming potongan HLS... segment pertama bisa 10–30 detik.'), 500);
    }

    if (streamURL.startsWith('/api/hls') && typeof attachHLSSource === 'function') {
      // resumeAt: startPosition di hls.js → minta segmen 1:33 dulu, bukan seg 0
      const path = filePathOf(item);
      let resumeAt = 0;
      const hist = window.watchHistoryByPath?.[path];
      if (hist && !hist.completed) resumeAt = hist.position_sec || 0;
      if (!resumeAt) resumeAt = parseFloat(localStorage.getItem('cp_pos_' + path) || '0') || 0;
      attachHLSSource(streamURL, { autoplay: true, resumeAt: resumeAt > 5 ? resumeAt : undefined });
    } else {
      playerVideo.src = streamURL;
      playerVideo.load();
    }

    // Setup subtitle DITUNDA sampai video benar-benar mulai play.
    //
    // Alasan (fix buffering di HP via WiFi):
    //   - Browser HP hanya punya buffer 5–15 detik. Kalau subtitle fetch dimulai
    //     bersamaan dengan transcode stream, bandwidth WiFi terbagi → buffer kosong
    //     → video freeze.
    //   - Pakai event 'playing' (BUKAN 'canplay') karena 'canplay' fire saat baru
    //     cukup untuk 1 frame, sedangkan 'playing' fire saat playback benar-benar
    //     berjalan dan buffer sudah mulai terisi.
    //   - Delay tambahan 1.5 detik memberi waktu buffer video stabil sebelum
    //     subtitle fetch ikut antri di koneksi WiFi.
    //   - Tradeoff: subtitle muncul ~2–4 detik lebih lambat — jauh lebih bisa
    //     diterima daripada video buffering berkali-kali.
    playerVideo.addEventListener('playing', () => {
      const delayTimer = setTimeout(() => {
        if (typeof setupSubtitle === 'function') setupSubtitle(item, filePathOf);
      }, 1500);
      // Batalkan kalau player ditutup sebelum 1.5 detik habis
      sig.addEventListener('abort', () => clearTimeout(delayTimer));
    }, { once: true, signal: sig });

  } else if (item.streamable === 'audio') {
    playerAudioTitle.textContent = item.name;
    playerAudioWrap.classList.remove('hidden');

    playerAudio.addEventListener('canplay', () => {
      playerSpinner.classList.add('hidden');
    }, { once: true, signal: sig });

    playerAudio.addEventListener('error', () => {
      playerAudioWrap.classList.add('hidden');
      playerSpinner.classList.add('hidden');
      const code = playerAudio.error?.code;
      let msg;
      switch (code) {
        case 2: msg = 'Koneksi terputus. Cek WiFi.'; break;
        case 3: msg = 'File rusak atau codec tidak didukung.'; break;
        case 4: msg = 'Format audio tidak didukung browser ini.'; break;
        default: msg = 'Gagal memutar audio.';
      }
      if (playerErrorMsg) playerErrorMsg.textContent = msg;
      if (playerError) playerError.classList.remove('hidden');
    }, { once: true, signal: sig });

    playerAudio.src = streamURL;
    playerAudio.load();
    playerAudio.play().catch(() => {});
  }
}

// ===== Pemilihan URL Stream =====

// pickStreamURL: needs_transcode → HLS playlist; native → /api/stream
function pickStreamURL(item) {
  if (item.needs_transcode) {
    return '/api/hls/playlist?path=' + encodeURIComponent(filePathOf(item));
  }
  return '/api/stream?path=' + encodeURIComponent(filePathOf(item));
}

function closePlayer() {
  // Keluar fullscreen dulu kalau sedang fullscreen (mis. ditutup saat masih fullscreen).
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }

  // Sync history sebelum tutup player
  if (typeof syncHistoryNow === 'function') syncHistoryNow();

  playerAbort.abort();
  playerAbort = new AbortController();
  const playerVideo = $('player-video');
  const playerAudio = $('player-audio');
  playerVideo.pause();
  playerAudio.pause();
  playerVideo.src = '';
  playerAudio.src = '';
  if (typeof resetCplayer === 'function') resetCplayer();
  playerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  state.currentPlayerItem = null;

  // Refresh history cache dan re-render file list agar progress bar up-to-date
  loadHistoryCache().then(() => {
    if (state.allItems.length > 0) renderFiles(state.allItems);
    // Kembalikan scroll ke posisi sebelum video dibuka (setelah daftar di-render ulang).
    if (typeof state.scrollBeforePlayer === 'number') {
      window.scrollTo(0, state.scrollBeforePlayer);
    }
  });
}

// ===== Download =====
function downloadFile(item) {
  if (!item) return;
  const url = '/api/download?path=' + encodeURIComponent(filePathOf(item));
  const a = document.createElement('a');
  a.href = url;
  a.download = item.name;
  a.click();
}

// ===== Upload =====
const uploadProgressContainer = $('upload-progress-container');

// formatSpeed: bytes/detik → string human-readable.
function formatSpeed(bps) {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}

// formatBytes: bytes → string human-readable.
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// createUploadItem membuat 1 baris UI progress dan return helper functions.
function createUploadItem(file) {
  uploadProgressContainer.classList.remove('hidden');
  const el = document.createElement('div');
  el.className = 'upload-item';
  el.innerHTML = `
    <div class="upload-item-header">
      <span class="upload-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      <button class="upload-item-cancel" title="Batalkan">✕</button>
    </div>
    <div class="upload-item-bar"><div class="upload-item-bar-fill" style="width:0%"></div></div>
    <div class="upload-item-meta"><span class="upload-item-status">Menunggu...</span><span class="upload-item-size">${formatBytes(file.size)}</span></div>
  `;
  uploadProgressContainer.appendChild(el);
  const fill      = el.querySelector('.upload-item-bar-fill');
  const status    = el.querySelector('.upload-item-status');
  const cancelBtn = el.querySelector('.upload-item-cancel');
  return {
    el,
    setProgress(loaded, speed) {
      const pct = file.size > 0 ? (loaded / file.size) * 100 : 0;
      fill.style.width = `${pct.toFixed(1)}%`;
      status.textContent = `${pct.toFixed(0)}% • ${formatSpeed(speed)}`;
    },
    setSuccess(name) {
      el.classList.add('success');
      fill.style.width = '100%';
      status.textContent = `✓ ${name}`;
      cancelBtn.style.display = 'none';
      setTimeout(() => {
        el.remove();
        if (uploadProgressContainer.children.length === 0) {
          uploadProgressContainer.classList.add('hidden');
        }
      }, 4000);
    },
    setError(msg) {
      el.classList.add('error');
      status.textContent = `✗ ${msg}`;
    },
    onCancel(fn) { cancelBtn.addEventListener('click', fn); },
  };
}

// uploadOne mengirim satu file dengan XHR agar dapat progress event.
function uploadOne(file, targetPath) {
  return new Promise((resolve) => {
    const ui = createUploadItem(file);
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    const startTime = Date.now();
    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? e.loaded / elapsed : 0;
      ui.setProgress(e.loaded, speed);
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        const r = (data.results && data.results[0]) || {};
        if (xhr.status >= 200 && xhr.status < 300 && r.ok) {
          ui.setSuccess(r.name || file.name);
          resolve({ ok: true });
        } else {
          ui.setError(r.error || `HTTP ${xhr.status}`);
          resolve({ ok: false });
        }
      } catch {
        ui.setError(`HTTP ${xhr.status}`);
        resolve({ ok: false });
      }
    });
    xhr.addEventListener('error', () => { ui.setError('Koneksi error'); resolve({ ok: false }); });
    xhr.addEventListener('abort', () => { ui.setError('Dibatalkan'); resolve({ ok: false }); });
    ui.onCancel(() => xhr.abort());

    xhr.open('POST', '/api/upload?path=' + encodeURIComponent(targetPath));
    xhr.send(formData);
  });
}

async function uploadFiles(files, targetPath) {
  // Concurrency 3 — jangan terlalu banyak agar tidak saturate LAN.
  const queue = Array.from(files);
  const concurrency = 3;
  let success = 0;
  let fail = 0;

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      const r = await uploadOne(file, targetPath);
      if (r.ok) success++; else fail++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  if (success > 0) showToast(`✅ ${success} file berhasil diupload`);
  if (fail > 0) showToast(`❌ ${fail} file gagal`, true);
  loadFiles(state.currentPath);
}

// ===== PIN Login =====
async function checkAuth() {
  // Pisahkan fetch dari parse agar setiap kondisi selalu menampilkan UI (tidak blank).
  let res;
  try {
    res = await fetch('/api/files?path=');
  } catch (err) {
    console.error('checkAuth network error:', err);
    showApp();
    showError('Tidak dapat terhubung ke server.');
    return;
  }

  if (res.status === 401) {
    showLoginScreen();
    return;
  }

  showApp();
  try {
    const data = await res.json();
    state.allItems = data.items || [];
    renderBreadcrumb(data.path || '');
    renderFiles(state.allItems);
  } catch (err) {
    console.error('checkAuth parse error:', err);
    showError('Response server tidak valid.');
  }
}

function showLoginScreen() {
  loginScreen.classList.remove('hidden');
  appEl.classList.add('hidden');
  const firstDigit = document.querySelector('.pin-digit');
  if (firstDigit) firstDigit.focus();
}

function showApp() {
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
}

async function submitPIN() {
  const digits = document.querySelectorAll('.pin-digit');
  const pin = Array.from(digits).map(d => d.value).join('');
  if (pin.length < 4) return;

  const btnLogin = $('btn-login');
  btnLogin.disabled = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();

    if (res.status === 429) {
      const secs = data.retry_after || 300;
      const mins = Math.ceil(secs / 60);
      $('pin-error').textContent = `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`;
      $('pin-error').classList.remove('hidden');
      digits.forEach(d => { d.value = ''; d.disabled = true; });
      setTimeout(() => {
        digits.forEach(d => { d.disabled = false; });
        btnLogin.disabled = false;
        $('pin-error').classList.add('hidden');
        digits[0].focus();
      }, secs * 1000);
      return;
    }

    if (data.ok) {
      showApp();
      loadFiles('');
    } else {
      $('pin-error').textContent = 'PIN salah, coba lagi.';
      $('pin-error').classList.remove('hidden');
      digits.forEach(d => { d.value = ''; });
      digits[0].focus();
      btnLogin.disabled = false;
    }
  } catch {
    $('pin-error').textContent = 'Tidak dapat terhubung ke server.';
    $('pin-error').classList.remove('hidden');
    btnLogin.disabled = false;
  }
}

// ===== UI helpers =====
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
}

let toastTimer = null;
function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.background = isError ? 'var(--danger)' : '';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ===== Event Listeners =====

// Header actions
$('btn-refresh').addEventListener('click', () => loadFiles(state.currentPath));
$('btn-upload').addEventListener('click', () => openUploadMenu());

// Upload menu: pilih jenis file
function openUploadMenu() {
  const uploadMenuEl = $('upload-menu');
  if (uploadMenuEl) {
    uploadMenuEl.classList.toggle('hidden');
  } else {
    // Fallback: langsung buka picker semua file
    uploadInput.click();
  }
}

// Tutup upload menu saat klik di luar
document.addEventListener('click', (e) => {
  const uploadMenuEl = $('upload-menu');
  if (uploadMenuEl && !uploadMenuEl.classList.contains('hidden')) {
    if (!e.target.closest('#upload-menu') && !e.target.closest('#btn-upload')) {
      uploadMenuEl.classList.add('hidden');
    }
  }
});

const uploadInputMedia = $('upload-input-media');

uploadInput.addEventListener('change', () => {
  if (uploadInput.files.length > 0) {
    uploadFiles(uploadInput.files, state.currentPath);
    uploadInput.value = '';
  }
});

if (uploadInputMedia) {
  uploadInputMedia.addEventListener('change', () => {
    if (uploadInputMedia.files.length > 0) {
      uploadFiles(uploadInputMedia.files, state.currentPath);
      uploadInputMedia.value = '';
    }
  });
}

// Tombol "Semua File" di upload menu
const btnUploadAll = $('btn-upload-all');
if (btnUploadAll) {
  btnUploadAll.addEventListener('click', () => {
    $('upload-menu').classList.add('hidden');
    uploadInput.click();
  });
}

// Tombol "Foto & Video" di upload menu
const btnUploadMedia = $('btn-upload-media');
if (btnUploadMedia) {
  btnUploadMedia.addEventListener('click', () => {
    $('upload-menu').classList.add('hidden');
    if (uploadInputMedia) uploadInputMedia.click();
    else uploadInput.click();
  });
}

// Tombol "Buat Folder Baru" di upload menu
const btnMkdir = $('btn-mkdir');
if (btnMkdir) {
  btnMkdir.addEventListener('click', async () => {
    $('upload-menu').classList.add('hidden');
    const name = prompt('Nama folder baru:');
    if (!name || !name.trim()) return;
    try {
      const res = await apiFetch(
        '/api/mkdir?path=' + encodeURIComponent(state.currentPath) +
        '&name=' + encodeURIComponent(name.trim()),
        { method: 'POST' }
      );
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast('📁 Folder "' + name.trim() + '" dibuat');
        loadFiles(state.currentPath);
      } else if (res.status === 409) {
        // #8: server pakai os.Mkdir — 409 = folder sudah ada
        showToast('⚠️ Folder "' + name.trim() + '" sudah ada', true);
      } else {
        showToast('❌ ' + (data.error || 'Gagal membuat folder'), true);
      }
    } catch {
      showToast('❌ Tidak dapat terhubung ke server', true);
    }
  });
}

// Sortir
const sortBySel = $('sort-by');
const sortDirBtn = $('sort-dir');
if (sortBySel) {
  sortBySel.value = state.sortBy;
  sortBySel.addEventListener('change', () => {
    state.sortBy = sortBySel.value;
    localStorage.setItem('sort_by', state.sortBy);
    renderFiles(state.allItems);
  });
}
if (sortDirBtn) {
  sortDirBtn.textContent = state.sortDir === 'asc' ? '↑' : '↓';
  sortDirBtn.setAttribute('title', state.sortDir === 'asc' ? 'Urutan naik' : 'Urutan turun');
  sortDirBtn.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    localStorage.setItem('sort_dir', state.sortDir);
    sortDirBtn.textContent = state.sortDir === 'asc' ? '↑' : '↓';
    sortDirBtn.setAttribute('title', state.sortDir === 'asc' ? 'Urutan naik' : 'Urutan turun');
    renderFiles(state.allItems);
  });
}

// Action sheet: tutup via backdrop & tombol batal
if (actionSheet) {
  const backdrop = actionSheet.querySelector('.action-sheet-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeActionSheet);
  const cancelBtn = $('action-sheet-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeActionSheet);
}

// #10: toggle "Folder di atas" di Settings
const btnFoldersFirst = $('btn-folders-first');
const foldersFirstLabel = $('folders-first-label');
function updateFoldersFirstUI() {
  if (foldersFirstLabel) foldersFirstLabel.textContent = state.foldersFirst ? 'Aktif' : 'Nonaktif';
  if (btnFoldersFirst) btnFoldersFirst.classList.toggle('btn-primary', state.foldersFirst);
  if (btnFoldersFirst) btnFoldersFirst.classList.toggle('btn-secondary', !state.foldersFirst);
}
updateFoldersFirstUI();
if (btnFoldersFirst) {
  btnFoldersFirst.addEventListener('click', () => {
    state.foldersFirst = !state.foldersFirst;
    localStorage.setItem('folders_first', state.foldersFirst ? 'true' : 'false');
    updateFoldersFirstUI();
    renderFiles(state.allItems);
  });
}

// Search
searchInput.addEventListener('input', () => {
  state.searchQuery = searchInput.value;
  renderFiles(state.allItems);
});

// Player: close
$('player-close').addEventListener('click', () => {
  closePlayer();
  if (history.state && history.state.player) history.back();
});

// Player: tombol download di header
$('player-download').addEventListener('click', () => {
  if (state.currentPlayerItem) {
    downloadFile(state.currentPlayerItem);
    showToast('⬇ Mendownload "' + state.currentPlayerItem.name + '"');
  }
});

// Player: tombol download di error state (format tidak didukung)
$('player-error-download').addEventListener('click', () => {
  if (state.currentPlayerItem) {
    downloadFile(state.currentPlayerItem);
    showToast('⬇ Mendownload "' + state.currentPlayerItem.name + '"');
  }
});

// Player: tombol salin link untuk VLC / MX Player
$('player-error-native').addEventListener('click', () => {
  if (!state.currentPlayerItem) return;
  const url = location.origin + '/api/stream?path=' + encodeURIComponent(filePathOf(state.currentPlayerItem));
  copyToClipboard(url);
  showToast('🔗 Link disalin. Buka VLC → Stream → paste link.');
});

function copyToClipboard(text) {
  if (navigator.clipboard && location.protocol === 'https:') {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  // Fallback untuk HTTP (LAN biasanya non-HTTPS)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
}

// Player: PiP
playerPip.addEventListener('click', async () => {
  const playerVideo = $('player-video');
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await playerVideo.requestPictureInPicture();
    }
  } catch {
    showToast('PiP tidak didukung di browser ini', true);
  }
});

// Tombol back fisik HP
window.addEventListener('popstate', () => {
  // #7: back button tutup action sheet dulu sebelum player
  if (actionSheet && !actionSheet.classList.contains('hidden')) {
    closeActionSheet();
    return;
  }
  if (!playerOverlay.classList.contains('hidden')) closePlayer();
});

// Keyboard shortcuts global
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // #7: Escape tutup action sheet dulu
    if (actionSheet && !actionSheet.classList.contains('hidden')) {
      closeActionSheet();
      return;
    }
    if (!playerOverlay.classList.contains('hidden')) closePlayer();
  }
});

// PIN inputs
document.querySelectorAll('.pin-digit').forEach((input, idx, all) => {
  input.addEventListener('input', () => {
    if (input.value && idx < all.length - 1) all[idx + 1].focus();
    if (Array.from(all).every(d => d.value)) submitPIN();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) all[idx - 1].focus();
  });
});
$('btn-login').addEventListener('click', submitPIN);

// ===== Watch History =====

window.watchHistoryByPath = {}; // cache: { "<rel-path>": Entry }

async function loadHistoryCache() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) { window.watchHistoryByPath = {}; return; }
    const list = await res.json();
    window.watchHistoryByPath = {};
    for (const e of (list || [])) {
      window.watchHistoryByPath[e.path] = e;
    }
  } catch (_) {
    window.watchHistoryByPath = {};
  }
}

async function renderHistory() {
  const ul = $('history-list');
  const emptyEl = $('history-empty');
  if (!ul) return;
  ul.innerHTML = '';
  await loadHistoryCache();
  const list = Object.values(window.watchHistoryByPath || {}).sort((a, b) =>
    new Date(b.watched_at) - new Date(a.watched_at)
  ).slice(0, 5); // BATASI HANYA 5 RIWAYAT TERAKHIR
  if (list.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  const frag = document.createDocumentFragment();
  for (const e of list) {
    const li = document.createElement('li');
    li.className = 'file-item';
    const pct = e.duration_sec > 0
      ? Math.min(100, (e.position_sec / e.duration_sec) * 100)
      : 0;
    const remainSec = Math.max(0, e.duration_sec - e.position_sec);
    const meta = e.completed
      ? '✓ Selesai'
      : `⏱ ${formatTimeShort(e.position_sec)} / ${formatTimeShort(e.duration_sec)} · sisa ${formatTimeShort(remainSec)}`;
    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">🎬</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(e.name)}</div>
        <div class="file-meta">${escapeHtml(e.path)}</div>
        <div class="file-meta">${meta}</div>
        <div class="watch-progress"><div class="watch-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
      </div>
      <button class="icon-btn history-delete-btn" data-path="${escapeHtml(e.path)}" title="Hapus dari riwayat" aria-label="Hapus dari riwayat">✕</button>
    `;
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('.history-delete-btn')) return;
      openPlayerFromHistory(e);
    });
    li.querySelector('.history-delete-btn').addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (!confirm('Hapus "' + e.name + '" dari riwayat?')) return;
      await fetch('/api/history/delete?path=' + encodeURIComponent(e.path), { method: 'DELETE' });
      renderHistory();
    });
    frag.appendChild(li);
  }
  ul.appendChild(frag);
}

function formatTimeShort(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = (m % 60).toString().padStart(2, '0');
    return `${h}:${mm}:${s}`;
  }
  return `${m}:${s}`;
}

// openPlayerFromHistory: buka player dari entry history tanpa item lengkap dari API.
async function openPlayerFromHistory(entry) {
  const ext = (entry.path.split('.').pop() || '').toLowerCase();
  const fakeItem = {
    name: entry.name,
    is_dir: false,
    ext,
    streamable: 'video',
    needs_transcode: ['mkv', 'avi', 'wmv', 'flv', 'ts'].includes(ext),
    has_subtitle: false,
  };
  // Navigate ke folder dulu agar state.allItems, breadcrumb, dan currentPath benar.
  // Ini juga memastikan queue (prev/next) terisi dengan file di folder yang sama.
  const slash = entry.path.lastIndexOf('/');
  const dir = slash >= 0 ? entry.path.slice(0, slash) : '';
  await loadFiles(dir);
  playItem(fakeItem);
}

// ===== Init =====
if (typeof initCplayer === 'function') initCplayer();
checkAuth();

// History clear button
const btnHistoryClear = $('btn-history-clear');
if (btnHistoryClear) {
  btnHistoryClear.addEventListener('click', async () => {
    if (!confirm('Hapus semua riwayat tontonan?')) return;
    await fetch('/api/history/clear', { method: 'POST' });
    renderHistory();
  });
}

// ===== Drag & Drop Upload =====
const dropOverlay = $('dropzone-overlay');
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
  if (activeTab !== 'home') return;
  if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
  dragCounter++;
  if (dropOverlay) dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragleave', () => {
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0 && dropOverlay) dropOverlay.classList.add('hidden');
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  if (dropOverlay) dropOverlay.classList.add('hidden');
  if (activeTab !== 'home') return;
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length > 0) uploadFiles(files, state.currentPath);
});
