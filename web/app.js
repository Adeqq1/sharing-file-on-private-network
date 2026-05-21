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
const loginScreen  = $('login-screen');
const appEl        = $('app');
const fileList     = $('file-list');
const spinner      = $('spinner');
const errorBox     = $('error-box');
const emptyMsg     = $('empty-msg');
const breadcrumb   = $('breadcrumb');
const searchInput  = $('search-input');
const modalOverlay = $('modal-overlay');
const modalApps    = $('modal-apps');
const modalFilename= $('modal-filename');
const btnDownload  = $('btn-download');
const toast        = $('toast');
const uploadInput  = $('upload-input');

// ===== Emoji icons =====
const EXT_ICONS = {
  // Video
  mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬',
  // Audio
  mp3: '🎵', flac: '🎵', wav: '🎵', aac: '🎵', ogg: '🎵', m4a: '🎵',
  // Image
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', webp: '🖼️', svg: '🖼️',
  // Document
  pdf: '📕', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊',
  txt: '📄', md: '📄', log: '📄', csv: '📄',
  // Archive
  zip: '🗜️', rar: '🗜️', '7z': '🗜️', tar: '🗜️', gz: '🗜️',
  // Code
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

// ===== API helpers =====
async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    // Session expired, reload ke login
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

  // Filter berdasarkan search
  const q = state.searchQuery.toLowerCase();
  const filtered = q
    ? items.filter(i => i.name.toLowerCase().includes(q))
    : items;

  // Urutkan: folder dulu, lalu file, keduanya alphabetical
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

    li.innerHTML = `
      <span class="file-icon" aria-hidden="true">${getIcon(item)}</span>
      <div class="file-info">
        <div class="file-name">${escapeHtml(item.name)}</div>
        <div class="file-meta">${escapeHtml(meta)}</div>
      </div>
      <span class="file-arrow" aria-hidden="true">${item.is_dir ? '›' : '⋯'}</span>
    `;

    li.addEventListener('click', () => {
      if (item.is_dir) {
        const newPath = state.currentPath
          ? state.currentPath + '/' + item.name
          : item.name;
        loadFiles(newPath);
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
    if (!appList || appList.length === 0) {
      modalApps.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">Tidak ada aplikasi terdaftar.</p>';
      return;
    }

    for (const app of appList) {
      const btn = document.createElement('button');
      btn.className = 'app-btn';
      btn.innerHTML = `<span class="app-btn-icon">🖥️</span><span>${escapeHtml(app.name)}</span>`;
      btn.addEventListener('click', () => openWith(app.id, item));
      modalApps.appendChild(btn);
    }
  } catch {
    modalApps.innerHTML = '<p style="color:var(--danger)">Gagal memuat daftar aplikasi.</p>';
  }
}

async function openWith(appId, item) {
  closeModal();
  const filePath = state.currentPath
    ? state.currentPath + '/' + item.name
    : item.name;

  try {
    const res = await apiFetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, path: filePath }),
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

// ===== Download =====
function downloadFile(item) {
  if (!item) return;
  const filePath = state.currentPath
    ? state.currentPath + '/' + item.name
    : item.name;
  const url = '/api/download?path=' + encodeURIComponent(filePath);
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
  // Coba akses API; jika 401 tampilkan login
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
      // Rate limited
      const secs = data.retry_after || 300;
      const mins = Math.ceil(secs / 60);
      $('pin-error').textContent = `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.`;
      $('pin-error').classList.remove('hidden');
      digits.forEach(d => { d.value = ''; d.disabled = true; });
      // Re-enable setelah waktu tunggu
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// PIN digit navigation
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

// Keyboard: Escape menutup modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// ===== Init =====
checkAuth();
