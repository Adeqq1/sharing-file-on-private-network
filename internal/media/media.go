package media

import "strings"

// Kind menyatakan tipe media untuk streaming di browser HTML5.
type Kind string

const (
	KindVideo       Kind = "video"
	KindAudio       Kind = "audio"
	KindUnsupported Kind = ""
)

// formatInfo menyimpan semua metadata format dalam satu struct.
// Satu sumber kebenaran — update di sini, berlaku di mana-mana.
type formatInfo struct {
	Kind    Kind   // tipe untuk browser HTML5 (kosong = tidak bisa di browser)
	MIME    string // MIME type untuk Content-Type header
	Browser bool   // bisa diputar langsung di browser HP (HTML5 native)
	Native  bool   // bisa di-stream ke app native HP (VLC, MX Player, dll)
}

// formats berisi semua format yang didukung untuk streaming.
// Browser = HTML5 compatible (mp4, webm, mp3, dll).
// Native  = bisa di-stream ke app native walaupun browser tidak support (mkv, avi, flac, dll).
var formats = map[string]formatInfo{
	// ── Browser-friendly + Native ──
	// Video
	"mp4":  {KindVideo, "video/mp4", true, true},
	"m4v":  {KindVideo, "video/mp4", true, true},
	"webm": {KindVideo, "video/webm", true, true},
	// MOV — iPhone/iPad H.264+AAC, bisa play di Safari iOS & Chrome Android
	"mov": {KindVideo, "video/quicktime", true, true},
	// Audio
	"mp3": {KindAudio, "audio/mpeg", true, true},
	"m4a": {KindAudio, "audio/mp4", true, true},
	"aac": {KindAudio, "audio/aac", true, true},
	"ogg": {KindAudio, "audio/ogg", true, true},
	"wav": {KindAudio, "audio/wav", true, true},

	// ── Native-only (browser tidak bisa native, tapi bisa via transcode ffmpeg) ──
	// Video
	// MKV: Chrome/Firefox support H.264+AAC di dalam container MKV.
	// Codec exotic (HEVC, AC3, dll) perlu transcode via /api/transcode.
	"mkv": {KindVideo, "video/x-matroska", true, true},
	// AVI/WMV/FLV/TS: selalu perlu transcode, tapi tetap di-mark KindVideo
	// agar frontend bisa buka di cplayer (dengan fallback ke /api/transcode).
	"avi": {KindVideo, "video/x-msvideo", false, true},
	"wmv": {KindVideo, "video/x-ms-wmv", false, true},
	"flv": {KindVideo, "video/x-flv", false, true},
	"ts":  {KindVideo, "video/mp2t", false, true},
	// Audio
	"flac": {KindAudio, "audio/flac", false, true},
	"wma":  {KindAudio, "audio/x-ms-wma", false, true},
}

// KindOf mengembalikan Kind dari extension (untuk semua format, termasuk native-only).
// Input di-lowercase otomatis.
func KindOf(ext string) Kind {
	if info, ok := formats[strings.ToLower(ext)]; ok {
		return info.Kind
	}
	return KindUnsupported
}

// KindForBrowser mengembalikan Kind hanya untuk format yang bisa diputar di browser HTML5.
// Format native-only (MKV, AVI, FLAC, dll) mengembalikan KindUnsupported.
func KindForBrowser(ext string) Kind {
	info, ok := formats[strings.ToLower(ext)]
	if !ok || !info.Browser {
		return KindUnsupported
	}
	return info.Kind
}

// IsNativePlayable mengembalikan true jika format bisa di-stream ke app native HP.
// Ini mencakup format browser-friendly DAN native-only.
func IsNativePlayable(ext string) bool {
	return formats[strings.ToLower(ext)].Native
}

// MIMEOf mengembalikan MIME type dari extension.
// Input di-lowercase otomatis. Mengembalikan string kosong jika tidak dikenal.
func MIMEOf(ext string) string {
	return formats[strings.ToLower(ext)].MIME
}

// NeedsTranscodeHint mengembalikan true untuk format video yang kemungkinan besar
// memerlukan transcode via ffmpeg sebelum bisa diputar di browser.
// Format ini tetap bisa dibuka di cplayer, tapi frontend harus pakai /api/transcode.
func NeedsTranscodeHint(ext string) bool {
	switch strings.ToLower(ext) {
	case "mkv", "avi", "wmv", "flv", "ts":
		return true
	}
	return false
}
