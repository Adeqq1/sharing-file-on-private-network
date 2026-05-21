package live

import (
	"testing"
	"time"
)

// TestJoinBroadcaster memastikan broadcaster bisa join dan mendapat channel.
func TestJoinBroadcaster(t *testing.T) {
	h := NewHub()
	ch, err := h.Join(RoleBroadcaster, "b1")
	if err != nil {
		t.Fatalf("Join broadcaster gagal: %v", err)
	}
	if ch == nil {
		t.Fatal("channel nil")
	}
	if !h.IsActive() {
		t.Fatal("hub seharusnya aktif setelah broadcaster join")
	}
}

// TestJoinBroadcasterDuplicate memastikan ErrBroadcasterExists saat ada dua broadcaster.
func TestJoinBroadcasterDuplicate(t *testing.T) {
	h := NewHub()
	if _, err := h.Join(RoleBroadcaster, "b1"); err != nil {
		t.Fatalf("join pertama gagal: %v", err)
	}
	_, err := h.Join(RoleBroadcaster, "b2")
	if err == nil {
		t.Fatal("seharusnya error saat join broadcaster kedua")
	}
	if err != ErrBroadcasterExists {
		t.Fatalf("error salah: got %v, want %v", err, ErrBroadcasterExists)
	}
}

// TestJoinViewerWithoutBroadcaster memastikan viewer bisa join meski tidak ada broadcaster.
func TestJoinViewerWithoutBroadcaster(t *testing.T) {
	h := NewHub()
	ch, err := h.Join(RoleViewer, "v1")
	if err != nil {
		t.Fatalf("Join viewer gagal: %v", err)
	}
	if ch == nil {
		t.Fatal("channel nil")
	}
	if h.ViewerCount() != 1 {
		t.Fatalf("viewer count salah: got %d, want 1", h.ViewerCount())
	}
}

// TestViewerJoinedNotifiesBroadcaster memastikan broadcaster dapat notif viewer-joined.
func TestViewerJoinedNotifiesBroadcaster(t *testing.T) {
	h := NewHub()
	bCh, _ := h.Join(RoleBroadcaster, "b1")

	h.Join(RoleViewer, "v1") //nolint

	select {
	case sig := <-bCh:
		if sig.Type != "viewer-joined" {
			t.Fatalf("type signal salah: got %q, want %q", sig.Type, "viewer-joined")
		}
		if sig.From != "v1" {
			t.Fatalf("from salah: got %q, want %q", sig.From, "v1")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout: broadcaster tidak dapat notif viewer-joined")
	}
}

// TestLeaveBroadcasterNotifiesViewers memastikan semua viewer dapat signal bye saat broadcaster keluar.
func TestLeaveBroadcasterNotifiesViewers(t *testing.T) {
	h := NewHub()
	h.Join(RoleBroadcaster, "b1") //nolint

	v1Ch, _ := h.Join(RoleViewer, "v1")
	v2Ch, _ := h.Join(RoleViewer, "v2")

	// Drain viewer-joined notifs dari broadcaster channel (tidak kita cek di sini)
	h.Leave("b1")

	for _, tc := range []struct {
		name string
		ch   chan Signal
	}{
		{"v1", v1Ch},
		{"v2", v2Ch},
	} {
		select {
		case sig, open := <-tc.ch:
			// Channel bisa sudah closed (open=false) atau dapat signal bye
			if open && sig.Type != "bye" {
				t.Errorf("%s: type signal salah: got %q, want %q", tc.name, sig.Type, "bye")
			}
		case <-time.After(100 * time.Millisecond):
			t.Errorf("%s: timeout menunggu signal bye", tc.name)
		}
	}

	if h.IsActive() {
		t.Fatal("hub seharusnya tidak aktif setelah broadcaster leave")
	}
}

// TestLeaveViewer memastikan viewer bisa leave dan ViewerCount berkurang.
func TestLeaveViewer(t *testing.T) {
	h := NewHub()
	h.Join(RoleBroadcaster, "b1") //nolint
	h.Join(RoleViewer, "v1")      //nolint
	h.Join(RoleViewer, "v2")      //nolint

	if h.ViewerCount() != 2 {
		t.Fatalf("viewer count awal salah: got %d, want 2", h.ViewerCount())
	}

	h.Leave("v1")

	if h.ViewerCount() != 1 {
		t.Fatalf("viewer count setelah leave salah: got %d, want 1", h.ViewerCount())
	}
}

// TestForwardToBroadcaster memastikan signal diteruskan ke broadcaster.
func TestForwardToBroadcaster(t *testing.T) {
	h := NewHub()
	bCh, _ := h.Join(RoleBroadcaster, "b1")
	h.Join(RoleViewer, "v1") //nolint

	// Drain viewer-joined notif
	<-bCh

	h.Forward(Signal{Type: "answer", From: "v1", To: "broadcaster"})

	select {
	case sig := <-bCh:
		if sig.Type != "answer" {
			t.Fatalf("type salah: got %q, want %q", sig.Type, "answer")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout: broadcaster tidak dapat signal answer")
	}
}

// TestForwardToViewer memastikan signal diteruskan ke viewer tertentu.
func TestForwardToViewer(t *testing.T) {
	h := NewHub()
	h.Join(RoleBroadcaster, "b1") //nolint
	v1Ch, _ := h.Join(RoleViewer, "v1")

	h.Forward(Signal{Type: "offer", From: "b1", To: "v1"})

	select {
	case sig := <-v1Ch:
		if sig.Type != "offer" {
			t.Fatalf("type salah: got %q, want %q", sig.Type, "offer")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("timeout: viewer tidak dapat signal offer")
	}
}

// TestStartedAt memastikan StartedAt di-set saat broadcaster join dan di-reset saat leave.
func TestStartedAt(t *testing.T) {
	h := NewHub()
	before := time.Now()
	h.Join(RoleBroadcaster, "b1") //nolint
	after := time.Now()

	st := h.StartedAt()
	if st.Before(before) || st.After(after) {
		t.Fatalf("StartedAt di luar range: %v", st)
	}

	h.Leave("b1")
	if !h.StartedAt().IsZero() {
		t.Fatal("StartedAt seharusnya zero setelah broadcaster leave")
	}
}
