'use strict';

// ===== Live Stream Module =====
// Broadcaster: laptop yang share layar/kamera
// Viewer: HP yang menonton stream
//
// Arsitektur: WebRTC P2P dengan Go server sebagai signaling relay (SSE + POST).
// Server TIDAK handle media — hanya relay SDP offer/answer dan ICE candidates.

const liveState = {
  pc: new Map(),        // viewerId -> RTCPeerConnection (broadcaster side)
  stream: null,         // MediaStream aktif
  peerId: null,         // ID unik peer ini (crypto.randomUUID)
  eventSource: null,    // SSE connection
  isLive: false,        // apakah sedang broadcast
  role: null,           // 'broadcaster' | 'viewer'
  timerInterval: null,  // interval untuk update durasi
  startTime: null,      // waktu mulai broadcast
  viewerPc: null,       // RTCPeerConnection (viewer side)
};

let liveTabInited = false;

// ===== Entry point: dipanggil saat tab Live dibuka =====
function initLiveTab() {
  if (liveTabInited) {
    // Sudah init — cukup refresh status
    renderLiveContainer();
    return;
  }
  liveTabInited = true;
  renderLiveContainer();
}

// ===== Render container berdasarkan state =====
function renderLiveContainer() {
  const container = document.getElementById('live-container');
  if (!container) return;

  if (liveState.isLive && liveState.role === 'broadcaster') {
    renderBroadcasterActive(container);
  } else if (liveState.role === 'viewer' && liveState.viewerPc) {
    renderViewerActive(container);
  } else {
    renderLiveIdle(container);
  }
}

// ===== Idle State: pilih broadcast atau watch =====
function renderLiveIdle(container) {
  container.innerHTML = `
    <div class="live-idle">
      <div class="live-icon-big">📹</div>
      <h2>Live Stream</h2>
      <p>Bagikan layar atau kamera laptop ke device lain di jaringan.</p>
      <div class="live-actions">
        <button id="btn-broadcast-screen" class="btn btn-primary btn-full">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="flex-shrink:0">
            <path d="M21 16H3V4h18m0-2H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h7v2H8v2h8v-2h-2v-2h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
          </svg>
          Bagikan Layar
        </button>
        <button id="btn-broadcast-camera" class="btn btn-secondary btn-full">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="flex-shrink:0">
            <path d="M12 17c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0-8c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3z"/>
            <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
          </svg>
          Bagikan Kamera
        </button>
        <div id="live-watch-btn-wrap"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-broadcast-screen').addEventListener('click', () => startBroadcast('screen'));
  document.getElementById('btn-broadcast-camera').addEventListener('click', () => startBroadcast('camera'));

  // Cek apakah ada broadcast aktif dari device lain
  checkLiveStatus().then(active => {
    const wrap = document.getElementById('live-watch-btn-wrap');
    if (!wrap) return;
    if (active) {
      wrap.innerHTML = `
        <hr style="border:none;border-top:1px solid var(--border);margin:8px 0"/>
        <p style="font-size:.85rem;color:var(--text-muted);margin-bottom:8px">Ada broadcast aktif:</p>
        <button id="btn-watch" class="btn btn-secondary btn-full">
          👁 Tonton Live Stream
        </button>
      `;
      document.getElementById('btn-watch').addEventListener('click', startWatching);
      // Update live badge di nav
      setLiveNavBadge(true);
    } else {
      setLiveNavBadge(false);
    }
  });
}

// ===== Broadcaster Active State =====
function renderBroadcasterActive(container) {
  container.innerHTML = `
    <div class="live-active">
      <div>
        <div class="live-status">
          <span class="live-dot"></span>
          <span>LIVE</span>
          <span id="live-duration" class="live-duration">00:00</span>
          <span id="live-viewers" class="live-viewer-count">0 viewer</span>
        </div>
      </div>
      <video id="live-preview" class="live-preview" autoplay muted playsinline></video>
      <button id="btn-broadcast-stop" class="btn btn-danger btn-full">⏹ Stop Broadcast</button>
    </div>
  `;

  // Attach stream ke preview
  const preview = document.getElementById('live-preview');
  if (preview && liveState.stream) preview.srcObject = liveState.stream;

  document.getElementById('btn-broadcast-stop').addEventListener('click', stopBroadcast);

  // Start timer
  startLiveTimer();
}

// ===== Viewer Active State =====
function renderViewerActive(container) {
  container.innerHTML = `
    <div class="live-watch">
      <div class="live-status overlay">
        <span class="live-dot"></span>
        <span>LIVE</span>
      </div>
      <video id="live-watch-video" class="live-watch-video" autoplay playsinline></video>
      <div style="padding:12px;text-align:center">
        <button id="btn-stop-watching" class="btn btn-secondary">✕ Berhenti Menonton</button>
      </div>
    </div>
  `;
  document.getElementById('btn-stop-watching').addEventListener('click', stopWatching);
}

// ===== Broadcaster Logic =====
async function startBroadcast(source) {
  try {
    let stream;
    if (source === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

    liveState.stream = stream;
    liveState.peerId = 'b_' + crypto.randomUUID();
    liveState.role = 'broadcaster';
    liveState.isLive = true;
    liveState.startTime = Date.now();

    // Render active UI
    const container = document.getElementById('live-container');
    renderBroadcasterActive(container);

    // Open SSE signaling channel
    liveState.eventSource = new EventSource(
      '/api/live/events?peer_id=' + encodeURIComponent(liveState.peerId) + '&role=broadcaster'
    );
    liveState.eventSource.addEventListener('signal', (e) => {
      handleBroadcasterSignal(JSON.parse(e.data));
    });
    liveState.eventSource.onerror = () => {
      // SSE error — server mungkin restart
      if (liveState.isLive) {
        showToast('Koneksi signaling terputus', true);
      }
    };

    // Auto-stop saat user berhenti share screen (browser dialog)
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', stopBroadcast);
    }

    // Update nav badge
    setLiveNavBadge(true);

  } catch (err) {
    if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      showToast('Gagal mulai broadcast: ' + err.message, true);
    }
    liveState.isLive = false;
    liveState.role = null;
  }
}

async function handleBroadcasterSignal(sig) {
  if (sig.type === 'viewer-joined') {
    // Buat RTCPeerConnection baru untuk viewer ini
    const pc = new RTCPeerConnection({ iceServers: [] }); // LAN — no STUN needed
    liveState.pc.set(sig.from, pc);

    // Tambah semua track dari stream
    if (liveState.stream) {
      liveState.stream.getTracks().forEach(t => pc.addTrack(t, liveState.stream));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal('ice', sig.from, e.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        pc.close();
        liveState.pc.delete(sig.from);
        updateViewerCount();
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal('offer', sig.from, offer);
      updateViewerCount();
    } catch (err) {
      console.error('Failed to create offer:', err);
    }

  } else if (sig.type === 'answer') {
    const pc = liveState.pc.get(sig.from);
    if (pc) {
      try {
        // sig.payload sudah object (RTCSessionDescriptionInit) — tidak perlu JSON.parse
        await pc.setRemoteDescription(sig.payload);
      } catch (err) {
        console.error('Failed to set remote description:', err);
      }
    }

  } else if (sig.type === 'ice') {
    const pc = liveState.pc.get(sig.from);
    if (pc) {
      try {
        // sig.payload sudah object (RTCIceCandidateInit)
        await pc.addIceCandidate(sig.payload);
      } catch {
        // ICE candidate errors are often benign
      }
    }

  } else if (sig.type === 'viewer-left') {
    const pc = liveState.pc.get(sig.from);
    if (pc) { pc.close(); liveState.pc.delete(sig.from); }
    updateViewerCount();
  }
}

function updateViewerCount() {
  const el = document.getElementById('live-viewers');
  if (el) {
    const count = liveState.pc.size;
    el.textContent = count + ' viewer' + (count !== 1 ? 's' : '');
  }
}

function stopBroadcast() {
  if (!liveState.isLive) return;

  // Stop media tracks
  if (liveState.stream) {
    liveState.stream.getTracks().forEach(t => t.stop());
    liveState.stream = null;
  }

  // Close all peer connections
  liveState.pc.forEach(pc => pc.close());
  liveState.pc.clear();

  // Close SSE
  if (liveState.eventSource) {
    liveState.eventSource.close();
    liveState.eventSource = null;
  }

  // Notify server
  if (liveState.peerId) {
    fetch('/api/live/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peer_id: liveState.peerId }),
    }).catch(() => {});
  }

  // Stop timer
  if (liveState.timerInterval) {
    clearInterval(liveState.timerInterval);
    liveState.timerInterval = null;
  }

  liveState.isLive = false;
  liveState.role = null;
  liveState.peerId = null;
  liveState.startTime = null;

  setLiveNavBadge(false);

  // Re-render idle
  const container = document.getElementById('live-container');
  if (container) renderLiveIdle(container);
}

// ===== Viewer Logic =====
async function startWatching() {
  liveState.peerId = 'v_' + crypto.randomUUID();
  liveState.role = 'viewer';

  const pc = new RTCPeerConnection({ iceServers: [] });
  liveState.viewerPc = pc;

  // Render viewer UI
  const container = document.getElementById('live-container');
  renderViewerActive(container);

  // Attach incoming tracks to video element
  pc.ontrack = (e) => {
    const video = document.getElementById('live-watch-video');
    if (video && e.streams && e.streams[0]) {
      video.srcObject = e.streams[0];
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal('ice', 'broadcaster', e.candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      showToast('Stream terputus', true);
      stopWatching();
    }
  };

  // Open SSE signaling channel
  liveState.eventSource = new EventSource(
    '/api/live/events?peer_id=' + encodeURIComponent(liveState.peerId) + '&role=viewer'
  );
  liveState.eventSource.addEventListener('signal', (e) => {
    handleViewerSignal(JSON.parse(e.data));
  });
  liveState.eventSource.onerror = () => {
    if (liveState.role === 'viewer') {
      showToast('Koneksi signaling terputus', true);
    }
  };
}

async function handleViewerSignal(sig) {
  const pc = liveState.viewerPc;
  if (!pc) return;

  if (sig.type === 'offer') {
    try {
      // sig.payload sudah object (RTCSessionDescriptionInit) — tidak perlu JSON.parse
      await pc.setRemoteDescription(sig.payload);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal('answer', 'broadcaster', answer);
    } catch (err) {
      console.error('Failed to handle offer:', err);
      showToast('Gagal terhubung ke broadcaster', true);
    }

  } else if (sig.type === 'ice') {
    try {
      // sig.payload sudah object (RTCIceCandidateInit)
      await pc.addIceCandidate(sig.payload);
    } catch {
      // ICE candidate errors are often benign
    }

  } else if (sig.type === 'bye') {
    showToast('Broadcast telah dihentikan');
    stopWatching();
  } else if (sig.type === 'reset') {
    // Server kirim reset saat viewer reconnect dengan ID yang sama (mis. setelah server restart).
    // Tutup PC lama dan mulai ulang proses watching dari awal.
    showToast('Koneksi direset, menghubungkan ulang...');
    stopWatching();
  }
}

function stopWatching() {
  if (liveState.viewerPc) {
    liveState.viewerPc.close();
    liveState.viewerPc = null;
  }
  if (liveState.eventSource) {
    liveState.eventSource.close();
    liveState.eventSource = null;
  }
  liveState.role = null;
  liveState.peerId = null;

  const container = document.getElementById('live-container');
  if (container) renderLiveIdle(container);
}

// ===== Signaling helper =====
// payload dikirim sebagai object biasa — server menyimpannya sebagai json.RawMessage
// dan meneruskannya apa adanya. Penerima bisa langsung pakai sig.payload tanpa JSON.parse manual.
function sendSignal(type, to, payload) {
  fetch('/api/live/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, from: liveState.peerId, to, payload }),
  }).catch(() => {});
}

// ===== Status check =====
async function checkLiveStatus() {
  try {
    const res = await fetch('/api/live/status');
    const data = await res.json();
    return data.active === true;
  } catch {
    return false;
  }
}

// ===== Timer =====
function startLiveTimer() {
  if (liveState.timerInterval) clearInterval(liveState.timerInterval);
  liveState.timerInterval = setInterval(() => {
    const el = document.getElementById('live-duration');
    if (!el || !liveState.startTime) return;
    const elapsed = Math.floor((Date.now() - liveState.startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    el.textContent = m + ':' + s;
  }, 1000);
}

// ===== Nav badge =====
function setLiveNavBadge(show) {
  const badge = document.getElementById('live-nav-badge');
  if (badge) badge.classList.toggle('hidden', !show);
}
