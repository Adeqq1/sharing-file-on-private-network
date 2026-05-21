package subtitle

import (
	"strings"
	"testing"
)

func TestSRTToVTT_Header(t *testing.T) {
	result := SRTToVTT("1\n00:00:01,000 --> 00:00:02,000\nHello\n")
	if !strings.HasPrefix(result, "WEBVTT\n\n") {
		t.Errorf("hasil harus diawali 'WEBVTT\\n\\n', got: %q", result[:20])
	}
}

func TestSRTToVTT_TimestampConversion(t *testing.T) {
	input := "1\n00:00:01,500 --> 00:00:04,000\nHello World\n"
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
	input := "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n"
	result := SRTToVTT(input)
	if strings.Contains(result, "\r\n") {
		t.Error("CRLF harus sudah dinormalisasi ke LF")
	}
}

func TestSRTToVTT_MultipleEntries(t *testing.T) {
	input := "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,500 --> 00:00:05,000\nWorld\n"
	result := SRTToVTT(input)
	if !strings.Contains(result, "Hello") || !strings.Contains(result, "World") {
		t.Error("teks subtitle harus tetap ada setelah konversi")
	}
	if strings.Count(result, ",") > 0 {
		// Koma di teks biasa boleh, tapi koma di timestamp tidak boleh
		// Cek lebih spesifik: tidak ada pola timestamp dengan koma
		if commaTimestamp.MatchString(result) {
			t.Error("tidak boleh ada timestamp dengan koma setelah konversi")
		}
	}
}

func TestSRTToVTT_EmptyInput(t *testing.T) {
	result := SRTToVTT("")
	if result != "WEBVTT\n\n" {
		t.Errorf("input kosong harus menghasilkan 'WEBVTT\\n\\n', got: %q", result)
	}
}
