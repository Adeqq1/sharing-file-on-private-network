package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthMiddlewareAllowsUnauthenticatedPublicPaths(t *testing.T) {
	for _, path := range []string{"/", "/login", "/index.html", "/style.css", "/app.js", "/cplayer.js", "/api/login"} {
		t.Run(path, func(t *testing.T) {
			handler := AuthMiddleware(true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			}))

			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))

			if response.Code != http.StatusNoContent {
				t.Errorf("GET %s status = %d, want %d", path, response.Code, http.StatusNoContent)
			}
		})
	}
}

func TestAuthMiddlewareRejectsUnauthenticatedProtectedAPI(t *testing.T) {
	handler := AuthMiddleware(true, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/files", nil))

	if response.Code != http.StatusUnauthorized {
		t.Errorf("GET /api/files status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}
