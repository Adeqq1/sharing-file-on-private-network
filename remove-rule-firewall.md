# Hapus semua rule LAN Hub yang lama (banyak duplikat)
netsh advfirewall firewall delete rule name="LAN Hub"

# Pastikan firewall ON di profile Private
netsh advfirewall set privateprofile state on

# Buat rule baru yang spesifik untuk semua profile
netsh advfirewall firewall add rule name="LAN Hub" dir=in action=allow protocol=TCP localport=8080 profile=any

# Verifikasi
netsh advfirewall show privateprofile state
netsh advfirewall firewall show rule name="LAN Hub"