package subtitle

import (
	"regexp"
	"strings"
)

// commaTimestamp mencocokkan timestamp SRT: 00:00:01,500 --> 00:00:04,000
var commaTimestamp = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

// SRTToVTT mengkonversi konten SRT menjadi WebVTT.
// Perubahan yang dilakukan:
//  1. Normalisasi line ending ke \n
//  2. Tambah header "WEBVTT\n\n" di awal
//  3. Ganti koma di timestamp jadi titik: "00:00:01,500" → "00:00:01.500"
func SRTToVTT(srtContent string) string {
	// Normalisasi CRLF → LF
	srtContent = strings.ReplaceAll(srtContent, "\r\n", "\n")
	srtContent = strings.ReplaceAll(srtContent, "\r", "\n")
	// Ganti koma di timestamp jadi titik
	converted := commaTimestamp.ReplaceAllString(srtContent, "$1.$2")
	return "WEBVTT\n\n" + converted
}
