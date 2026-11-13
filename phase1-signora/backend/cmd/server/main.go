package main

import (
	"bufio"
	"log"
	"net/http"
	"os"
	"phase1-signora/backend/internal/config"
	"phase1-signora/backend/internal/database"
	"phase1-signora/backend/internal/handlers"
	"phase1-signora/backend/internal/middleware"
	"strings"
)

func main() {
	loadEnvFile()
	cfg := config.Load()
	db := database.Connect(cfg.DatabaseURL)
	defer db.Close()
	if err := os.MkdirAll(cfg.UploadDir, 0755); err != nil {
		log.Fatal(err)
	}
	auth := handlers.AuthHandler{DB: db, Secret: cfg.JWTSecret}
	docs := handlers.DocumentHandler{DB: db, UploadDir: cfg.UploadDir}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("POST /api/auth/register", auth.Register)
	mux.HandleFunc("POST /api/auth/login", auth.Login)
	protected := http.NewServeMux()
	protected.HandleFunc("GET /api/auth/me", auth.Me)
	protected.HandleFunc("POST /api/documents/upload", docs.Upload)
	protected.HandleFunc("GET /api/documents", docs.List)
	protected.HandleFunc("GET /api/documents/{id}/view", docs.View)
	protected.HandleFunc("GET /api/documents/{id}/download", docs.Download)
	protected.HandleFunc("DELETE /api/documents/{id}", docs.Delete)
	mux.Handle("/api/", middleware.Auth(cfg.JWTSecret)(protected))
	handler := cors(cfg.FrontendURL, mux)
	log.Printf("Go API running on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, handler))
}
func cors(origin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loadEnvFile() {
	f, err := os.Open(".env")
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
			if os.Getenv(key) == "" {
				_ = os.Setenv(key, value)
			}
		}
	}
}
