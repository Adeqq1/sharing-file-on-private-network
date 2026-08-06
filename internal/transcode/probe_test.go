package transcode

import (
	"strings"
	"testing"
)

func TestParseDuration(t *testing.T) {
	if got := parseDuration("N/A"); got != 0 {
		t.Fatalf("parseDuration(N/A) = %v, want 0", got)
	}
	if got := parseDuration("123.5"); got != 123.5 {
		t.Fatalf("parseDuration(123.5) = %v, want 123.5", got)
	}
}

func TestBuildFFmpegArgsUsesAccurateSeekWindow(t *testing.T) {
	args := buildFFmpegArgs("video.mkv", nil, 10, -1)

	input := -1
	var seeks []int
	for i, arg := range args {
		switch arg {
		case "-i":
			input = i
		case "-ss":
			seeks = append(seeks, i)
		}
	}
	if input < 0 || len(seeks) != 2 {
		t.Fatalf("expected input and seek arguments, got %v", args)
	}
	if seeks[0] >= input || seeks[1] <= input {
		t.Fatalf("expected input seek before and output seek after input, got %v", args)
	}
	if args[seeks[0]+1] != "6.0" || args[seeks[1]+1] != "4.0" {
		t.Fatalf("seek offsets = %q and %q, want 6.0 and 4.0", args[seeks[0]+1], args[seeks[1]+1])
	}
}

func TestBuildFFmpegArgsSeekUsesRequestedOffset(t *testing.T) {
	args := buildFFmpegArgs("video.mkv", nil, 2941, -1)

	for i, arg := range args {
		if arg == "-ss" {
			if i+1 >= len(args) || args[i+1] != "2937.0" {
				t.Fatalf("input seek offset = %q, want 2937.0; args=%v", args[i+1], args)
			}
			for j := i + 2; j < len(args); j++ {
				if args[j] == "-ss" {
					if j+1 >= len(args) || args[j+1] != "4.0" {
						t.Fatalf("output seek offset = %q, want 4.0; args=%v", args[j+1], args)
					}
					return
				}
			}
		}
	}
	t.Fatalf("expected seek argument, got %v", args)
}

func TestBuildFFmpegArgsDisablesVideoBFrames(t *testing.T) {
	args := buildFFmpegArgs("video.mkv", nil, 0, -1)

	for i, arg := range args {
		if arg == "-bf" {
			if i+1 >= len(args) || args[i+1] != "0" {
				t.Fatalf("B-frame setting = %q, want 0; args=%v", args[i+1], args)
			}
			return
		}
	}
	t.Fatalf("expected -bf 0 in full-transcode arguments, got %v", args)
}

func TestBuildFFmpegArgsNormalizesTranscodedTimestamps(t *testing.T) {
	args := buildFFmpegArgs("video.mkv", &ProbeResult{Streams: []StreamInfo{
		{Type: "video", Codec: "hevc"},
		{Type: "audio", Codec: "aac"},
	}}, 0, -1)

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-vf setpts=PTS-STARTPTS") {
		t.Fatalf("missing video timestamp normalization: %v", args)
	}
	if !strings.Contains(joined, "-af aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS") {
		t.Fatalf("full transcode must normalize audio timestamps: %v", args)
	}
	if !strings.Contains(joined, "-c:a aac") {
		t.Fatalf("full transcode must encode audio for accurate seeking: %v", args)
	}
	if !strings.Contains(joined, "-movflags frag_every_frame+empty_moov+default_base_moof") {
		t.Fatalf("transcode output must fragment each frame for prompt A/V startup: %v", args)
	}
	if !strings.Contains(joined, "-max_interleave_delta 0") || !strings.Contains(joined, "-flush_packets 1") {
		t.Fatalf("transcode output must flush and interleave audio/video tightly: %v", args)
	}
}

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
			"VP9 + Opus real ffprobe WebM → true",
			&ProbeResult{
				FormatName: "matroska,webm",
				SourceExt:  ".webm",
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
