package server

import "testing"

// TestIsSafariOrIOS memverifikasi deteksi Safari/iOS dari User-Agent string.
// Penting karena keputusan direct-serve MKV bergantung pada fungsi ini.
func TestIsSafariOrIOS(t *testing.T) {
	cases := []struct {
		ua   string
		want bool
		desc string
	}{
		// iOS devices — semua browser di iOS pakai WebKit, tidak support MKV
		{
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			true, "iPhone Safari",
		},
		{
			"Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
			true, "iPad Safari",
		},
		{
			"Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15",
			true, "iPod touch",
		},
		{
			// Chrome iOS — masih pakai WebKit, tidak support MKV
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
			true, "Chrome iOS (CriOS)",
		},
		// Safari desktop — tidak support MKV
		{
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			true, "Safari macOS",
		},
		// Chrome/Firefox/Edge Android — support MKV native
		{
			"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
			false, "Chrome Android",
		},
		{
			"Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
			false, "Firefox Android",
		},
		{
			"Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36 EdgA/120.0.2210.126",
			false, "Edge Android",
		},
		// Chrome/Edge desktop — support MKV
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			false, "Chrome Windows",
		},
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			false, "Edge Windows",
		},
		// Firefox desktop
		{
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/121.0 Firefox/121.0",
			false, "Firefox Windows",
		},
		// Empty UA — default ke non-Safari (tidak block)
		{
			"",
			false, "empty UA",
		},
	}

	for _, tc := range cases {
		t.Run(tc.desc, func(t *testing.T) {
			got := isSafariOrIOS(tc.ua)
			if got != tc.want {
				t.Errorf("isSafariOrIOS(%q) = %v, want %v", tc.ua, got, tc.want)
			}
		})
	}
}
