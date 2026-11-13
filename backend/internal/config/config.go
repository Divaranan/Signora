package config

import "os"

type Config struct {
	Port, DatabaseURL, JWTSecret, FrontendURL, UploadDir, SignedDir string
}

func Load() Config {
	return Config{
		Port:        get("PORT", "8080"),
		DatabaseURL: get("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/signora_db?sslmode=disable"),
		JWTSecret:   get("JWT_SECRET", "development_only_change_me"),
		FrontendURL: get("FRONTEND_URL", "http://localhost:3000"),
		UploadDir:   get("UPLOAD_DIR", "./uploads"),
		SignedDir:   get("SIGNED_DIR", "./signed"),
	}
}

func get(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
