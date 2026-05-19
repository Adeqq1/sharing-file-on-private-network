package server

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"time"
)

type authStore struct {
	mu     sync.RWMutex
	tokens map[string]time.Time // token -> expiry
	pin    string
}

var auth = &authStore{
	tokens: make(map[string]time.Time),
}

// InitPIN membuat PIN 4 digit acak dan menyimpannya.
func InitPIN() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(9000))
	pin := fmt.Sprintf("%04d", n.Int64()+1000)
	auth.pin = pin
	return pin
}

// ValidatePIN mengecek apakah PIN yang diberikan benar.
func ValidatePIN(pin string) bool {
	return pin == auth.pin
}

// CreateToken membuat token sesi baru dan menyimpannya.
func CreateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	token := hex.EncodeToString(b)
	auth.mu.Lock()
	auth.tokens[token] = time.Now().Add(24 * time.Hour)
	auth.mu.Unlock()
	return token
}

// IsValidToken mengecek apakah token masih valid.
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
			// Untuk API, kembalikan 401
			if len(r.URL.Path) > 4 && r.URL.Path[:5] == "/api/" {
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
