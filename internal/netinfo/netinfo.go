package netinfo

import (
	"fmt"
	"net"
	"strings"
)

// GetLANIP mengembalikan IP IPv4 LAN yang paling masuk akal untuk diakses dari device lain.
//
// Strategi pemilihan (urut prioritas):
//  1. Hanya pertimbangkan adapter yang UP dan bukan loopback.
//  2. Skip IP APIPA (169.254.0.0/16) — itu fallback ketika DHCP gagal.
//  3. Prioritaskan IP di range LAN umum: 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12.
//  4. Skip adapter virtual yang biasanya tidak terhubung ke router fisik
//     (VirtualBox, VMware, Hyper-V, Docker, WSL, dll).
//  5. Jika tidak ada kandidat, kembalikan IP private apapun yang ditemukan.
func GetLANIP() (string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "", fmt.Errorf("gagal membaca interface: %w", err)
	}

	var preferred, fallback string

	for _, iface := range ifaces {
		// Skip adapter yang down atau loopback
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}

		// Skip adapter virtual yang tidak terhubung ke router fisik
		if isVirtualAdapter(iface.Name) {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil {
				continue
			}
			ip = ip.To4()
			if ip == nil || ip.IsLoopback() {
				continue
			}
			// Skip APIPA (link-local 169.254.x.x)
			if ip.IsLinkLocalUnicast() || (ip[0] == 169 && ip[1] == 254) {
				continue
			}

			ipStr := ip.String()
			if isPreferredLAN(ip) {
				// IP LAN umum: langsung pakai
				preferred = ipStr
				break
			}
			// Simpan sebagai fallback kalau belum ada preferred
			if fallback == "" {
				fallback = ipStr
			}
		}

		if preferred != "" {
			break
		}
	}

	if preferred != "" {
		return preferred, nil
	}
	if fallback != "" {
		return fallback, nil
	}
	return "127.0.0.1", fmt.Errorf("tidak menemukan IP LAN aktif (cek koneksi WiFi/Ethernet)")
}

// isPreferredLAN mengembalikan true jika IP berada di range LAN privat standar.
func isPreferredLAN(ip net.IP) bool {
	// 192.168.0.0/16
	if ip[0] == 192 && ip[1] == 168 {
		return true
	}
	// 10.0.0.0/8
	if ip[0] == 10 {
		return true
	}
	// 172.16.0.0/12
	if ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31 {
		return true
	}
	return false
}

// isVirtualAdapter mendeteksi nama adapter yang biasanya virtual.
// Adapter virtual sering punya IP private tapi tidak bisa diakses dari device lain.
func isVirtualAdapter(name string) bool {
	lower := strings.ToLower(name)
	virtualKeywords := []string{
		"virtualbox", "vmware", "hyper-v", "vethernet",
		"docker", "wsl", "loopback", "tap-",
		"tun", "vmnet", "vbox",
	}
	for _, kw := range virtualKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}
