'use strict';

// ===== State =====
const state = {
  currentPath: '',
  searchQuery: '',
  allItems: [],
  selectedFile: null,
};

// ===== DOM refs =====
const $ = (id) => document.getElementById(id);
const loginScreen   = $('login-screen');
const appEl         = $('app');
const fileList      = $('file-list');
const spinner       = $('spinner');
const errorBox      = $('error-box');
const emptyMsg      = $('empty-msg');
const breadcrumb    = $('breadcrumb');
const searchInput   = $('search-input');
const modalOverlay  = $('modal-overlay');
const modalApps     = $('modal-apps');
const modalFilename = $('modal-filename');
const btnDownload   = $('btn-download');
const toast         = $('toast');
const uploadInput   = $('upload-input');

// ===== Emoji icons =====
const EXT_ICONS = {
  mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',  mp3: '🎵', flac: '🎵', wav: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== Path helper =====
// Menggabungkan currentPath + nama file menjadi relative path untuk API.
function filePathOf(item) {
  return state.currentPath ? state.currentPath + '/' + item.name : item.name;
}

// ===== API helpers =====
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    location.reload();
    throw new Error('Unauthorized');
  }
  return res;
}

// ===== File loading =====
async function loadFiles(relPath = '') {
  state.currentPath = relPath;
  state.searchQuery = '';
  searchInput.value = '';

  showSpinner(true);
  hideError();
  fileList.innerHTML = '';
  emptyMsg.classList.add('hidden');

  try {
    const res = await apiFetch('/api/files?path=' + encodeURIComponent(relPath));
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Gagal memuat file.');
      return;
    }

    state.allItems = data.items || [];
    renderBreadcrumb(data.path || '');
    renderFiles(state.allItems);
  } catch (err) {
    showError('Tidak dapat terhubung ke server. Pastikan server berjalan.');
  } finally {
    showSpinner(false);
  }
}

function renderFiles(items) {
  fileList.innerHTML = '';

  const q = state.searchQuery.toLowerCase();
  const filtered = q
    ? items.filter(i => i.name.toLowerCase().includes(q))
    : items;

  filtered.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, 'id');
  });

  if (filtered.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const item of filtered) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.setAttribute('role', 'listitem');

    const meta = item.is_dir
      ? 'Folder'
      : [formatSize(item.size), formatDate(item.mod_time)].filter(Boolean).join(' · ');

    // Badge "streamable" di sebelah nama file
    const streamBadge = item.streamable
      ? `<span class="stream-badge">${item.streamable === 'video' ? '▶ Video' : '♪ Audio'}</span>`
      : (item.native_play ? `<span class="native-badge">📲 App</span>` : '');

    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">${getIcon(item)}</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(item.name)}${streamBadge}</div>
        <div class="file-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="file-arrow" aria-hidden="true">${item.is_dir ? '›' : '⋯'}</span>
    `;

    li.addEventListener('click', () => {
      if (item.is_dir) {
        loadFiles(state.currentPath ? state.currentPath + '/' + item.name : item.name);
      } else {
        openFileModal(item);
      }
    });

    frag.appendChild(li);
  }
  fileList.appendChild(frag);
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

// ===== Modal "Open With" =====
async function openFileModal(item) {
  state.selectedFile = item;
  modalFilename.textContent = item.name;
  modalApps.innerHTML = '<div class="spinner"><div class="spinner-ring"></div></div>';
  modalOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const res = await apiFetch('/api/apps?ext=' + encodeURIComponent(item.ext || ''));
    const appList = await res.json();

    modalApps.innerHTML = '';

    // ── Tombol "Putar di Browser" (hanya untuk file browser-streamable) ──
    if (item.streamable) {
      const streamBtn = document.createElement('button');
      streamBtn.className = 'btn-stream';
      const icon = item.streamable === 'video' ? '▶' : '♪';
      const label = item.streamable === 'video' ? 'Putar Video di HP' : 'Putar Audio di HP';
      streamBtn.innerHTML = `<span class="btn-stream-icon">${icon}</span><span>${label}</span>`;
      streamBtn.addEventListener('click', () => {
        closeModal();
        openPlayer(item);
      });
      modalApps.appendChild(streamBtn);
    }

    // ── Tombol "Buka dengan App di HP" (untuk semua file native_play) ──
    if (item.native_play) {
      const hpBtn = document.createElement('button');
      hpBtn.className = 'btn-stream-secondary';
      hpBtn.innerHTML = '<span class="btn-stream-icon">📲</span><span>Buka dengan App di HP</span>';
      hpBtn.addEventListener('click', () => {
        closeModal();
        openHpAppsModal(item);
      });
      modalApps.appendChild(hpBtn);
    }

    // Divider sebelum daftar app laptop (hanya jika ada tombol stream di atas)
    if (item.streamable || item.native_play) {
      const divider = document.createElement('div');
      divider.className = 'modal-divider';
      const dividerLabel = document.createElement('p');
      dividerLabel.className = 'modal-divider-label';
      dividerLabel.textContent = 'Atau buka di laptop:';
      modalApps.appendChild(divider);
      modalApps.appendChild(dividerLabel);
    }

    // ── Daftar app laptop ──
    if (!appList || appList.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-muted);font-size:.9rem';
      p.textContent = 'Tidak ada aplikasi terdaftar.';
      modalApps.appendChild(p);
    } else {
      for (const app of appList) {
        const btn = document.createElement('button');
        btn.className = 'app-btn';
        btn.innerHTML = `<span class="app-btn-icon">🖥️</span><span>${escapeHtml(app.name)}</span>`;
        btn.addEventListener('click', () => openWith(app.id, item));
        modalApps.appendChild(btn);
      }
    }
  } catch {
    modalApps.innerHTML = '<p style="color:var(--danger)">Gagal memuat daftar aplikasi.</p>';
  }
}

async function openWith(appId, item) {
  closeModal();
  try {
    const res = await apiFetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, path: filePathOf(item) }),
    });
    const data = await res.json();
    if (data.ok) {
      showToast('✅ File dibuka di laptop');
    } else {
      showToast('❌ ' + (data.error || 'Gagal membuka file'), true);
    }
  } catch {
    showToast('❌ Tidak dapat terhubung ke server', true);
  }
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  document.body.style.overflow = '';
  state.selectedFile = null;
}

// ===== Sub-Modal "Buka dengan App di HP" =====

function getStreamUrl(item) {
  // URL absolute menggunakan location.origin (berisi IP LAN + port saat diakses dari HP)
  return location.origin + '/api/stream?path=' + encodeURIComponent(filePathOf(item));
}

function getPlaylistUrl(item) {
  return '/api/playlist?path=' + encodeURIComponent(filePathOf(item));
}

function openHpAppsModal(item) {
  state.selectedFile = item;
  $('hp-apps-filename').textContent = item.name;

  // Tampilkan tombol Share hanya jika Web Share API tersedia (Chrome/Safari Android/iOS)
  const shareBtn = $('btn-hp-share');
  shareBtn.classList.toggle('hidden', !('share' in navigator));

  $('hp-apps-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeHpAppsModal() {
  $('hp-apps-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function handleHpAppAction(action, item) {
  if (action === 'playlist') {
    // Download file .m3u — user buka di app pilihan
    const a = document.createElement('a');
    a.href = getPlaylistUrl(item);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('📥 Playlist diunduh — buka untuk pilih aplikasi');
    closeHpAppsModal();

  } else if (action === 'share') {
    // Web Share API — dialog share native HP
    try {
      await navigator.share({
        title: item.name,
        text: 'Stream dari LAN Hub',
        url: getStreamUrl(item),
      });
      closeHpAppsModal();
    } catch (e) {
      if (e.name !== 'AbortError') {
        showToast('Gagal berbagi link', true);
      }
    }

  } else if (action === 'copy') {
    const url = getStreamUrl(item);
    try {
      await navigator.clipboard.writeText(url);
      showToast('✅ Link disalin ke clipboard');
    } catch {
      // Fallback: navigator.clipboard tidak tersedia di HTTP non-secure
      showCopyFallbackModal(url);
    }
    closeHpAppsModal();
  }
}

// Tahap 4: Fallback clipboard untuk browser yang block navigator.clipboard di HTTP
function showCopyFallbackModal(url) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '500';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Salin Link Manual</h2>
        <button class="icon-btn" id="copy-fallback-close">✕</button>
      </div>
      <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:4px">
        Browser tidak izinkan auto-copy. Tap teks di bawah, pilih semua, lalu copy:
      </p>
      <textarea readonly class="copy-fallback-text">${escapeHtml(url)}</textarea>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const textarea = overlay.querySelector('textarea');
  // Auto-select saat focus (memudahkan user di mobile)
  textarea.addEventListener('focus', () => {
    textarea.select();
    // iOS workaround
    textarea.setSelectionRange(0, 99999);
  });
  // Focus otomatis
  setTimeout(() => textarea.focus(), 50);

  overlay.querySelector('#copy-fallback-close').addEventListener('click', () => {
    overlay.remove();
    document.body.style.overflow = '';
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      document.body.style.overflow = '';
    }
  });
}

// Event listener sub-modal HP apps (delegasi ke data-action)
$('hp-apps-overlay').addEventListener('click', (e) => {
  if (e.target === $('hp-apps-overlay')) {
    closeHpAppsModal();
    return;
  }
  const btn = e.target.closest('[data-action]');
  if (btn && state.selectedFile) {
    handleHpAppAction(btn.dataset.action, state.selectedFile);
  }
});
$('hp-apps-close').addEventListener('click', closeHpAppsModal);

// ===== Player (streaming) =====
const playerOverlay = $('player-overlay');
const playerTitle   = $('player-title');
const playerPip     = $('player-pip');

// AbortController untuk batalkan listener lama saat player dibuka ulang
let playerAbort = new AbortController();

function openPlayer(item) {
  const url = '/api/stream?path=' + encodeURIComponent(filePathOf(item));

  // Batalkan listener sesi sebelumnya
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

  // Reset custom player state
  if (typeof resetCplayer === 'function') resetCplayer();

  playerTitle.textContent = item.name;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // History entry untuk tombol back HP
  history.pushState({ player: true }, '');

  if (item.streamable === 'video') {
    // Setup subtitle sebelum load video
    if (typeof setupSubtitle === 'function') {
      setupSubtitle(item, filePathOf);
    }

    // PiP button
    if (document.pictureInPictureEnabled) {
      playerPip.classList.remove('hidden');
    }
    playerVideo.addEventListener('leavepictureinpicture', () => {
      playerPip.textContent = '⧉';
      playerPip.title = 'Picture in Picture';
    }, { signal: sig });
    playerVideo.addEventListener('enterpictureinpicture', () => {
      playerPip.textContent = '⊡';
      playerPip.title = 'Keluar Picture in Picture';
    }, { signal: sig });

    // Error handler (cplayer juga punya, tapi ini untuk overlay error)
    playerVideo.addEventListener('error', () => {
      playerSpinner.classList.add('hidden');
      const code = playerVideo.error?.code;
      let msg;
      switch (code) {
        case 1: msg = 'Pemutaran dibatalkan.'; break;
        case 2: msg = 'Koneksi terputus. Cek WiFi.'; break;
        case 3: msg = 'File rusak atau codec tidak didukung browser ini.'; break;
        case 4: msg = 'Format video tidak didukung browser ini. Coba "Buka dengan App di HP".'; break;
        default: msg = 'Gagal memutar video.';
      }
      if (playerErrorMsg) playerErrorMsg.textContent = msg;
      if (playerError) playerError.classList.remove('hidden');
    }, { signal: sig });

    playerVideo.src = url;
    playerVideo.load();

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

    playerAudio.src = url;
    playerAudio.load();
    playerAudio.play().catch(() => {});
  }
}

function closePlayer() {
  playerAbort.abort();
  playerAbort = new AbortController();

  const playerVideo = $('player-video');
  const playerAudio = $('player-audio');
  playerVideo.pause();
  playerAudio.pause();
  playerVideo.src = '';
  playerAudio.src = '';

  // Reset custom player
  if (typeof resetCplayer === 'function') resetCplayer();

  playerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// Tombol close player
$('player-close').addEventListener('click', () => {
  closePlayer();
  if (history.state && history.state.player) history.back();
});

// Tombol back fisik HP
window.addEventListener('popstate', () => {
  if (!playerOverlay.classList.contains('hidden')) {
    closePlayer();
  }
});

// Picture-in-Picture
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

// Poin #4: AbortController untuk batalkan listener lama saat player dibuka ulang.
// Mencegah race condition: listener 'error' lama fire saat src di-clear.
let playerAbort = new AbortController();

function openPlayer(item) {
  const url = '/api/stream?path=' + encodeURIComponent(filePathOf(item));

  // Batalkan semua listener dari sesi player sebelumnya
  playerAbort.abort();
  playerAbort = new AbortController();
  const sig = playerAbort.signal;

  // Reset semua state player
  playerVideo.pause();
  playerAudio.pause();
  playerVideo.src = '';
  playerAudio.src = '';
  playerVideo.classList.add('hidden');
  playerAudioWrap.classList.add('hidden');
  playerError.classList.add('hidden');
  playerSpinner.classList.remove('hidden');
  playerPip.classList.add('hidden');

  playerTitle.textContent = item.name;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Tambah history entry supaya tombol back HP menutup player
  history.pushState({ player: true }, '');

  if (item.streamable === 'video') {
    playerVideo.classList.remove('hidden');

    // Tampilkan PiP button jika browser mendukung
    if (document.pictureInPictureEnabled) {
      playerPip.classList.remove('hidden');
    }

    // Pasang listener dengan signal — otomatis di-remove saat playerAbort.abort()
    playerVideo.addEventListener('canplay', onVideoCanPlay, { once: true, signal: sig });
    playerVideo.addEventListener('error', onVideoError, { once: true, signal: sig });

    // Poin #14: update PiP button saat user keluar dari PiP
    playerVideo.addEventListener('leavepictureinpicture', () => {
      playerPip.textContent = '⧉';
      playerPip.title = 'Picture in Picture';
    }, { signal: sig });
    playerVideo.addEventListener('enterpictureinpicture', () => {
      playerPip.textContent = '⊡';
      playerPip.title = 'Keluar Picture in Picture';
    }, { signal: sig });

    playerVideo.src = url;
    playerVideo.load();

  } else if (item.streamable === 'audio') {
    playerAudioTitle.textContent = item.name;
    playerAudioWrap.classList.remove('hidden');

    // Poin #9: audio juga punya loading state — spinner tetap tampil sampai canplay
    playerAudio.addEventListener('canplay', onAudioCanPlay, { once: true, signal: sig });
    playerAudio.addEventListener('error', onAudioError, { once: true, signal: sig });

    playerAudio.src = url;
    playerAudio.load();
    playerAudio.play().catch(() => { /* autoplay blocked — user tap play */ });
  }
}

function onVideoCanPlay() {
  playerSpinner.classList.add('hidden');
  playerVideo.play().catch(() => { /* autoplay blocked */ });
}

// Poin #10: diagnostic error berdasarkan MediaError.code
function onVideoError() {
  playerSpinner.classList.add('hidden');
  playerVideo.classList.add('hidden');
  const code = playerVideo.error?.code;
  let msg;
  switch (code) {
    case 1: msg = 'Pemutaran dibatalkan.'; break;                          // MEDIA_ERR_ABORTED
    case 2: msg = 'Koneksi terputus saat memuat video. Cek WiFi.'; break;  // MEDIA_ERR_NETWORK
    case 3: msg = 'File rusak atau codec tidak didukung browser ini.'; break; // MEDIA_ERR_DECODE
    case 4: msg = 'Format video tidak didukung browser ini. Coba download.'; break; // MEDIA_ERR_SRC_NOT_SUPPORTED
    default: msg = 'Gagal memutar video.';
  }
  playerErrorMsg.textContent = msg;
  playerError.classList.remove('hidden');
}

// Poin #9: audio canplay handler
function onAudioCanPlay() {
  playerSpinner.classList.add('hidden');
}

// Poin #10: diagnostic error audio
function onAudioError() {
  playerAudioWrap.classList.add('hidden');
  playerSpinner.classList.add('hidden');
  const code = playerAudio.error?.code;
  let msg;
  switch (code) {
    case 2: msg = 'Koneksi terputus saat memuat audio. Cek WiFi.'; break;
    case 3: msg = 'File rusak atau codec tidak didukung browser ini.'; break;
    case 4: msg = 'Format audio tidak didukung browser ini. Coba download.'; break;
    default: msg = 'Gagal memutar audio.';
  }
  playerErrorMsg.textContent = msg;
  playerError.classList.remove('hidden');
}

function closePlayer() {
  // Batalkan semua listener aktif
  playerAbort.abort();
  playerAbort = new AbortController();

  playerVideo.pause();
  playerAudio.pause();
  playerVideo.src = '';
  playerAudio.src = '';
  playerOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

// Tombol close player
$('player-close').addEventListener('click', () => {
  closePlayer();
  if (history.state && history.state.player) history.back();
});

// Tombol back fisik HP
window.addEventListener('popstate', () => {
  if (!playerOverlay.classList.contains('hidden')) {
    closePlayer();
  }
});

// Picture-in-Picture
playerPip.addEventListener('click', async () => {
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
async function uploadFiles(fileList, targetPath) {
  let successCount = 0;
  let failCount = 0;
  for (const file of fileList) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(
        '/api/upload?path=' + encodeURIComponent(targetPath),
        { method: 'POST', body: formData }
      );
      if (res.status === 413) {
        showToast(`❌ "${file.name}" terlalu besar (maks 200 MB)`, true);
        failCount++;
        continue;
      }
      const data = await res.json();
      if (data.ok) {
        successCount++;
      } else {
        showToast(`❌ Gagal upload "${file.name}": ${data.error || 'error tidak diketahui'}`, true);
        failCount++;
      }
    } catch {
      failCount++;
    }
  }
  if (successCount > 0) showToast(`✅ ${successCount} file berhasil diupload`);
  if (failCount > 0) showToast(`❌ ${failCount} file gagal diupload`, true);
  loadFiles(state.currentPath);
}

// ===== PIN Login =====
async function checkAuth() {
  try {
    const res = await fetch('/api/files?path=');
    if (res.status === 401) {
      showLoginScreen();
    } else {
      showApp();
      const data = await res.json();
      state.allItems = data.items || [];
      renderBreadcrumb(data.path || '');
      renderFiles(state.allItems);
    }
  } catch {
    showApp();
    showError('Tidak dapat terhubung ke server.');
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
function showSpinner(show) {
  spinner.classList.toggle('hidden', !show);
}

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

// ===== Event listeners =====
$('btn-refresh').addEventListener('click', () => loadFiles(state.currentPath));

$('btn-upload').addEventListener('click', () => uploadInput.click());

uploadInput.addEventListener('change', () => {
  if (uploadInput.files.length > 0) {
    uploadFiles(uploadInput.files, state.currentPath);
    uploadInput.value = '';
  }
});

$('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

btnDownload.addEventListener('click', () => {
  downloadFile(state.selectedFile);
  closeModal();
});

searchInput.addEventListener('input', () => {
  state.searchQuery = searchInput.value;
  renderFiles(state.allItems);
});

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('player-overlay').classList.contains('hidden')) {
      closePlayer();
    } else if (!$('hp-apps-overlay').classList.contains('hidden')) {
      closeHpAppsModal();
    } else {
      closeModal();
    }
  }
});

// ===== Init =====
// Inisialisasi custom player setelah DOM siap
if (typeof initCplayer === 'function') initCplayer();
checkAuth();
