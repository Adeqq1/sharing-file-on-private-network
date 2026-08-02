package subtitle

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/html/charset"
)

// ===== Regex =====

// commaTimestamp mencocokkan timestamp SRT: 00:00:01,500 --> 00:00:04,000
var commaTimestamp = regexp.MustCompile(`(\d{2}:\d{2}:\d{2}),(\d{3})`)

// fontTagOpen dan fontTagClose mencocokkan <font ...> dan </font> yang tidak valid di WebVTT.
var fontTagOpen = regexp.MustCompile(`(?i)<font[^>]*>`)
var fontTagClose = regexp.MustCompile(`(?i)</font>`)

// ===== Task A: Pola Penamaan & Lang Alias =====

// LangAlias mengembalikan kode bahasa standar (ISO 639-1) dari berbagai variasi penulisan.
// Mengembalikan string kosong kalau tidak dikenal — caller tetap bisa pakai nilai aslinya.
func LangAlias(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	aliases := map[string]string{
		// Indonesia
		"id": "id", "ind": "id", "indonesian": "id", "indonesia": "id",
		// English
		"en": "en", "eng": "en", "english": "en",
		// Japanese
		"ja": "ja", "jp": "ja", "jpn": "ja", "japanese": "ja",
		// Korean
		"ko": "ko", "kor": "ko", "korean": "ko",
		// Chinese
		"zh": "zh", "chi": "zh", "zho": "zh", "chinese": "zh", "cn": "zh",
		// Spanish
		"es": "es", "spa": "es", "spanish": "es",
		// French
		"fr": "fr", "fra": "fr", "fre": "fr", "french": "fr",
		// German
		"de": "de", "ger": "de", "deu": "de", "german": "de",
		// Portuguese
		"pt": "pt", "por": "pt", "portuguese": "pt",
		// Arabic
		"ar": "ar", "ara": "ar", "arabic": "ar",
		// Thai
		"th": "th", "tha": "th", "thai": "th",
		// Vietnamese
		"vi": "vi", "vie": "vi", "vietnamese": "vi",
		// Malay
		"ms": "ms", "msa": "ms", "may": "ms", "malay": "ms",
	}
	if code, ok := aliases[s]; ok {
		return code
	}
	return ""
}

// MatchSubtitleFile mengecek apakah file `subFile` adalah subtitle untuk video `videoBase`.
// Mengembalikan (langCode, true) kalau cocok.
// langCode "" berarti subtitle default (tanpa kode bahasa eksplisit).
//
// Pola yang didukung (semua case-insensitive untuk basename):
//
//	<base>.srt / <base>.vtt                  — default subtitle
//	<base>.<lang>.srt / <base>.<lang>.vtt    — separator titik
//	<base>_<lang>.srt / <base>_<lang>.vtt    — separator underscore
//	<base>-<lang>.srt / <base>-<lang>.vtt    — separator dash
func MatchSubtitleFile(videoBase, subFile string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(subFile))
	if ext != ".srt" && ext != ".vtt" {
		return "", false
	}
	// Hapus ekstensi dari subFile (pakai filepath.Ext agar case-insensitive di Windows)
	stem := subFile[:len(subFile)-len(filepath.Ext(subFile))]

	stemLower := strings.ToLower(stem)
	baseLower := strings.ToLower(videoBase)

	// Pola 1: stem == base (default subtitle, tanpa kode bahasa)
	if stemLower == baseLower {
		return "", true
	}

	// Pola 2: stem = base + separator + lang
	for _, sep := range []string{".", "_", "-"} {
		prefix := baseLower + sep
		if !strings.HasPrefix(stemLower, prefix) {
			continue
		}
		// Ambil bagian setelah separator (pertahankan case asli untuk lang code)
		rest := stem[len(prefix):]
		if rest == "" {
			continue
		}
		// Normalisasi ke kode standar kalau dikenal, kalau tidak pakai lowercase aslinya
		lang := LangAlias(rest)
		if lang == "" {
			lang = strings.ToLower(rest)
		}
		return lang, true
	}

	return "", false
}

// ===== Task B: Strip BOM =====

// StripBOM menghilangkan UTF-8 BOM (U+FEFF) di awal string kalau ada.
// BOM sering muncul di file yang dibuat di Windows dan menyebabkan browser
// menolak file WebVTT karena header "WEBVTT" tidak di posisi pertama.
func StripBOM(s string) string {
	return strings.TrimPrefix(s, "\uFEFF")
}

// ===== Task C: Konversi Encoding =====

// ToUTF8 mendeteksi encoding dari raw bytes lalu mengkonversi ke UTF-8.
// Kalau sudah valid UTF-8, return apa adanya (zero-copy path).
// Kalau bukan UTF-8, coba deteksi encoding via heuristic (golang.org/x/net/html/charset).
func ToUTF8(data []byte) string {
	// Fast path: sudah valid UTF-8
	if utf8.Valid(data) {
		return string(data)
	}
	// Coba deteksi dan konversi encoding
	reader, err := charset.NewReader(bytes.NewReader(data), "text/plain")
	if err != nil {
		// Fallback: return as-is (mungkin garbled tapi tidak crash)
		return string(data)
	}
	converted, err := io.ReadAll(reader)
	if err != nil {
		return string(data)
	}
	return string(converted)
}

// ===== Task D: Strip HTML Tag Tidak Valid di WebVTT =====

// CleanCueTags menghapus tag HTML yang tidak didukung WebVTT dari teks cue.
// WebVTT mendukung: <b>, <i>, <u>, <ruby>, <rt>, <c.class>, <v Speaker>.
// Tidak mendukung: <font> (umum di SRT).
// Tag lain yang tidak dikenal dibiarkan — browser biasanya mengabaikannya dengan aman.
func CleanCueTags(s string) string {
	s = fontTagOpen.ReplaceAllString(s, "")
	s = fontTagClose.ReplaceAllString(s, "")
	return s
}

// ===== SRTToVTT (updated: terima []byte, gabungkan semua fix) =====

// SRTToVTT mengkonversi konten SRT (sebagai []byte) menjadi WebVTT string.
// Urutan pemrosesan:
//  1. Konversi encoding ke UTF-8 kalau perlu (Task C)
//  2. Strip UTF-8 BOM (Task B)
//  3. Normalisasi line ending ke \n
//  4. Ganti koma di timestamp jadi titik: "00:00:01,500" → "00:00:01.500"
//  5. Strip tag HTML yang tidak valid di WebVTT (Task D)
//  6. Tambah header "WEBVTT\n\n"
func SRTToVTT(data []byte) string {
	content := ToUTF8(data)
	content = StripBOM(content)
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	content = commaTimestamp.ReplaceAllString(content, "$1.$2")
	content = CleanCueTags(content)
	return "WEBVTT\n\n" + content
}

// vttTimestamp mencocokkan timestamp WebVTT: HH:MM:SS.mmm atau MM:SS.mmm
var vttTimestamp = regexp.MustCompile(`(\d{2}:)?\d{2}:\d{2}\.\d{3}`)

// ShiftVTT mengurangi semua timestamp dalam string WebVTT sebesar offsetSec detik.
// Digunakan untuk menyinkronkan subtitle dengan video transcode yang di-seek ke posisi
// tertentu — ffmpeg pakai -reset_timestamps 1 sehingga output selalu mulai dari 0,
// tapi subtitle masih punya timestamp absolut. Kurangi timestamp agar sinkron.
//
// Cue dengan endTime ≤ 0 setelah shift akan di-skip (tidak relevan sebelum posisi seek).
func ShiftVTT(vtt string, offsetSec float64) string {
	if offsetSec <= 0 {
		return vtt
	}
	lines := strings.Split(vtt, "\n")
	out := make([]string, 0, len(lines))
	i := 0
	for i < len(lines) {
		line := lines[i]
		// Deteksi baris timing cue: mengandung " --> "
		if strings.Contains(line, " --> ") {
			shifted, ok := shiftCueLine(line, offsetSec)
			if ok {
				out = append(out, shifted)
			} else {
				// Cue ini sebelum offset — skip cue beserta teksnya sampai baris kosong
				i++
				for i < len(lines) && lines[i] != "" {
					i++
				}
				continue
			}
		} else {
			out = append(out, line)
		}
		i++
	}
	return strings.Join(out, "\n")
}

// shiftCueLine menggeser satu baris timing "START --> END [settings]" sebesar -offsetSec.
// Mengembalikan (shifted, true) kalau endTime > 0 setelah shift, (_, false) kalau skip.
func shiftCueLine(line string, offsetSec float64) (string, bool) {
	// Split "START --> END [optional settings]"
	parts := strings.SplitN(line, " --> ", 2)
	if len(parts) != 2 {
		return line, true
	}
	startStr := strings.TrimSpace(parts[0])
	rest := parts[1] // bisa "END" atau "END position:..." dll

	// Pisahkan END dari setting opsional
	restParts := strings.SplitN(rest, " ", 2)
	endStr := restParts[0]
	settings := ""
	if len(restParts) == 2 {
		settings = " " + restParts[1]
	}

	start := parseVTTTime(startStr) - offsetSec
	end := parseVTTTime(endStr) - offsetSec

	if end <= 0 {
		return "", false // cue selesai sebelum offset seek
	}
	if start < 0 {
		start = 0
	}
	return fmt.Sprintf("%s --> %s%s", formatVTTTime(start), formatVTTTime(end), settings), true
}

// parseVTTTime mengurai timestamp VTT (HH:MM:SS.mmm atau MM:SS.mmm) ke detik float.
func parseVTTTime(s string) float64 {
	parts := strings.Split(s, ":")
	var h, m, sec float64
	switch len(parts) {
	case 3:
		fmt.Sscanf(parts[0], "%f", &h)
		fmt.Sscanf(parts[1], "%f", &m)
		fmt.Sscanf(strings.ReplaceAll(parts[2], ",", "."), "%f", &sec)
	case 2:
		fmt.Sscanf(parts[0], "%f", &m)
		fmt.Sscanf(strings.ReplaceAll(parts[1], ",", "."), "%f", &sec)
	}
	return h*3600 + m*60 + sec
}

// formatVTTTime mengubah detik float ke format timestamp VTT "HH:MM:SS.mmm".
func formatVTTTime(s float64) string {
	if s < 0 {
		s = 0
	}
	total := int(math.Round(s * 1000))
	ms := total % 1000
	total /= 1000
	sec := total % 60
	total /= 60
	min := total % 60
	h := total / 60
	return fmt.Sprintf("%02d:%02d:%02d.%03d", h, min, sec, ms)
}
