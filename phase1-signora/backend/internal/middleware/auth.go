package middleware

import (
	"context"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"phase1-signora/backend/internal/utils"
	"strings"
	"time"
)

type contextKey string

const UserIDKey contextKey = "userID"

type Claims struct {
	UserID string `json:"userId"`
	jwt.RegisteredClaims
}

func Auth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			parts := strings.SplitN(h, " ", 2)
			if len(parts) != 2 || parts[0] != "Bearer" {
				utils.Error(w, 401, "Missing or invalid authorization token")
				return
			}
			token, err := jwt.ParseWithClaims(parts[1], &Claims{}, func(t *jwt.Token) (any, error) { return []byte(secret), nil })
			if err != nil || !token.Valid {
				utils.Error(w, 401, "Invalid or expired token")
				return
			}
			claims, ok := token.Claims.(*Claims)
			if !ok || claims.UserID == "" {
				utils.Error(w, 401, "Invalid token claims")
				return
			}
			ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
func NewToken(userID, secret string) (string, error) {
	c := Claims{UserID: userID, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(secret))
}
func CurrentUserID(r *http.Request) string { v, _ := r.Context().Value(UserIDKey).(string); return v }
