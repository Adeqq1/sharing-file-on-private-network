package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	maxLoginAttempts = 5               // lock setelah N gagal
	lockDuration     = 5 * time.Minute // durasi lock
	tokenTTL         = 24 * time.Hour
	janitorInterval  = 30 * time.Minute
)

type authStore struct {
	mu       sync.RWMutex
	tokens   map[string]time.Time // token -> expiry
	pin      string
	attempts int       // jumlah percobaan login gagal berturut-turut
	lockedAt time.Time // waktu lock dimulai (zero = tidak terkunci)
}

var auth = &authStore{
	tokens: make(map[string]time.Time),
}

// InitPIN membuat PIN 4 digit acak dan menyimpannya (thread-safe).
func InitPIN() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(9000))
	pin := fmt.Sprintf("%04d", n.Int64()+1000)
	auth.mu.Lock()
	auth.pin = pin
	auth.mu.Unlock()
	return pin
}

// ValidatePIN mengecek PIN dengan rate limiting.
// Mengembalikan (valid bool, locked bool, retryAfter time.Duration).
func ValidatePIN(pin string) (valid bool, locked bool, retryAfter time.Duration) {
	auth.mu.Lock()
	defer auth.mu.Unlock()

	// Cek apakah sedang terkunci
	if !auth.lockedAt.IsZero() {
		remaining := lockDuration - time.Since(auth.lockedAt)
		if remaining > 0 {
			return false, true, remaining
		}
		// Lock sudah habis, reset
		auth.lockedAt = time.Time{}
		auth.attempts = 0
	}

	if pin == auth.pin {
		auth.attempts = 0
		return true, false, 0
	}

	auth.attempts++
	if auth.attempts >= maxLoginAttempts {
		auth.lockedAt = time.Now()
		return false, true, lockDuration
	}
	return false, false, 0
}

// CreateToken membuat token sesi baru dan menyimpannya (thread-safe).
func CreateToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("gagal generate token: %w", err)
	}
	token := hex.EncodeToString(b)
	auth.mu.Lock()
	auth.tokens[token] = time.Now().Add(tokenTTL)
	auth.mu.Unlock()
	return token, nil
}

// IsValidToken mengecek apakah token masih valid (thread-safe).
func IsValidToken(token string) bool {
	auth.mu.RLock()
	expiry, ok := auth.tokens[token]
	auth.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Now().After(expiry) {
		auth.mu.Lock()
		delete(auth.tokens, token)
		auth.mu.Unlock()
		return false
	}
	return true
}

// StartTokenJanitor menjalankan goroutine yang membersihkan token expired secara berkala.
func StartTokenJanitor() {
	go func() {
		ticker := time.NewTicker(janitorInterval)
		defer ticker.Stop()
		for range ticker.C {
			now := time.Now()
			auth.mu.Lock()
			for tok, exp := range auth.tokens {
				if now.After(exp) {
					delete(auth.tokens, tok)
				}
			}
			auth.mu.Unlock()
		}
	}()
}

// AuthMiddleware melindungi handler dengan cek cookie auth.
func AuthMiddleware(pinEnabled bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !pinEnabled {
			next.ServeHTTP(w, r)
			return
		}
		// Halaman login tidak perlu auth
		if r.URL.Path == "/login" || r.URL.Path == "/api/login" {
			next.ServeHTTP(w, r)
			return
		}
		cookie, err := r.Cookie("auth")
		if err != nil || !IsValidToken(cookie.Value) {
			// Untuk API, kembalikan 401 JSON
			if strings.HasPrefix(r.URL.Path, "/api/") {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			// Untuk halaman, redirect ke login
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}
