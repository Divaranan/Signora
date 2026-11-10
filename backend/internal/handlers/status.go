package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"phase1-signora/backend/internal/middleware"
	"phase1-signora/backend/internal/models"
	"phase1-signora/backend/internal/utils"
)

type StatusHandler struct {
	DB        *pgxpool.Pool
	UploadDir string
}

// GetStatus returns the complete status, progress bar data, signers, boxes, and audit timeline
func (h StatusHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var doc models.Document
	var signedFileName *string
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, user_id, title, original_name, stored_name, signed_file_name, file_size, status, created_at
		FROM documents
		WHERE id = $1 AND user_id = $2
	`, docID, userID).Scan(
		&doc.ID, &doc.UserID, &doc.Title, &doc.OriginalName, &doc.StoredName,
		&signedFileName, &doc.FileSize, &doc.Status, &doc.CreatedAt,
	)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "Document not found")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not load document")
		return
	}
	doc.SignedFileName = signedFileName

	// Query signers
	signerRows, err := h.DB.Query(r.Context(), `
		SELECT id, document_id, name, email, token, token_expires_at, status, signed_at, created_at
		FROM signers
		WHERE document_id = $1
		ORDER BY created_at ASC
	`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load signers")
		return
	}
	defer signerRows.Close()

	var signers []models.Signer
	signedCount := 0
	for signerRows.Next() {
		var s models.Signer
		var signedAt *time.Time
		if err := signerRows.Scan(&s.ID, &s.DocumentID, &s.Name, &s.Email, &s.Token, &s.TokenExpiresAt, &s.Status, &signedAt, &s.CreatedAt); err == nil {
			s.SignedAt = signedAt
			if s.Status == "signed" {
				signedCount++
			}
			signers = append(signers, s)
		}
	}

	// Query boxes
	boxRows, err := h.DB.Query(r.Context(), `
		SELECT b.id, b.document_id, b.signer_id, COALESCE(s.name, ''), COALESCE(s.email, ''),
		       b.page, b.x, b.y, b.width, b.height, b.signed, b.created_at
		FROM signature_boxes b
		LEFT JOIN signers s ON b.signer_id = s.id
		WHERE b.document_id = $1
		ORDER BY b.page ASC, b.created_at ASC
	`, docID)
	var boxes []models.SignatureBox
	if err == nil {
		defer boxRows.Close()
		for boxRows.Next() {
			var b models.SignatureBox
			var signerID *string
			if err := boxRows.Scan(&b.ID, &b.DocumentID, &signerID, &b.SignerName, &b.SignerEmail, &b.Page, &b.X, &b.Y, &b.Width, &b.Height, &b.Signed, &b.CreatedAt); err == nil {
				b.SignerID = signerID
				boxes = append(boxes, b)
			}
		}
	}

	// Query audit logs
	logRows, err := h.DB.Query(r.Context(), `
		SELECT id, document_id, action, performed_by, details, created_at
		FROM audit_logs
		WHERE document_id = $1
		ORDER BY created_at ASC
	`, docID)
	var auditLogs []models.AuditLog
	if err == nil {
		defer logRows.Close()
		for logRows.Next() {
			var l models.AuditLog
			if err := logRows.Scan(&l.ID, &l.DocumentID, &l.Action, &l.PerformedBy, &l.Details, &l.CreatedAt); err == nil {
				auditLogs = append(auditLogs, l)
			}
		}
	}

	totalSigners := len(signers)
	progress := 0
	if totalSigners > 0 {
		progress = (signedCount * 100) / totalSigners
	}

	hasSignedPdf := doc.Status == "completed" && doc.SignedFileName != nil && *doc.SignedFileName != ""

	summary := models.DocumentStatusSummary{
		Document:     doc,
		Signers:      signers,
		Boxes:        boxes,
		AuditLogs:    auditLogs,
		TotalSigners: totalSigners,
		SignedCount:  signedCount,
		Progress:     progress,
		HasSignedPDF: hasSignedPdf,
	}

	utils.JSON(w, 200, summary)
}

// DownloadSigned downloads the completed, signed PDF
func (h StatusHandler) DownloadSigned(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var status, originalName, storedName string
	var signedName *string
	err := h.DB.QueryRow(r.Context(), `
		SELECT status, original_name, stored_name, signed_file_name
		FROM documents
		WHERE id = $1 AND user_id = $2
	`, docID, userID).Scan(&status, &originalName, &storedName, &signedName)
	if err == pgx.ErrNoRows {
		utils.Error(w, 404, "Document not found")
		return
	}
	if err != nil {
		utils.Error(w, 500, "Could not load document")
		return
	}

	if status != "completed" {
		utils.Error(w, 400, "Signed PDF is only available after all signers have signed the document.")
		return
	}

	fileToServe := storedName
	if signedName != nil && *signedName != "" {
		fileToServe = *signedName
	}

	filePath := filepath.Join(h.UploadDir, filepath.Base(fileToServe))
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		// Fallback to original if signed file is missing
		filePath = filepath.Join(h.UploadDir, filepath.Base(storedName))
	}

	baseName := strings.TrimSuffix(originalName, filepath.Ext(originalName))
	downloadName := fmt.Sprintf("%s_signed.pdf", baseName)

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, strings.ReplaceAll(downloadName, "\"", "")))
	http.ServeFile(w, r, filePath)
}

// GetAuditLogs returns the audit trail logs for the document
func (h StatusHandler) GetAuditLogs(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	// Verify doc ownership
	var exists bool
	err := h.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM documents WHERE id=$1 AND user_id=$2)`, docID, userID).Scan(&exists)
	if err != nil || !exists {
		utils.Error(w, 404, "Document not found")
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, document_id, action, performed_by, details, created_at
		FROM audit_logs
		WHERE document_id = $1
		ORDER BY created_at ASC
	`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load audit logs")
		return
	}
	defer rows.Close()

	var logs []models.AuditLog
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.DocumentID, &l.Action, &l.PerformedBy, &l.Details, &l.CreatedAt); err == nil {
			logs = append(logs, l)
		}
	}

	utils.JSON(w, 200, map[string]any{"auditLogs": logs})
}
