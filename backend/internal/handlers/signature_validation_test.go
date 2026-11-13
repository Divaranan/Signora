package handlers

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestValidateSignatureData(t *testing.T) {
	tests := []struct {
		name string
		data string
		want bool
	}{
		{name: "visible PNG", data: signatureDataURL(t, "png", true), want: true},
		{name: "blank PNG", data: signatureDataURL(t, "png", false), want: false},
		{name: "visible JPEG", data: signatureDataURL(t, "jpeg", true), want: true},
		{name: "unsupported image type", data: "data:image/gif;base64,AAAA", want: false},
		{name: "malformed base64", data: "data:image/png;base64,not base64", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSignatureData(tt.data)
			if (err == nil) != tt.want {
				t.Fatalf("validateSignatureData() error = %v, want valid=%v", err, tt.want)
			}
		})
	}
}

func signatureDataURL(t *testing.T, format string, visible bool) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 100, 40))
	if visible {
		for y := 16; y < 24; y++ {
			for x := 20; x < 80; x++ {
				img.Set(x, y, color.Black)
			}
		}
	}

	var data bytes.Buffer
	var err error
	if format == "jpeg" {
		err = jpeg.Encode(&data, img, &jpeg.Options{Quality: 90})
	} else {
		err = png.Encode(&data, img)
	}
	if err != nil {
		t.Fatal(err)
	}
	mime := "png"
	if format == "jpeg" {
		mime = "jpeg"
	}
	return "data:image/" + mime + ";base64," + base64.StdEncoding.EncodeToString(data.Bytes())
}
