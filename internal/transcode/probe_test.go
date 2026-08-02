package transcode

import "testing"

// TestCanDirectServe memverifikasi logika codec-compatibility check.
func TestCanDirectServe(t *testing.T) {
	cases := []struct {
		name  string
		probe *ProbeResult
		want  bool
	}{
		{
			"nil probe → false",
			nil,
			false,
		},
		{
			"H.264 + AAC MKV → false",
			&ProbeResult{
				FormatName: "matroska,webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "h264"},
					{Type: "audio", Codec: "aac"},
				},
			},
			false,
		},
		{
			"H.264 + MP3 MKV → false",
			&ProbeResult{
				FormatName: "matroska,webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "h264"},
					{Type: "audio", Codec: "mp3"},
				},
			},
			false,
		},
		{
			"VP9 + Opus (WebM) → true",
			&ProbeResult{
				FormatName: "webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "vp9"},
					{Type: "audio", Codec: "opus"},
				},
			},
			true,
		},
		{
			"HEVC + AAC → false (video tidak kompatibel)",
			&ProbeResult{
				FormatName: "matroska,webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "hevc"},
					{Type: "audio", Codec: "aac"},
				},
			},
			false,
		},
		{
			"H.264 + AC3 → false (audio tidak kompatibel)",
			&ProbeResult{
				FormatName: "matroska,webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "h264"},
					{Type: "audio", Codec: "ac3"},
				},
			},
			false,
		},
		{
			"AV1 + no audio MKV → false",
			&ProbeResult{
				FormatName: "matroska,webm",
				Streams: []StreamInfo{
					{Type: "video", Codec: "av1"},
				},
			},
			false,
		},
		{
			"no video + AAC (audio-only) → true",
			&ProbeResult{
				FormatName: "mov,mp4,m4a",
				Streams: []StreamInfo{
					{Type: "audio", Codec: "aac"},
				},
			},
			true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CanDirectServe(tc.probe)
			if got != tc.want {
				t.Errorf("CanDirectServe() = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestIsMKVContainer memverifikasi deteksi container matroska.
func TestIsMKVContainer(t *testing.T) {
	cases := []struct {
		name  string
		probe *ProbeResult
		want  bool
	}{
		{"nil → false", nil, false},
		{"matroska,webm → true", &ProbeResult{FormatName: "matroska,webm"}, true},
		{"matroska → true", &ProbeResult{FormatName: "matroska"}, true},
		{"mov,mp4,m4a → false", &ProbeResult{FormatName: "mov,mp4,m4a"}, false},
		{"webm (non-matroska) → false", &ProbeResult{FormatName: "webm"}, false},
		{"avi → false", &ProbeResult{FormatName: "avi"}, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := IsMKVContainer(tc.probe)
			if got != tc.want {
				t.Errorf("IsMKVContainer(%q) = %v, want %v", tc.probe.FormatName, got, tc.want)
			}
		})
	}
}
