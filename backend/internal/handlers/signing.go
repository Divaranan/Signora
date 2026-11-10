package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"phase1-signora/backend/internal/models"
	"phase1-signora/backend/internal/services"
	"phase1-signora/backend/internal/utils"
)

type SigningHandler struct {
	DB        *pgxpool.Pool
	UploadDir string
}

type SubmitSignatureRequest struct {
	SignatureData string `json:"signatureData"`
}

// GetSigningInfo loads document and boxes for a given signing token
func (h SigningHandler) GetSigningInfo(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if strings.TrimSpace(token) == "" {
		utils.Error(w, 400, "Signing token is required")
		return
	}

	var signer models.Signer
	var docTitle, originalName, docStatus string
	var signedAt *time.Time

	err := h.DB.QueryRow(r.Context(), `
		SELECT s.id, s.document_id, s.name, s.email, s.token, s.token_expires_at, s.status, s.signed_at,
		       d.title, d.original_name, d.status
		FROM signers s
		JOIN documents d ON s.document_id = d.id
		WHERE s.token = $1
	`, token).Scan(
		&signer.ID, &signer.DocumentID, &signer.Name, &signer.Email, &signer.Token,
		&signer.TokenExpiresAt, &signer.Status, &signedAt,
		&docTitle, &originalName, &docStatus,
	)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "Invalid signing link. The link does not exist or has been removed.")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not verify signing token")
		return
	}
	signer.SignedAt = signedAt

	// Check if already signed
	if signer.Status == "signed" {
		utils.Error(w, 409, "You have already completed signing this document.")
		return
	}

	// Check if expired
	if time.Now().After(signer.TokenExpiresAt) {
		utils.Error(w, 410, "This signing link has expired. Please contact the sender to request a new link.")
		return
	}

	// Fetch boxes assigned to this signer
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, document_id, signer_id, page, x, y, width, height, signed
		FROM signature_boxes
		WHERE document_id = $1 AND signer_id = $2
		ORDER BY page ASC, y ASC
	`, signer.DocumentID, signer.ID)
	if err != nil {
		utils.Error(w, 500, "Could not load signature boxes")
		return
	}
	defer rows.Close()

	var boxes []models.SignatureBox
	for rows.Next() {
		var b models.SignatureBox
		var signerID *string
		if err := rows.Scan(&b.ID, &b.DocumentID, &signerID, &b.Page, &b.X, &b.Y, &b.Width, &b.Height, &b.Signed); err == nil {
			b.SignerID = signerID
			b.SignerName = signer.Name
			b.SignerEmail = signer.Email
			boxes = append(boxes, b)
		}
	}

	// Audit log for document view (log once or on open)
	clientIP := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		clientIP = strings.Split(forwarded, ",")[0]
	}
	_, _ = h.DB.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details, ip_address)
		VALUES ($1, 'DOCUMENT_VIEWED', $2, 'Signer opened the document for review', $3)
	`, signer.DocumentID, fmt.Sprintf("%s (%s)", signer.Name, signer.Email), clientIP)

	utils.JSON(w, 200, map[string]any{
		"signer": signer,
		"document": map[string]any{
			"id":           signer.DocumentID,
			"title":        docTitle,
			"originalName": originalName,
			"status":       docStatus,
		},
		"boxes":      boxes,
		"totalBoxes": len(boxes),
	})
}

// ServeSigningPDF streams the original PDF to the signer
func (h SigningHandler) ServeSigningPDF(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	var storedName string
	err := h.DB.QueryRow(r.Context(), `
		SELECT d.stored_name
		FROM signers s
		JOIN documents d ON s.document_id = d.id
		WHERE s.token = $1
	`, token).Scan(&storedName)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}

	path := filepath.Join(h.UploadDir, filepath.Base(storedName))
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline")
	http.ServeFile(w, r, path)
}

// SubmitSignature processes the signer's submitted signature
func (h SigningHandler) SubmitSignature(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	var in SubmitSignatureRequest
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		utils.Error(w, 400, "Invalid request body")
		return
	}

	in.SignatureData = strings.TrimSpace(in.SignatureData)
	if in.SignatureData == "" || !strings.HasPrefix(in.SignatureData, "data:image") {
		utils.Error(w, 400, "Valid signature image data is required")
		return
	}

	var signerID, docID, signerName, signerEmail, currentStatus string
	var expiresAt time.Time
	err := h.DB.QueryRow(r.Context(), `
		SELECT s.id, s.document_id, s.name, s.email, s.status, s.token_expires_at
		FROM signers s
		WHERE s.token = $1
	`, token).Scan(&signerID, &docID, &signerName, &signerEmail, &currentStatus, &expiresAt)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "Invalid signing link")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not verify signing token")
		return
	}

	if currentStatus == "signed" {
		utils.Error(w, 409, "You have already submitted your signature for this document.")
		return
	}
	if time.Now().After(expiresAt) {
		utils.Error(w, 410, "This signing link has expired.")
		return
	}

	// Update signer to signed
	now := time.Now()
	_, err = h.DB.Exec(r.Context(), `
		UPDATE signers
		SET status = 'signed', signed_at = $1, signature_data = $2
		WHERE id = $3
	`, now, in.SignatureData, signerID)
	if err != nil {
		utils.Error(w, 500, "Could not save signature")
		return
	}

	// Mark all boxes for this signer as signed
	_, _ = h.DB.Exec(r.Context(), `
		UPDATE signature_boxes
		SET signed = true
		WHERE document_id = $1 AND signer_id = $2
	`, docID, signerID)

	// Audit log
	clientIP := r.RemoteAddr
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		clientIP = strings.Split(forwarded, ",")[0]
	}
	_, _ = h.DB.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details, ip_address)
		VALUES ($1, 'DOCUMENT_SIGNED', $2, 'Signer submitted electronic signature', $3)
	`, docID, fmt.Sprintf("%s (%s)", signerName, signerEmail), clientIP)

	// Check if all signers on this document have signed!
	var pendingCount int
	err = h.DB.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM signers
		WHERE document_id = $1 AND status != 'signed'
	`, docID).Scan(&pendingCount)

	allCompleted := false
	if err == nil && pendingCount == 0 {
		// All signers have signed! Trigger PDF stamping and finalize document
		allCompleted = true
		go func(did string) {
			_ = services.GenerateSignedPDF(context.Background(), h.DB, h.UploadDir, did)
		}(docID)
	}

	utils.JSON(w, 200, map[string]any{
		"message":      "Signature recorded successfully!",
		"signerName":   signerName,
		"signedAt":     now,
		"allCompleted": allCompleted,
	})
}
