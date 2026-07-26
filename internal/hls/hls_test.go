package hls

import (
	"strconv"
	"strings"
	"testing"
)

func TestNumSegments(t *testing.T) {
	cases := []struct {
		dur  float64
		want int
	}{
		{0, 0},
		{1, 1},
		{4, 1},
		{4.1, 2},
		{8, 2},
		{100, 25},
	}
	for _, c := range cases {
		if got := NumSegments(c.dur); got != c.want {
			t.Errorf("NumSegments(%v)=%d want %d", c.dur, got, c.want)
		}
	}
}

func TestSegmentDuration(t *testing.T) {
	if d := SegmentDuration(10, 0); d != 4 {
		t.Errorf("seg0=%v want 4", d)
	}
	if d := SegmentDuration(10, 2); d != 2 {
		t.Errorf("seg2=%v want 2", d)
	}
}

func TestBuildMediaPlaylist(t *testing.T) {
	pl := BuildMediaPlaylist(10, func(i int) string {
		return "seg?i=" + strconv.Itoa(i)
	})
	if !strings.Contains(pl, "#EXT-X-ENDLIST") {
		t.Fatal("missing ENDLIST")
	}
	if !strings.Contains(pl, "seg?i=0") || !strings.Contains(pl, "seg?i=2") {
		t.Fatal("missing segment urls")
	}
	if !strings.Contains(pl, "#EXTINF:4.000,") {
		t.Fatal("missing EXTINF")
	}
}
