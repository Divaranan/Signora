package handlers

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"
)

const maxSignaturePixels = 4_000_000

func validateSignatureData(dataURL string) error {
	const pngPrefix = "data:image/png;base64,"
	const jpegPrefix = "data:image/jpeg;base64,"

	var prefix, expectedFormat string
	switch {
	case strings.HasPrefix(dataURL, pngPrefix):
		prefix, expectedFormat = pngPrefix, "png"
	case strings.HasPrefix(dataURL, jpegPrefix):
		prefix, expectedFormat = jpegPrefix, "jpeg"
	default:
		return fmt.Errorf("Signature must be a PNG or JPEG image")
	}

	encoded := strings.TrimPrefix(dataURL, prefix)
	raw, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(raw) == 0 {
		return fmt.Errorf("Signature image data is invalid")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || format != expectedFormat || config.Width <= 0 || config.Height <= 0 ||
		int64(config.Width)*int64(config.Height) > maxSignaturePixels {
		return fmt.Errorf("Signature image is invalid or too large")
	}

	img, format, err := image.Decode(bytes.NewReader(raw))
	if err != nil || format != expectedFormat {
		return fmt.Errorf("Signature image is invalid")
	}
	bounds := img.Bounds()
	minVisible := bounds.Dx() * bounds.Dy() / 5000
	if minVisible < 1 {
		minVisible = 1
	}
	visible := 0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if a > 0x1000 && (r < 0xf800 || g < 0xf800 || b < 0xf800) {
				visible++
				if visible >= minVisible {
					return nil
				}
			}
		}
	}
	return fmt.Errorf("Signature image appears blank")
}
