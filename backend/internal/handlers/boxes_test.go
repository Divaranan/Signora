package handlers

import "testing"

func TestValidBoxGeometry(t *testing.T) {
	tests := []struct {
		name                string
		page                int
		x, y, width, height float64
		want                bool
	}{
		{name: "first page", page: 1, x: 10, y: 20, width: 30, height: 15, want: true},
		{name: "later page", page: 4, x: 0, y: 0, width: 100, height: 100, want: true},
		{name: "zero page", page: 0, x: 10, y: 10, width: 20, height: 20},
		{name: "box exceeds page", page: 1, x: 80, y: 10, width: 21, height: 20},
		{name: "zero width", page: 1, x: 10, y: 10, width: 0, height: 20},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := validBoxGeometry(tt.page, tt.x, tt.y, tt.width, tt.height); got != tt.want {
				t.Fatalf("validBoxGeometry() = %v, want %v", got, tt.want)
			}
		})
	}
}
