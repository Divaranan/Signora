package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
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

// Signing links are valid for 7 days from issuance.
const signingLinkTTL = 7 * 24 * time.Hour

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

	signers := []models.Signer{}
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
	if err := rows.Err(); err != nil {
		utils.Error(w, 500, "Could not read signers")
		return
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
	if docStatus != "draft" {
		utils.Error(w, 400, "Cannot add signers after the document has been sent")
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
	if err := h.DB.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM signers WHERE document_id=$1 AND email=$2)`,
		docID, in.Email).Scan(&dup); err != nil {
		utils.Error(w, 500, "Could not check for duplicate signer")
		return
	}
	if dup {
		utils.Error(w, 409, "A signer with this email address has already been added to this document")
		return
	}

	// Every signer gets their own random token. The 7-day window restarts when the email is sent.
	token, err := generateSecureToken()
	if err != nil {
		utils.Error(w, 500, "Could not create secure signing link")
		return
	}
	expiresAt := time.Now().Add(signingLinkTTL)

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
	if docStatus != "draft" {
		utils.Error(w, 400, "Cannot remove signers after the document has been sent")
		return
	}

	err = h.DB.QueryRow(r.Context(), `
		DELETE FROM signers WHERE id=$1 AND document_id=$2 RETURNING id
	`, signerID, docID).Scan(&signerID)
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

	utils.JSON(w, 200, map[string]string{"message": "Signer removed successfully"})
}

type sendTarget struct {
	ID, Name, Email, Token string
	ExpiresAt              time.Time
}

type signerLink struct {
	SignerID   string `json:"signerId"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Token      string `json:"token"`
	SigningURL string `json:"signingUrl"`
}

// Send returns current signing links for every signer who has not signed yet.
func (h SignersHandler) Send(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var status string
	err := h.DB.QueryRow(ctx, `SELECT status FROM documents WHERE id=$1 AND user_id=$2`, docID, userID).Scan(&status)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}
	if status == "completed" {
		utils.Error(w, 400, "This document is already completed")
		return
	}

	// 1. Must have at least 1 signer
	var signerCount int
	err = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM signers WHERE document_id=$1`, docID).Scan(&signerCount)
	if err != nil {
		utils.Error(w, 500, "Could not verify document signers")
		return
	}
	if signerCount == 0 {
		utils.Error(w, 400, "Please add at least one signer before sending the document")
		return
	}

	// 2. Every box must be linked to a signer
	var unassignedBoxes int
	err = h.DB.QueryRow(ctx, `SELECT COUNT(*) FROM signature_boxes WHERE document_id=$1 AND signer_id IS NULL`, docID).Scan(&unassignedBoxes)
	if err != nil {
		utils.Error(w, 500, "Could not verify signature box assignments")
		return
	}
	if unassignedBoxes > 0 {
		utils.Error(w, 400, fmt.Sprintf("There are %d signature box(es) not yet assigned to a signer. Please assign all boxes first.", unassignedBoxes))
		return
	}
	var signersWithoutBoxes int
	err = h.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM signers s
		WHERE s.document_id=$1 AND s.status <> 'signed'
		  AND NOT EXISTS (
		    SELECT 1 FROM signature_boxes b
		    WHERE b.document_id=s.document_id AND b.signer_id=s.id
		  )
	`, docID).Scan(&signersWithoutBoxes)
	if err != nil {
		utils.Error(w, 500, "Could not verify signer signature boxes")
		return
	}
	if signersWithoutBoxes > 0 {
		utils.Error(w, 400, "Every pending signer must have at least one assigned signature box")
		return
	}

	// 3. Load the signers who still need to sign
	rows, err := h.DB.Query(ctx, `
		SELECT id, name, email, token, token_expires_at
		FROM signers
		WHERE document_id=$1 AND status <> 'signed'
		ORDER BY created_at ASC
	`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load signers")
		return
	}
	var targets []sendTarget
	for rows.Next() {
		var t sendTarget
		if err := rows.Scan(&t.ID, &t.Name, &t.Email, &t.Token, &t.ExpiresAt); err != nil {
			rows.Close()
			utils.Error(w, 500, "Could not read signers")
			return
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		utils.Error(w, 500, "Could not read signers")
		return
	}
	rows.Close()
	if len(targets) == 0 {
		utils.Error(w, 400, "All signers have already signed this document")
		return
	}

	if status == "draft" {
		if _, err := h.DB.Exec(ctx, `UPDATE documents SET status='pending' WHERE id=$1 AND status='draft'`, docID); err != nil {
			utils.Error(w, 500, "Could not update document status")
			return
		}
	}

	baseURL := strings.TrimRight(h.FrontendURL, "/")
	links := make([]signerLink, 0, len(targets))

	for _, t := range targets {
		token := t.Token
		if time.Now().After(t.ExpiresAt) {
			token, err = generateSecureToken()
			if err != nil {
				utils.Error(w, 500, "Could not create a secure signing link")
				return
			}
			expires := time.Now().Add(signingLinkTTL)
			if _, err := h.DB.Exec(ctx, `UPDATE signers SET token=$1, token_expires_at=$2 WHERE id=$3 AND status='pending'`, token, expires, t.ID); err != nil {
				utils.Error(w, 500, "Could not refresh an expired signing link")
				return
			}
		}

		link := fmt.Sprintf("%s/sign/%s", baseURL, token)
		links = append(links, signerLink{
			SignerID: t.ID, Name: t.Name, Email: t.Email, Token: token, SigningURL: link,
		})
	}

	utils.JSON(w, 200, map[string]any{
		"message": "Document is ready for signing. Share the links below with the signers.",
		"status":  "pending",
		"links":   links,
	})
}

func generateSecureToken() (string, error) {
	bytes := make([]byte, 24)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}
