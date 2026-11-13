package handlers

import (
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"phase1-signora/backend/internal/middleware"
	"phase1-signora/backend/internal/utils"
	"strings"
)

type AuthHandler struct {
	DB     *pgxpool.Pool
	Secret string
}
type authInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var in authInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		utils.Error(w, 400, "Invalid request body")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.Name == "" || in.Email == "" || len(in.Password) < 8 {
		utils.Error(w, 400, "Name, valid email and password (at least 8 characters) are required")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		utils.Error(w, 500, "Could not secure password")
		return
	}
	var id string
	err = h.DB.QueryRow(r.Context(), `INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id`, in.Name, in.Email, string(hash)).Scan(&id)
	if err != nil {
		utils.Error(w, 409, "Email is already registered or could not be saved")
		return
	}
	token, err := middleware.NewToken(id, h.Secret)
	if err != nil {
		utils.Error(w, 500, "Could not create session")
		return
	}
	utils.JSON(w, 201, map[string]any{"message": "Registration successful", "token": token, "user": map[string]string{"id": id, "name": in.Name, "email": in.Email}})
}
func (h AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var in authInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		utils.Error(w, 400, "Invalid request body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	var id, name, hash string
	err := h.DB.QueryRow(r.Context(), `SELECT id,name,password_hash FROM users WHERE email=$1`, email).Scan(&id, &name, &hash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		utils.Error(w, 401, "Invalid email or password")
		return
	}
	token, err := middleware.NewToken(id, h.Secret)
	if err != nil {
		utils.Error(w, 500, "Could not create session")
		return
	}
	utils.JSON(w, 200, map[string]any{"message": "Login successful", "token": token, "user": map[string]string{"id": id, "name": name, "email": email}})
}
func (h AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	id := middleware.CurrentUserID(r)
	var name, email string
	err := h.DB.QueryRow(r.Context(), `SELECT name,email FROM users WHERE id=$1`, id).Scan(&name, &email)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "User not found")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not load user")
		return
	}
	utils.JSON(w, 200, map[string]string{"id": id, "name": name, "email": email})
}
