package netinfo

import (
	"fmt"
	"net"
)

// GetLANIP mengembalikan IP IPv4 non-loopback pertama yang ditemukan.
func GetLANIP() (string, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "", fmt.Errorf("gagal membaca interface: %w", err)
	}
	for _, addr := range addrs {
		var ip net.IP
		switch v := addr.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip == nil || ip.IsLoopback() {
			continue
		}
		ip = ip.To4()
		if ip == nil {
			continue // skip IPv6
		}
		return ip.String(), nil
	}
	return "127.0.0.1", nil
}
