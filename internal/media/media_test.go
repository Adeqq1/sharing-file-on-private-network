package media

import "testing"

func TestKindOf(t *testing.T) {
	cases := []struct {
		ext  string
		want Kind
	}{
		// Browser-friendly video
		{"mp4", KindVideo}, {"MP4", KindVideo}, {"Mp4", KindVideo},
		{"m4v", KindVideo}, {"webm", KindVideo}, {"mov", KindVideo},
		// Browser-friendly audio
		{"mp3", KindAudio}, {"MP3", KindAudio},
		{"m4a", KindAudio}, {"aac", KindAudio}, {"ogg", KindAudio}, {"wav", KindAudio},
		// Native-only video — KindOf harus tetap return Kind (bukan Unsupported)
		{"mkv", KindVideo}, {"avi", KindVideo}, {"wmv", KindVideo},
		{"flv", KindVideo}, {"ts", KindVideo},
		// Native-only audio
		{"flac", KindAudio}, {"wma", KindAudio},
		// Tidak didukung sama sekali
		{"txt", KindUnsupported}, {"pdf", KindUnsupported}, {"", KindUnsupported},
	}
	for _, c := range cases {
		got := KindOf(c.ext)
		if got != c.want {
			t.Errorf("KindOf(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

func TestKindForBrowser(t *testing.T) {
	cases := []struct {
		ext  string
		want Kind
	}{
		// Browser-friendly → harus return Kind
		{"mp4", KindVideo}, {"webm", KindVideo}, {"mov", KindVideo},
		{"mp3", KindAudio}, {"m4a", KindAudio}, {"wav", KindAudio},
		// Native-only → harus return KindUnsupported (browser tidak bisa)
		{"mkv", KindUnsupported}, {"avi", KindUnsupported}, {"wmv", KindUnsupported},
		{"flac", KindUnsupported}, {"wma", KindUnsupported},
		// Tidak dikenal
		{"txt", KindUnsupported}, {"", KindUnsupported},
	}
	for _, c := range cases {
		got := KindForBrowser(c.ext)
		if got != c.want {
			t.Errorf("KindForBrowser(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

func TestIsNativePlayable(t *testing.T) {
	cases := []struct {
		ext  string
		want bool
	}{
		// Browser-friendly juga native-playable
		{"mp4", true}, {"webm", true}, {"mp3", true}, {"wav", true},
		// Native-only
		{"mkv", true}, {"avi", true}, {"wmv", true}, {"flac", true}, {"wma", true},
		// Tidak didukung
		{"txt", false}, {"pdf", false}, {"zip", false}, {"", false},
	}
	for _, c := range cases {
		got := IsNativePlayable(c.ext)
		if got != c.want {
			t.Errorf("IsNativePlayable(%q) = %v, want %v", c.ext, got, c.want)
		}
	}
}

func TestMIMEOf(t *testing.T) {
	cases := []struct {
		ext  string
		want string
	}{
		{"mp4", "video/mp4"}, {"MP4", "video/mp4"},
		{"webm", "video/webm"}, {"mov", "video/quicktime"},
		{"mp3", "audio/mpeg"}, {"m4a", "audio/mp4"},
		{"mkv", "video/x-matroska"}, {"avi", "video/x-msvideo"},
		{"flac", "audio/flac"}, {"wma", "audio/x-ms-wma"},
		{"txt", ""}, {"", ""},
	}
	for _, c := range cases {
		got := MIMEOf(c.ext)
		if got != c.want {
			t.Errorf("MIMEOf(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

// TestKindAndMIMEConsistency memastikan setiap entry di formats punya Kind dan MIME.
func TestKindAndMIMEConsistency(t *testing.T) {
	for ext, info := range formats {
		if info.Kind == KindUnsupported {
			t.Errorf("formats[%q].Kind tidak boleh KindUnsupported — hapus entry ini", ext)
		}
		if info.MIME == "" {
			t.Errorf("formats[%q].MIME kosong — setiap format harus punya MIME type", ext)
		}
		if !info.Browser && !info.Native {
			t.Errorf("formats[%q]: harus Browser=true atau Native=true (atau keduanya)", ext)
		}
	}
}
