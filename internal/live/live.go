package live

import (
	"encoding/json"
	"errors"
	"sync"
	"time"
)

// Role membedakan peer: broadcaster (kirim stream) atau viewer (terima stream).
type Role string

const (
	RoleBroadcaster Role = "broadcaster"
	RoleViewer      Role = "viewer"
)

// Signal adalah message yang di-relay antar peer (offer, answer, atau ice candidate).
type Signal struct {
	Type    string          `json:"type"`    // "offer", "answer", "ice", "bye", "viewer-joined"
	From    string          `json:"from"`    // peer ID pengirim
	To      string          `json:"to"`      // peer ID tujuan (atau "broadcaster")
	Payload json.RawMessage `json:"payload"` // SDP atau ICE candidate (bisa null)
}

// peer menyimpan state satu koneksi SSE yang aktif.
// Field role dihapus — tidak dipakai setelah Join().
type peer struct {
	id string
	ch chan Signal // outbox messages untuk peer ini
}

// Hub mengelola satu sesi live stream: satu broadcaster, banyak viewer.
type Hub struct {
	mu          sync.RWMutex
	broadcaster *peer
	viewers     map[string]*peer
	startedAt   time.Time
}

// NewHub membuat Hub baru yang siap dipakai.
func NewHub() *Hub {
	return &Hub{viewers: make(map[string]*peer)}
}

// IsActive mengembalikan true jika ada broadcaster aktif.
func (h *Hub) IsActive() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.broadcaster != nil
}

// StartedAt mengembalikan waktu broadcast dimulai.
func (h *Hub) StartedAt() time.Time {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.startedAt
}

// ViewerCount mengembalikan jumlah viewer yang terhubung.
func (h *Hub) ViewerCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.viewers)
}

// Join mendaftarkan peer baru. Mengembalikan channel untuk receive signals.
// Jika role broadcaster dan sudah ada broadcaster aktif, mengembalikan ErrBroadcasterExists.
func (h *Hub) Join(role Role, id string) (chan Signal, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Buffer 64 untuk mengurangi risiko drop notif viewer-joined saat broadcaster sibuk.
	p := &peer{id: id, ch: make(chan Signal, 64)}

	if role == RoleBroadcaster {
		if h.broadcaster != nil {
			return nil, ErrBroadcasterExists
		}
		h.broadcaster = p
		h.startedAt = time.Now()
	} else {
		h.viewers[id] = p
		// Beritahu broadcaster ada viewer baru.
		// Jika channel penuh (sangat jarang di LAN), notif di-drop — viewer akan timeout
		// menunggu offer dan perlu reconnect. Ini trade-off yang diterima untuk LAN scope.
		if h.broadcaster != nil {
			select {
			case h.broadcaster.ch <- Signal{Type: "viewer-joined", From: id}:
			default:
			}
		}
	}
	return p.ch, nil
}

// Leave menghapus peer dari hub dan membersihkan resource-nya.
func (h *Hub) Leave(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.broadcaster != nil && h.broadcaster.id == id {
		// Broadcaster keluar — kirim "bye" ke semua viewer
		close(h.broadcaster.ch)
		h.broadcaster = nil
		h.startedAt = time.Time{}
		for _, v := range h.viewers {
			select {
			case v.ch <- Signal{Type: "bye", From: "broadcaster"}:
			default:
			}
		}
		return
	}

	if v, ok := h.viewers[id]; ok {
		close(v.ch)
		delete(h.viewers, id)
		// Beritahu broadcaster viewer keluar
		if h.broadcaster != nil {
			select {
			case h.broadcaster.ch <- Signal{Type: "viewer-left", From: id}:
			default:
			}
		}
	}
}

// Forward meneruskan signal ke peer tujuan.
//
// Catatan keamanan: endpoint ini berjalan di LAN privat dan trust peer_id dari client.
// Tidak ada verifikasi bahwa pengirim benar-benar peer yang terdaftar — cukup untuk
// scope LAN rumah/kantor. Jangan expose server ini ke internet.
func (h *Hub) Forward(s Signal) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if s.To == "broadcaster" {
		if h.broadcaster != nil {
			select {
			case h.broadcaster.ch <- s:
			default:
			}
		}
		return
	}

	if v, ok := h.viewers[s.To]; ok {
		select {
		case v.ch <- s:
		default:
		}
	}
}

// ErrBroadcasterExists dikembalikan saat ada broadcaster aktif dan ada yang coba join sebagai broadcaster lagi.
var ErrBroadcasterExists = errors.New("sudah ada broadcaster aktif")
