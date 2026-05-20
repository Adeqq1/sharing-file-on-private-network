# Setup Firewall untuk LAN Hub
# Jalankan sekali sebagai Administrator: klik kanan -> "Run with PowerShell"

#Requires -RunAsAdministrator

$port = 8080
$ruleName = "LAN Hub - Port $port"

# Cek apakah rule sudah ada
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existing) {
    Write-Host "Rule '$ruleName' sudah ada. Menghapus rule lama..." -ForegroundColor Yellow
    Remove-NetFirewallRule -DisplayName $ruleName
}

Write-Host "Membuat firewall rule untuk port $port..." -ForegroundColor Cyan

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description "Mengizinkan akses LAN Hub dari device lain di jaringan yang sama" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $port `
    -Action Allow `
    -Profile Private,Domain `
    -Enabled True | Out-Null

Write-Host ""
Write-Host "✅ Firewall rule berhasil dibuat!" -ForegroundColor Green
Write-Host "   Nama  : $ruleName"
Write-Host "   Port  : $port (TCP)"
Write-Host "   Profil: Private, Domain"
Write-Host ""
Write-Host "Sekarang HP/tablet di WiFi yang sama bisa akses LAN Hub." -ForegroundColor Cyan
Write-Host ""
Write-Host "Untuk hapus rule ini nanti, jalankan:"
Write-Host "  Remove-NetFirewallRule -DisplayName '$ruleName'" -ForegroundColor Gray
Write-Host ""
Read-Host "Tekan Enter untuk keluar"
