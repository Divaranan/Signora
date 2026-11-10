package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"phase1-signora/backend/internal/middleware"
	"phase1-signora/backend/internal/models"
	"phase1-signora/backend/internal/utils"
)

type BoxesHandler struct {
	DB *pgxpool.Pool
}

type BoxInput struct {
	ID       *string  `json:"id,omitempty"`
	SignerID *string  `json:"signerId"`
	Page     int      `json:"page"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	Width    float64  `json:"width"`
	Height   float64  `json:"height"`
}

type SaveBoxesRequest struct {
	Boxes []BoxInput `json:"boxes"`
}

// List all boxes for a document
func (h BoxesHandler) List(w http.ResponseWriter, r *http.Request) {
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
		SELECT b.id, b.document_id, b.signer_id, COALESCE(s.name, ''), COALESCE(s.email, ''),
		       b.page, b.x, b.y, b.width, b.height, b.signed, b.created_at
		FROM signature_boxes b
		LEFT JOIN signers s ON b.signer_id = s.id
		WHERE b.document_id = $1
		ORDER BY b.page ASC, b.created_at ASC
	`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not load signature boxes")
		return
	}
	defer rows.Close()

	var boxes []models.SignatureBox
	for rows.Next() {
		var b models.SignatureBox
		var signerID *string
		if err := rows.Scan(&b.ID, &b.DocumentID, &signerID, &b.SignerName, &b.SignerEmail, &b.Page, &b.X, &b.Y, &b.Width, &b.Height, &b.Signed, &b.CreatedAt); err != nil {
			utils.Error(w, 500, "Could not read boxes")
			return
		}
		b.SignerID = signerID
		boxes = append(boxes, b)
	}

	utils.JSON(w, 200, map[string]any{"boxes": boxes})
}

// Save (replace) all boxes for a document
func (h BoxesHandler) Save(w http.ResponseWriter, r *http.Request) {
	docID := r.PathValue("id")
	userID := middleware.CurrentUserID(r)

	var docStatus string
	err := h.DB.QueryRow(r.Context(), `SELECT status FROM documents WHERE id=$1 AND user_id=$2`, docID, userID).Scan(&docStatus)
	if err != nil {
		utils.Error(w, 404, "Document not found")
		return
	}
	if docStatus == "completed" {
		utils.Error(w, 400, "Cannot modify signature boxes on a completed document")
		return
	}

	var req SaveBoxesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.Error(w, 400, "Invalid request body")
		return
	}

	// Begin transaction
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		utils.Error(w, 500, "Database transaction error")
		return
	}
	defer tx.Rollback(r.Context())

	// Delete existing boxes
	_, err = tx.Exec(r.Context(), `DELETE FROM signature_boxes WHERE document_id = $1`, docID)
	if err != nil {
		utils.Error(w, 500, "Could not clear existing boxes")
		return
	}

	// Insert new boxes
	for _, box := range req.Boxes {
		if box.Page < 1 {
			box.Page = 1
		}
		if box.Width <= 0 {
			box.Width = 18
		}
		if box.Height <= 0 {
			box.Height = 7
		}

		// Ensure box is within 0-100% bounds
		if box.X < 0 {
			box.X = 0
		}
		if box.Y < 0 {
			box.Y = 0
		}
		if box.X+box.Width > 100 {
			box.X = 100 - box.Width
		}
		if box.Y+box.Height > 100 {
			box.Y = 100 - box.Height
		}

		_, err = tx.Exec(r.Context(), `
			INSERT INTO signature_boxes (document_id, signer_id, page, x, y, width, height, signed)
			VALUES ($1, $2, $3, $4, $5, $6, $7, false)
		`, docID, box.SignerID, box.Page, box.X, box.Y, box.Width, box.Height)
		if err != nil {
			utils.Error(w, 500, "Could not save signature box")
			return
		}
	}

	// Add audit log
	_, _ = tx.Exec(r.Context(), `
		INSERT INTO audit_logs (document_id, action, performed_by, details)
		VALUES ($1, 'BOXES_SAVED', 'Sender', $2)
	`, docID, fmt.Sprintf("Placed and saved %d signature box(es)", len(req.Boxes)))

	if err := tx.Commit(r.Context()); err != nil {
		utils.Error(w, 500, "Could not commit transaction")
		return
	}

	utils.JSON(w, 200, map[string]any{
		"message": "Signature boxes saved successfully",
		"count":   len(req.Boxes),
	})
}
