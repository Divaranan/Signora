package models

import "time"

type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"createdAt"`
}
type Document struct {
	ID           string    `json:"id"`
	UserID       string    `json:"userId"`
	Title        string    `json:"title"`
	OriginalName string    `json:"originalName"`
	FileSize     int64     `json:"fileSize"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}
