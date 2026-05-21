package media

// Kind menyatakan tipe media untuk streaming di browser HTML5.
type Kind string

const (
	KindVideo       Kind = "video"
	KindAudio       Kind = "audio"
	KindUnsupported Kind = ""
)

// streamable berisi ekstensi yang dijamin jalan di HTML5 mobile browser modern.
// Hanya format yang bisa di-stream tanpa transcoding (container + codec native browser).
var streamable = map[string]Kind{
	// Video — MP4 H.264/H.265 + AAC, WebM VP8/VP9
	"mp4":  KindVideo,
	"m4v":  KindVideo,
	"webm": KindVideo,
	// Audio — MP3, AAC, OGG Vorbis, WAV, M4A
	"mp3": KindAudio,
	"m4a": KindAudio,
	"aac": KindAudio,
	"ogg": KindAudio,
	"wav": KindAudio,
}

// MIMETypes memetakan ekstensi ke MIME type yang benar untuk header Content-Type.
var MIMETypes = map[string]string{
	"mp4":  "video/mp4",
	"m4v":  "video/mp4",
	"webm": "video/webm",
	"mp3":  "audio/mpeg",
	"m4a":  "audio/mp4",
	"aac":  "audio/aac",
	"ogg":  "audio/ogg",
	"wav":  "audio/wav",
}

// KindOf mengembalikan Kind dari extension (lowercase, tanpa titik).
// Mengembalikan KindUnsupported ("") jika format tidak bisa di-stream langsung.
func KindOf(ext string) Kind {
	if k, ok := streamable[ext]; ok {
		return k
	}
	return KindUnsupported
}

// MIMEOf mengembalikan MIME type dari extension.
// Mengembalikan string kosong jika tidak dikenal.
func MIMEOf(ext string) string {
	return MIMETypes[ext]
}
