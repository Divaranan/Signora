package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"phase1-signora/backend/internal/middleware"
	"phase1-signora/backend/internal/models"
	"phase1-signora/backend/internal/utils"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

type SignersHandler struct {
	DB          *pgxpool.Pool
	FrontendURL string
}

type addSignerInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// List signers for a document
func (h SignersHandler) List(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	// Verify document belongs to user
	var exists bool
	err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM documents WHERE id=$1 AND user_id=$2)`, docID, userID).Scan(&exists)
	if err != nil || !exists {
		utils.Error(w, 404, "Document not found")
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, document_id, name, email, token, token_expires_at, status, signed_at, created_at
		FROM signers
		WHERE document_id = $1
		ORDER BY created_at ASC
	`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load signers")
		return
	}
	defer rows.Close()

	var signers []models.Signer
	for rows.Next() {
		var s models.Signer
		var signedAt *time.Time
		if err := rows.Scan(&s.ID, &s.DocumentID, &s.Name, &s.Email, &s.Token, &s.TokenExpiresAt, &s.Status, &signedAt, &s.CreatedAt); err != nil {
			utils.Error(w, 500, "Could not read signers")
			return
		}
		s.SignedAt = signedAt
		signers = append(signers, s)
	}

	utils.JSON(w, 200, map[string]any{"signers": signers})
}

// Add signer to document
func (h SignersHandler) Add(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var docStatus string
	err := h.DB.QueryRow(r.Context(), `SELECT status FROM documents WHERE id=$1 AND user_id=$2`, docID, userID).Scan(&docStatus)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}
	if docStatus == "completed" {
		utils.Error(w, 400, "Cannot add signers to a completed document")
		return
	}

	var in addSignerInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		utils.Error(w, 400, "Invalid request body")
		return
	}

	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))

	if in.Name == "" {
		utils.Error(w, 400, "Signer name is required")
		return
	}
	if in.Email == "" || !emailRegex.MatchString(in.Email) {
		utils.Error(w, 400, "A valid signer email address is required")
		return
	}

	// Check duplicate email for this document
	var dup bool
	_ = h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM signers WHERE document_id=$1 AND email=$2)`, docID, in.Email).Scan(&dup)
	if dup {
		utils.Error(w, 409, "A signer with this email address has already been added to this document")
		return
	}

	token := generateSecureToken()
	expiresAt := time.Now().Add(14 * 24 * time.Hour) // 14 days expiration

	var newSigner models.Signer
	err = h.DB.QueryRow(r.Context(), `
		INSERT INTO signers (document_id, name, email, token, token_expires_at, status)
		VALUES ($1, $2, $3, $4, $5, 'pending')
		RETURNING id, document_id, name, email, token, token_expires_at, status, created_at
	`, docID, in.Name, in.Email, token, expiresAt).Scan(
		&newSigner.ID, &newSigner.DocumentID, &newSigner.Name, &newSigner.Email,
		&newSigner.Token, &newSigner.TokenExpiresAt, &newSigner.Status, &newSigner.CreatedAt,
	)
	if err != nil {
		utils.Error(w, 500, "Could not add signer")
		return
	}

	// Audit log
	_, _ = h.DB.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details)
		VALUES ($1, 'SIGNER_ADDED', 'Sender', $2)
	`, docID, fmt.Sprintf("Added signer %s (%s)", in.Name, in.Email))

	utils.JSON(w, 201, map[string]any{"message": "Signer added successfully", "signer": newSigner})
}

// Remove signer
func (h SignersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	signerID := r.PathValue("signerId")
	userID := middleware.CurrentUserID(r)

	// Verify doc ownership
	var docStatus string
	err := h.DB.QueryRow(r.Context(), `SELECT status FROM documents WHERE id=$1 AND user_id=$2`, docID, userID).Scan(&docStatus)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}
	if docStatus == "completed" {
		utils.Error(w, 400, "Cannot remove signers from a completed document")
		return
	}

	var signerName, signerEmail string
	err = h.DB.QueryRow(r.Context(), `
		DELETE FROM signers WHERE id=$1 AND document_id=$2 RETURNING name, email
	`, signerID, docID).Scan(&signerName, &signerEmail)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "Signer not found")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not remove signer")
		return
	}

	// Unlink any signature boxes assigned to this signer
	_, _ = h.DB.Exec(r.Context(), `UPDATE signature_boxes SET signer_id=NULL WHERE signer_id=$1`, signerID)

	// Audit log
	_, _ = h.DB.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details)
		VALUES ($1, 'SIGNER_REMOVED', 'Sender', $2)
	`, docID, fmt.Sprintf("Removed signer %s (%s)", signerName, signerEmail))

	utils.JSON(w, 200, map[string]string{"message": "Signer removed successfully"})
}

// Send document for signing
func (h SignersHandler) Send(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var docTitle, status string
	err := h.DB.QueryRow(r.Context(), `SELECT title, status FROM documents WHERE id=$1 AND user_id=$2`, docID, userID).Scan(&docTitle, &status)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}

	// 1. Must have at least 1 signer
	var signerCount int
	err = h.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM signers WHERE document_id=$1`, docID).Scan(&signerCount)
	if err != nil || signerCount == 0 {
		utils.Error(w, 400, "Please add at least one signer before sending the document")
		return
	}

	// 2. Check boxes: each box should be linked to a signer
	var unassignedBoxes int
	_ = h.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM signature_boxes WHERE document_id=$1 AND signer_id IS NULL`, docID).Scan(&unassignedBoxes)
	if unassignedBoxes > 0 {
		utils.Error(w, 400, fmt.Sprintf("There are %d signature box(es) not yet assigned to a signer. Please assign all boxes first.", unassignedBoxes))
		return
	}

	// Update document status to pending
	_, err = h.DB.Exec(r.Context(), `UPDATE documents SET status='pending' WHERE id=$1`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not update document status")
		return
	}

	// Audit log
	_, _ = h.DB.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details)
		VALUES ($1, 'DOCUMENT_SENT', 'Sender', $2)
	`, docID, fmt.Sprintf("Document sent to %d signer(s) for electronic signatures", signerCount))

	// Fetch signers with signing links
	rows, err := h.DB.Query(r.Context(), `SELECT id, name, email, token FROM signers WHERE document_id=$1`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load signers")
		return
	}
	defer rows.Close()

	type SignerLink struct {
		Name       string `json:"name"`
		Email      string `json:"email"`
		SigningURL string `json:"signingUrl"`
	}

	var links []SignerLink
	for rows.Next() {
		var id, name, email, token string
		if err := rows.Scan(&id, &name, &email, &token); err == nil {
			links = append(links, SignerLink{
				Name:       name,
				Email:      email,
				SigningURL: fmt.Sprintf("%s/sign/%s", h.FrontendURL, token),
			})
		}
	}

	utils.JSON(w, 200, map[string]any{
		"message": "Document sent for signing successfully! Signing emails/links generated.",
		"status":  "pending",
		"links":   links,
	})
}

func generateSecureToken() string {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("tok_%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}
