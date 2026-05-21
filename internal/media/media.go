package media

import "strings"

// Kind menyatakan tipe media untuk streaming di browser HTML5.
type Kind string

const (
	KindVideo       Kind = "video"
	KindAudio       Kind = "audio"
	KindUnsupported Kind = ""
)

// formatInfo menyimpan Kind dan MIME type dalam satu struct.
// Menggabungkan dua map terpisah supaya tidak bisa out-of-sync.
type formatInfo struct {
	Kind Kind
	MIME string
}

// formats berisi semua format yang bisa di-stream langsung di HTML5 mobile browser.
// Hanya format tanpa transcoding (container + codec native browser).
// Satu sumber kebenaran untuk Kind dan MIME — update di sini, berlaku di mana-mana.
var formats = map[string]formatInfo{
	// Video — MP4 H.264/H.265 + AAC, WebM VP8/VP9
	"mp4":  {KindVideo, "video/mp4"},
	"m4v":  {KindVideo, "video/mp4"},
	"webm": {KindVideo, "video/webm"},
	// MOV — iPhone/iPad biasanya H.264+AAC, bisa play di Safari iOS & Chrome Android
	"mov": {KindVideo, "video/quicktime"},
	// Audio — MP3, AAC, OGG Vorbis, WAV, M4A
	"mp3": {KindAudio, "audio/mpeg"},
	"m4a": {KindAudio, "audio/mp4"},
	"aac": {KindAudio, "audio/aac"},
	"ogg": {KindAudio, "audio/ogg"},
	"wav": {KindAudio, "audio/wav"},
}

// KindOf mengembalikan Kind dari extension.
// Input di-lowercase otomatis, jadi "MP4" dan "mp4" menghasilkan hasil yang sama.
// Mengembalikan KindUnsupported ("") jika format tidak bisa di-stream langsung.
func KindOf(ext string) Kind {
	if info, ok := formats[strings.ToLower(ext)]; ok {
		return info.Kind
	}
	return KindUnsupported
}

// MIMEOf mengembalikan MIME type dari extension.
// Input di-lowercase otomatis.
// Mengembalikan string kosong jika tidak dikenal.
func MIMEOf(ext string) string {
	return formats[strings.ToLower(ext)].MIME
}
