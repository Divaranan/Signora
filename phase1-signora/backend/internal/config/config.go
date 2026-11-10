package config

import "os"

type Config struct{ Port, DatabaseURL, JWTSecret, FrontendURL, UploadDir string }

func Load() Config {
	return Config{get("PORT", "8080"), get("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/signora_db?sslmode=disable"), get("JWT_SECRET", "development_only_change_me"), get("FRONTEND_URL", "http://localhost:3000"), get("UPLOAD_DIR", "./uploads")}
}
func get(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
