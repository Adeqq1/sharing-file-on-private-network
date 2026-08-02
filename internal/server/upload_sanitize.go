package server

import (
	"path/filepath"
	"regexp"
	"strings"
)

// reservedWindowsNames adalah nama yang tidak boleh dipakai sebagai filename di Windows.
var reservedWindowsNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true,
	"COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true,
	"LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// illegalCharsRe cocok dengan karakter yang tidak boleh dipakai di NTFS.
var illegalCharsRe = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

// SanitizeFilename mengubah filename mentah dari client menjadi nama yang aman
// disimpan di Windows. Mengembalikan string kosong kalau tidak bisa diselamatkan.
func SanitizeFilename(raw string) string {
	// Buang path component, sisakan basename
	name := filepath.Base(strings.ToValidUTF8(raw, "_"))
	if name == "." || name == ".." || name == "" || name == "/" || name == "\\" {
		return ""
	}
	// Ganti karakter ilegal dengan _
	name = illegalCharsRe.ReplaceAllString(name, "_")
	// Trim trailing dot/space (Windows tidak menerimanya)
	name = strings.TrimRight(name, ". ")
	if name == "" {
		return ""
	}
	// Cek reserved name (cek base tanpa ekstensi, case-insensitive)
	base := strings.ToUpper(strings.TrimSuffix(name, filepath.Ext(name)))
	if reservedWindowsNames[base] {
		name = "_" + name
	}
	// Limit panjang nama (NTFS max 255 char, sisakan buffer)
	if len([]rune(name)) > 200 {
		ext := filepath.Ext(name)
		if len([]rune(ext)) >= 200 {
			return string([]rune(name)[:200])
		}
		name = string([]rune(strings.TrimSuffix(name, ext))[:200-len([]rune(ext))]) + ext
	}
	return name
}
