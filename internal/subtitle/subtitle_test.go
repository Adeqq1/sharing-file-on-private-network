package subtitle

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// ===== Test SRTToVTT (existing, updated untuk signature []byte) =====

func TestSRTToVTT_Header(t *testing.T) {
	result := SRTToVTT([]byte("1\n00:00:01,000 --> 00:00:02,000\nHello\n"))
	if !strings.HasPrefix(result, "WEBVTT\n\n") {
		t.Errorf("hasil harus diawali 'WEBVTT\\n\\n', got: %q", result[:min(20, len(result))])
	}
}

func TestSRTToVTT_TimestampConversion(t *testing.T) {
	input := []byte("1\n00:00:01,500 --> 00:00:04,000\nHello World\n")
	result := SRTToVTT(input)
	if strings.Contains(result, "00:00:01,500") {
		t.Error("koma di timestamp harus sudah diganti jadi titik")
	}
	if !strings.Contains(result, "00:00:01.500") {
		t.Error("timestamp harus mengandung '00:00:01.500'")
	}
	if !strings.Contains(result, "00:00:04.000") {
		t.Error("timestamp harus mengandung '00:00:04.000'")
	}
}

func TestSRTToVTT_CRLFNormalization(t *testing.T) {
	input := []byte("1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n")
	result := SRTToVTT(input)
	if strings.Contains(result, "\r\n") {
		t.Error("CRLF harus sudah dinormalisasi ke LF")
	}
}

func TestSRTToVTT_MultipleEntries(t *testing.T) {
	input := []byte("1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,500 --> 00:00:05,000\nWorld\n")
	result := SRTToVTT(input)
	if !strings.Contains(result, "Hello") || !strings.Contains(result, "World") {
		t.Error("teks subtitle harus tetap ada setelah konversi")
	}
	if commaTimestamp.MatchString(result) {
		t.Error("tidak boleh ada timestamp dengan koma setelah konversi")
	}
}

func TestSRTToVTT_EmptyInput(t *testing.T) {
	result := SRTToVTT([]byte(""))
	if result != "WEBVTT\n\n" {
		t.Errorf("input kosong harus menghasilkan 'WEBVTT\\n\\n', got: %q", result)
	}
}

// ===== Task B: Test BOM =====

func TestSRTToVTT_StripsBOM(t *testing.T) {
	// BOM = EF BB BF diikuti konten SRT normal
	bom := "\uFEFF"
	input := []byte(bom + "1\n00:00:01,000 --> 00:00:02,000\nHello\n")
	result := SRTToVTT(input)
	if !strings.HasPrefix(result, "WEBVTT\n\n") {
		t.Errorf("BOM harus di-strip, hasil harus diawali 'WEBVTT\\n\\n', got: %q", result[:min(20, len(result))])
	}
	if strings.Contains(result, bom) {
		t.Error("BOM tidak boleh ada di output")
	}
}

func TestStripBOM_WithBOM(t *testing.T) {
	input := "\uFEFFhello"
	got := StripBOM(input)
	if got != "hello" {
		t.Errorf("StripBOM harus hapus BOM, got: %q", got)
	}
}

func TestStripBOM_WithoutBOM(t *testing.T) {
	input := "hello"
	got := StripBOM(input)
	if got != "hello" {
		t.Errorf("StripBOM tidak boleh ubah string tanpa BOM, got: %q", got)
	}
}

func TestStripBOM_Empty(t *testing.T) {
	got := StripBOM("")
	if got != "" {
		t.Errorf("StripBOM string kosong harus return kosong, got: %q", got)
	}
}

// ===== Task C: Test Encoding =====

func TestToUTF8_AlreadyUTF8(t *testing.T) {
	input := []byte("Hello, 世界!")
	got := ToUTF8(input)
	if got != "Hello, 世界!" {
		t.Errorf("string UTF-8 valid tidak boleh berubah, got: %q", got)
	}
	if !utf8.ValidString(got) {
		t.Error("output harus valid UTF-8")
	}
}

func TestToUTF8_FromWin1252(t *testing.T) {
	// Windows-1252: 0xE9 = é, 0xF1 = ñ, 0xFC = ü
	input := []byte{0xE9, 0x6C, 0x65, 0x76, 0x65, 0x73} // "éleves" dalam Win-1252
	got := ToUTF8(input)
	if !utf8.ValidString(got) {
		t.Error("output dari Win-1252 harus valid UTF-8")
	}
	// Karakter é dalam UTF-8 adalah 0xC3 0xA9
	if !strings.Contains(got, "é") {
		t.Errorf("karakter é harus ada di output, got: %q", got)
	}
}

func TestToUTF8_Empty(t *testing.T) {
	got := ToUTF8([]byte{})
	if got != "" {
		t.Errorf("input kosong harus return kosong, got: %q", got)
	}
}

// ===== Task D: Test CleanCueTags =====

func TestCleanCueTags_FontColor(t *testing.T) {
	input := `<font color="yellow">Teks subtitle</font>`
	got := CleanCueTags(input)
	if strings.Contains(got, "<font") || strings.Contains(got, "</font>") {
		t.Errorf("tag <font> harus dihapus, got: %q", got)
	}
	if !strings.Contains(got, "Teks subtitle") {
		t.Error("teks di dalam tag harus tetap ada")
	}
}

func TestCleanCueTags_FontFace(t *testing.T) {
	input := `<font face="Arial" size="14">Hello</font>`
	got := CleanCueTags(input)
	if strings.Contains(got, "<font") {
		t.Errorf("tag <font face=...> harus dihapus, got: %q", got)
	}
	if !strings.Contains(got, "Hello") {
		t.Error("teks harus tetap ada")
	}
}

func TestCleanCueTags_PreservesValidTags(t *testing.T) {
	// <b>, <i>, <u> harus tetap ada — WebVTT support
	input := "<b>Bold</b> <i>Italic</i> <u>Underline</u>"
	got := CleanCueTags(input)
	if got != input {
		t.Errorf("tag <b>, <i>, <u> tidak boleh dihapus, got: %q", got)
	}
}

func TestCleanCueTags_CaseInsensitive(t *testing.T) {
	input := `<FONT COLOR="red">Teks</FONT>`
	got := CleanCueTags(input)
	if strings.Contains(strings.ToLower(got), "<font") {
		t.Errorf("tag <FONT> (uppercase) harus dihapus, got: %q", got)
	}
}

func TestCleanCueTags_NoTags(t *testing.T) {
	input := "Teks biasa tanpa tag"
	got := CleanCueTags(input)
	if got != input {
		t.Errorf("teks tanpa tag tidak boleh berubah, got: %q", got)
	}
}

func TestSRTToVTT_FontTagStripped(t *testing.T) {
	input := []byte("1\n00:00:01,000 --> 00:00:02,000\n<font color=\"red\">Hello</font>\n")
	result := SRTToVTT(input)
	if strings.Contains(result, "<font") {
		t.Error("tag <font> harus dihapus dari output VTT")
	}
	if !strings.Contains(result, "Hello") {
		t.Error("teks di dalam tag harus tetap ada")
	}
}

// ===== Task A: Test LangAlias =====

func TestLangAlias_KnownCodes(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"id", "id"}, {"ind", "id"}, {"indonesian", "id"}, {"Indonesia", "id"},
		{"en", "en"}, {"eng", "en"}, {"english", "en"}, {"English", "en"},
		{"ja", "ja"}, {"jp", "ja"}, {"jpn", "ja"}, {"japanese", "ja"},
		{"ko", "ko"}, {"kor", "ko"}, {"korean", "ko"},
		{"zh", "zh"}, {"chi", "zh"}, {"chinese", "zh"},
		{"es", "es"}, {"spa", "es"}, {"spanish", "es"},
		{"fr", "fr"}, {"fra", "fr"}, {"french", "fr"},
		{"de", "de"}, {"ger", "de"}, {"german", "de"},
		{"pt", "pt"}, {"por", "pt"}, {"portuguese", "pt"},
		{"ar", "ar"}, {"ara", "ar"}, {"arabic", "ar"},
		{"th", "th"}, {"tha", "th"}, {"thai", "th"},
		{"vi", "vi"}, {"vie", "vi"}, {"vietnamese", "vi"},
		{"ms", "ms"}, {"msa", "ms"}, {"malay", "ms"},
	}
	for _, c := range cases {
		got := LangAlias(c.input)
		if got != c.want {
			t.Errorf("LangAlias(%q) = %q, want %q", c.input, got, c.want)
		}
	}
}

func TestLangAlias_Unknown(t *testing.T) {
	cases := []string{"xyz", "unknown", "123", ""}
	for _, c := range cases {
		got := LangAlias(c)
		if got != "" {
			t.Errorf("LangAlias(%q) harus return \"\", got %q", c, got)
		}
	}
}

// ===== Task A: Test MatchSubtitleFile =====

func TestMatchSubtitleFile(t *testing.T) {
	cases := []struct {
		videoBase string
		subFile   string
		wantLang  string
		wantMatch bool
	}{
		// Pola default (tanpa lang)
		{"video1", "video1.srt", "", true},
		{"video1", "video1.vtt", "", true},
		// Separator titik
		{"video2", "video2.id.srt", "id", true},
		{"video2", "video2.en.vtt", "en", true},
		// Separator underscore (BARU)
		{"video3", "video3_id.srt", "id", true},
		{"video3", "video3_en.vtt", "en", true},
		// Separator dash (BARU)
		{"video4", "video4-en.srt", "en", true},
		{"video4", "video4-id.vtt", "id", true},
		// Nama bahasa penuh (BARU)
		{"video5", "video5.Indonesian.srt", "id", true},
		{"video5", "video5.English.srt", "en", true},
		// Case mismatch pada basename (BARU)
		{"Video6", "video6.srt", "", true},
		{"video6", "Video6.srt", "", true},
		// Ekstensi kapital
		{"video7", "video7.SRT", "", true},
		{"video7", "video7.VTT", "", true},
		// Bukan file subtitle
		{"video8", "video8.mp4", "", false},
		{"video8", "video8.txt", "", false},
		{"video8", "video8.ass", "", false},
		// Lang tidak dikenal — tetap match, pakai lowercase aslinya
		{"video9", "video9.xyz.srt", "xyz", true},
		// Tidak cocok sama sekali
		{"video1", "video2.srt", "", false},
		{"video1", "other.id.srt", "", false},
	}
	for _, c := range cases {
		gotLang, gotMatch := MatchSubtitleFile(c.videoBase, c.subFile)
		if gotMatch != c.wantMatch {
			t.Errorf("MatchSubtitleFile(%q, %q): match=%v, want %v", c.videoBase, c.subFile, gotMatch, c.wantMatch)
			continue
		}
		if gotMatch && gotLang != c.wantLang {
			t.Errorf("MatchSubtitleFile(%q, %q): lang=%q, want %q", c.videoBase, c.subFile, gotLang, c.wantLang)
		}
	}
}

// min helper untuk Go < 1.21
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func TestShiftVTT_ZeroOffset(t *testing.T) {
	vtt := "WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nHello\n"
	result := ShiftVTT(vtt, 0)
	if result != vtt {
		t.Errorf("offset 0 harus return string yang sama, got: %q", result)
	}
}

func TestShiftVTT_ShiftsTimestamps(t *testing.T) {
	vtt := "WEBVTT\n\n00:02:30.000 --> 00:02:32.500\nHello\n"
	result := ShiftVTT(vtt, 150) // offset 150 detik = 2 menit 30 detik
	if !strings.Contains(result, "00:00:00.000 --> 00:00:02.500") {
		t.Errorf("timestamp tidak dishift dengan benar, got: %q", result)
	}
}

func TestShiftVTT_SkipsCueBeforeOffset(t *testing.T) {
	vtt := "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nTerlalu awal\n\n00:00:20.000 --> 00:00:22.000\nCukup\n"
	result := ShiftVTT(vtt, 15) // skip cue yang end <= 15
	if strings.Contains(result, "Terlalu awal") {
		t.Errorf("cue sebelum offset seharusnya di-skip")
	}
	if !strings.Contains(result, "Cukup") {
		t.Errorf("cue setelah offset seharusnya ada")
	}
}

func TestShiftVTT_PartialCueClampedToZero(t *testing.T) {
	vtt := "WEBVTT\n\n00:00:10.000 --> 00:00:20.000\nMelintasi offset\n"
	result := ShiftVTT(vtt, 15) // start = -5 → clamp ke 0, end = 5
	if !strings.Contains(result, "00:00:00.000 --> 00:00:05.000") {
		t.Errorf("cue yang melintasi offset seharusnya di-clamp, got: %q", result)
	}
}
