# LAN Hub Diagnostic Tool
# Cek semua kemungkinan penyebab "HP tidak bisa konek"

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  LAN Hub Diagnostic" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

# 1. Cek IP laptop
Write-Host "[1] IP laptop di WiFi:" -ForegroundColor Yellow
$wifiAdapter = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" -and $_.IPAddress -notlike "169.254*" } |
    Select-Object -First 1
if ($wifiAdapter) {
    Write-Host "    $($wifiAdapter.IPAddress) (subnet /$($wifiAdapter.PrefixLength))" -ForegroundColor Green
    $myIP = $wifiAdapter.IPAddress
} else {
    Write-Host "    TIDAK TERDETEKSI - laptop tidak terhubung WiFi atau dapat IP APIPA" -ForegroundColor Red
    exit 1
}

# 2. Cek network category
Write-Host ""
Write-Host "[2] Network profile:" -ForegroundColor Yellow
$profile = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne "NoTraffic" } | Select-Object -First 1
if ($profile.NetworkCategory -eq "Private") {
    Write-Host "    Private (OK)" -ForegroundColor Green
} else {
    Write-Host "    $($profile.NetworkCategory) - SEBAIKNYA Private" -ForegroundColor Red
    Write-Host "    Fix: Settings -> Network -> WiFi -> klik nama WiFi -> set 'Private'" -ForegroundColor Gray
}

# 3. Cek server listen
Write-Host ""
Write-Host "[3] Server listen di port 8080:" -ForegroundColor Yellow
$listen = netstat -an | Select-String "0.0.0.0:8080.*LISTENING"
if ($listen) {
    Write-Host "    Server jalan dan listen di semua interface" -ForegroundColor Green
} else {
    Write-Host "    Server BELUM jalan. Run: go run main.go" -ForegroundColor Red
    exit 1
}

# 4. Cek firewall rule
Write-Host ""
Write-Host "[4] Firewall rule untuk port 8080:" -ForegroundColor Yellow
$fwRules = netsh advfirewall firewall show rule name=all dir=in 2>$null | Select-String "LocalPort:.*8080"
if ($fwRules) {
    Write-Host "    Ada $($fwRules.Count) rule mengizinkan port 8080" -ForegroundColor Green
} else {
    Write-Host "    TIDAK ADA rule firewall - jalankan setup-firewall.ps1" -ForegroundColor Red
}

# 5. Test akses ke IP LAN sendiri
Write-Host ""
Write-Host "[5] Test akses ke http://${myIP}:8080 dari laptop:" -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "http://${myIP}:8080/" -UseBasicParsing -TimeoutSec 3
    Write-Host "    OK ($($r.StatusCode)) - laptop bisa akses dirinya via IP LAN" -ForegroundColor Green
} catch {
    Write-Host "    GAGAL: $($_.Exception.Message)" -ForegroundColor Red
}

# 6. Tampilkan gateway untuk dicek dari HP
Write-Host ""
Write-Host "[6] Gateway (IP router):" -ForegroundColor Yellow
$gateway = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
Write-Host "    $gateway" -ForegroundColor Green

# 7. Cek apakah ada antivirus pihak ketiga
Write-Host ""
Write-Host "[7] Antivirus terdeteksi:" -ForegroundColor Yellow
try {
    $av = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
    if ($av) {
        $av | ForEach-Object {
            $name = $_.displayName
            if ($name -like "*Windows Defender*" -or $name -like "*Microsoft*") {
                Write-Host "    $name (built-in, OK)" -ForegroundColor Green
            } else {
                Write-Host "    $name - mungkin punya firewall sendiri!" -ForegroundColor Red
                Write-Host "    Tambah pengecualian untuk port 8080 di antivirus ini" -ForegroundColor Gray
            }
        }
    }
} catch {
    Write-Host "    Tidak bisa cek antivirus" -ForegroundColor Gray
}

# Kesimpulan & instruksi
Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "  Sekarang test dari HP" -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Lakukan urutan test ini di HP (browser):" -ForegroundColor Yellow
Write-Host ""
Write-Host "  TEST 1: Buka http://$gateway" -ForegroundColor White
Write-Host "          (halaman router)" -ForegroundColor Gray
Write-Host "          - Muncul     -> HP ada di subnet yg sama, lanjut Test 2" -ForegroundColor Gray
Write-Host "          - Tidak muncul -> HP pakai data seluler / WiFi beda" -ForegroundColor Gray
Write-Host ""
Write-Host "  TEST 2: Buka http://${myIP}:8080" -ForegroundColor White
Write-Host "          - Muncul     -> berhasil!" -ForegroundColor Gray
Write-Host "          - Tidak muncul tapi Test 1 OK -> AP Isolation di router" -ForegroundColor Gray
Write-Host ""
Write-Host "Jika Test 1 berhasil tapi Test 2 gagal:" -ForegroundColor Yellow
Write-Host "  - Ini AP Isolation. Buka panel router (http://$gateway)" -ForegroundColor Gray
Write-Host "  - Cari menu: Security -> WLAN Isolation / Client Isolation" -ForegroundColor Gray
Write-Host "  - Atau: WLAN -> WLAN Advanced -> AP Isolation: OFF" -ForegroundColor Gray
Write-Host "  - Atau: Application -> WLAN Isolation: Disable" -ForegroundColor Gray
Write-Host ""
if ($env:LANHUB_NO_WAIT -ne "1") {
    Read-Host "Tekan Enter untuk keluar"
}
