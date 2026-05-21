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
      : '';

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

    // ── Tombol "Putar di HP" (hanya untuk file streamable) ──
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

      // Divider
      const divider = document.createElement('div');
      divider.style.cssText = 'border-top:1px solid var(--border);margin:8px 0 4px;';
      const dividerLabel = document.createElement('p');
      dividerLabel.style.cssText = 'font-size:.78rem;color:var(--text-muted);margin-bottom:6px;';
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

// ===== Player (streaming) =====
const playerOverlay  = $('player-overlay');
const playerTitle    = $('player-title');
const playerVideo    = $('player-video');
const playerAudioWrap= $('player-audio-wrap');
const playerAudio    = $('player-audio');
const playerAudioTitle = $('player-audio-title');
const playerSpinner  = $('player-spinner');
const playerError    = $('player-error');
const playerErrorMsg = $('player-error-msg');
const playerPip      = $('player-pip');

function openPlayer(item) {
  const url = '/api/stream?path=' + encodeURIComponent(filePathOf(item));

  // Reset semua state player
  playerVideo.classList.add('hidden');
  playerAudioWrap.classList.add('hidden');
  playerError.classList.add('hidden');
  playerSpinner.classList.remove('hidden');
  playerPip.classList.add('hidden');
  playerVideo.src = '';
  playerAudio.src = '';

  playerTitle.textContent = item.name;
  playerOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Tambah history entry supaya tombol back HP menutup player
  history.pushState({ player: true }, '');

  if (item.streamable === 'video') {
    playerVideo.src = url;
    playerVideo.classList.remove('hidden');

    // Tampilkan PiP button jika browser mendukung
    if (document.pictureInPictureEnabled) {
      playerPip.classList.remove('hidden');
    }

    // Loading state
    playerVideo.addEventListener('canplay', onVideoCanPlay, { once: true });
    playerVideo.addEventListener('error', onVideoError, { once: true });
    playerVideo.load();

  } else if (item.streamable === 'audio') {
    playerAudioTitle.textContent = item.name;
    playerAudio.src = url;
    playerAudioWrap.classList.remove('hidden');
    playerSpinner.classList.add('hidden');

    playerAudio.addEventListener('error', onAudioError, { once: true });
    playerAudio.load();
    playerAudio.play().catch(() => { /* autoplay blocked — user tap play */ });
  }
}

function onVideoCanPlay() {
  playerSpinner.classList.add('hidden');
  playerVideo.play().catch(() => { /* autoplay blocked */ });
}

function onVideoError() {
  playerSpinner.classList.add('hidden');
  playerVideo.classList.add('hidden');
  playerErrorMsg.textContent = 'Gagal memutar video. Format mungkin tidak didukung browser ini.';
  playerError.classList.remove('hidden');
}

function onAudioError() {
  playerAudioWrap.classList.add('hidden');
  playerErrorMsg.textContent = 'Gagal memutar audio. Format mungkin tidak didukung browser ini.';
  playerError.classList.remove('hidden');
}

function closePlayer() {
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
  // Hapus history entry yang kita tambahkan
  if (history.state && history.state.player) history.back();
});

// Tombol back fisik HP
window.addEventListener('popstate', (e) => {
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
    if (!playerOverlay.classList.contains('hidden')) {
      closePlayer();
    } else {
      closeModal();
    }
  }
});

// ===== Init =====
checkAuth();
