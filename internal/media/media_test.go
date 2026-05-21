package media

import "testing"

func TestKindOf(t *testing.T) {
	cases := []struct {
		ext  string
		want Kind
	}{
		// Format video
		{"mp4", KindVideo},
		{"MP4", KindVideo}, // uppercase harus jalan
		{"Mp4", KindVideo}, // mixed case
		{"m4v", KindVideo},
		{"webm", KindVideo},
		{"mov", KindVideo},
		// Format audio
		{"mp3", KindAudio},
		{"MP3", KindAudio},
		{"m4a", KindAudio},
		{"aac", KindAudio},
		{"ogg", KindAudio},
		{"wav", KindAudio},
		// Format tidak didukung
		{"mkv", KindUnsupported},
		{"avi", KindUnsupported},
		{"flac", KindUnsupported},
		{"wmv", KindUnsupported},
		{"txt", KindUnsupported},
		{"pdf", KindUnsupported},
		{"", KindUnsupported},
	}

	for _, c := range cases {
		got := KindOf(c.ext)
		if got != c.want {
			t.Errorf("KindOf(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

func TestMIMEOf(t *testing.T) {
	cases := []struct {
		ext  string
		want string
	}{
		{"mp4", "video/mp4"},
		{"MP4", "video/mp4"}, // uppercase
		{"webm", "video/webm"},
		{"mov", "video/quicktime"},
		{"mp3", "audio/mpeg"},
		{"m4a", "audio/mp4"},
		{"aac", "audio/aac"},
		{"ogg", "audio/ogg"},
		{"wav", "audio/wav"},
		// Tidak dikenal → string kosong
		{"mkv", ""},
		{"txt", ""},
		{"", ""},
	}

	for _, c := range cases {
		got := MIMEOf(c.ext)
		if got != c.want {
			t.Errorf("MIMEOf(%q) = %q, want %q", c.ext, got, c.want)
		}
	}
}

// TestKindAndMIMEConsistency memastikan setiap format yang punya Kind juga punya MIME,
// dan sebaliknya — tidak ada yang out-of-sync.
func TestKindAndMIMEConsistency(t *testing.T) {
	for ext, info := range formats {
		if info.Kind == KindUnsupported {
			t.Errorf("formats[%q].Kind tidak boleh KindUnsupported — hapus entry ini", ext)
		}
		if info.MIME == "" {
			t.Errorf("formats[%q].MIME kosong — setiap format harus punya MIME type", ext)
		}
	}
}
