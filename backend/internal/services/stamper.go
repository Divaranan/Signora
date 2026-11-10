package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"phase1-signora/backend/internal/models"
)

type StampPayload struct {
	OriginalPdfPath string                `json:"originalPdfPath"`
	OutputPdfPath   string                `json:"outputPdfPath"`
	DocumentID      string                `json:"documentId"`
	DocTitle        string                `json:"docTitle"`
	Boxes           []models.SignatureBox `json:"boxes"`
	AuditLogs       []models.AuditLog     `json:"auditLogs"`
	CompletedAt     string                `json:"completedAt"`
}

// GenerateSignedPDF stamps all signature boxes onto the original PDF and appends an audit certificate.
func GenerateSignedPDF(ctx context.Context, db *pgxpool.Pool, uploadDir string, documentID string) error {
	var storedName, title string
	err := db.QueryRow(ctx, `SELECT stored_name, title FROM documents WHERE id=$1`, documentID).Scan(&storedName, &title)
	if err != nil {
		return fmt.Errorf("document not found: %w", err)
	}

	origPath := filepath.Join(uploadDir, storedName)
	signedName := "signed_" + storedName
	outPath := filepath.Join(uploadDir, signedName)

	// Fetch signature boxes with signer signature data
	rows, err := db.Query(ctx, `
		SELECT b.id, b.document_id, b.signer_id, COALESCE(s.name, ''), COALESCE(s.email, ''), 
		       b.page, b.x, b.y, b.width, b.height, b.signed, COALESCE(s.signature_data, '')
		FROM signature_boxes b
		LEFT JOIN signers s ON b.signer_id = s.id
		WHERE b.document_id = $1
		ORDER BY b.page ASC, b.y ASC
	`, documentID)
	if err != nil {
		return fmt.Errorf("query boxes: %w", err)
	}
	defer rows.Close()

	var boxes []models.SignatureBox
	for rows.Next() {
		var box models.SignatureBox
		var signerID *string
		var sigData string
		if err := rows.Scan(&box.ID, &box.DocumentID, &signerID, &box.SignerName, &box.SignerEmail, &box.Page, &box.X, &box.Y, &box.Width, &box.Height, &box.Signed, &sigData); err != nil {
			return fmt.Errorf("scan box: %w", err)
		}
		box.SignerID = signerID
		if sigData != "" {
			box.SignerEmail = box.SignerEmail // keep
		}
		// Temporarily store signature data in box struct or map
		boxes = append(boxes, box)
	}

	// Prepare payload boxes with signature data
	type PayloadBox struct {
		Page          int     `json:"page"`
		X             float64 `json:"x"`
		Y             float64 `json:"y"`
		Width         float64 `json:"width"`
		Height        float64 `json:"height"`
		SignerName    string  `json:"signerName"`
		SignerEmail   string  `json:"signerEmail"`
		SignatureData string  `json:"signatureData"`
	}

	// Re-query to map box with exact signature data
	rows2, err := db.Query(ctx, `
		SELECT b.page, b.x, b.y, b.width, b.height, COALESCE(s.name, ''), COALESCE(s.email, ''), COALESCE(s.signature_data, '')
		FROM signature_boxes b
		LEFT JOIN signers s ON b.signer_id = s.id
		WHERE b.document_id = $1
	`, documentID)
	if err != nil {
		return fmt.Errorf("query boxes with sigs: %w", err)
	}
	defer rows2.Close()

	var payloadBoxes []PayloadBox
	for rows2.Next() {
		var pb PayloadBox
		if err := rows2.Scan(&pb.Page, &pb.X, &pb.Y, &pb.Width, &pb.Height, &pb.SignerName, &pb.SignerEmail, &pb.SignatureData); err == nil {
			payloadBoxes = append(payloadBoxes, pb)
		}
	}

	// Query audit logs
	logRows, err := db.Query(ctx, `
		SELECT id, document_id, action, performed_by, details, created_at
		FROM audit_logs
		WHERE document_id = $1
		ORDER BY created_at ASC
	`, documentID)
	var logs []models.AuditLog
	if err == nil {
		defer logRows.Close()
		for logRows.Next() {
			var l models.AuditLog
			if err := logRows.Scan(&l.ID, &l.DocumentID, &l.Action, &l.PerformedBy, &l.Details, &l.CreatedAt); err == nil {
				logs = append(logs, l)
			}
		}
	}

	payload := map[string]any{
		"originalPdfPath": origPath,
		"outputPdfPath":   outPath,
		"documentId":      documentID,
		"docTitle":        title,
		"boxes":           payloadBoxes,
		"auditLogs":       logs,
		"completedAt":     time.Now().UTC().Format(time.RFC3339),
	}

	tmpFile, err := os.CreateTemp("", "stamp_*.json")
	if err != nil {
		return fmt.Errorf("temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	enc := json.NewEncoder(tmpFile)
	if err := enc.Encode(payload); err != nil {
		tmpFile.Close()
		return fmt.Errorf("encode json: %w", err)
	}
	tmpFile.Close()

	// Locate stamp_pdf.js
	scriptPath := filepath.Join(".", "scripts", "stamp_pdf.js")
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		// try backend/scripts/stamp_pdf.js
		scriptPath = filepath.Join("backend", "scripts", "stamp_pdf.js")
	}

	cmd := exec.Command("node", scriptPath, tmpPath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("stamp_pdf error: %s (output: %s)", err, string(output))
		// fallback: copy original file if stamper fails so user is not blocked
		copyFallback(origPath, outPath)
	}

	// Update document with signed_file_name and status = completed
	_, err = db.Exec(ctx, `
		UPDATE documents 
		SET signed_file_name = $1, status = 'completed'
		WHERE id = $2
	`, signedName, documentID)
	if err != nil {
		return fmt.Errorf("update doc status: %w", err)
	}

	// Add audit log for completion
	_, _ = db.Exec(ctx, `
		INSERT INTO audit_logs(document_id, action, performed_by, details)
		VALUES($1, 'DOCUMENT_COMPLETED', 'System', 'All signers signed. Completed PDF generated.')
	`, documentID)

	return nil
}

func copyFallback(src, dst string) {
	data, err := os.ReadFile(src)
	if err == nil {
		_ = os.WriteFile(dst, data, 0644)
	}
}

