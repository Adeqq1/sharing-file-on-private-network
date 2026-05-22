@echo off
:: ============================================================
:: LAN Hub Firewall Rule Reset Script
:: Auto-elevates to Administrator privileges
:: ============================================================

:: Check for admin rights, if not elevate
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo  LAN Hub Firewall Rule Setup
echo ============================================================
echo.

echo [1/4] Removing old LAN Hub rules (duplicates)...
netsh advfirewall firewall delete rule name="LAN Hub"
echo.

echo [2/4] Enabling firewall on Private profile...
netsh advfirewall set privateprofile state on
echo.

echo [3/4] Adding new LAN Hub rule (TCP port 8080, all profiles)...
netsh advfirewall firewall add rule name="LAN Hub" dir=in action=allow protocol=TCP localport=8080 profile=any
echo.

echo [4/4] Verifying configuration...
echo.
echo --- Private Profile State ---
netsh advfirewall show privateprofile state
echo.
echo --- LAN Hub Rule ---
netsh advfirewall firewall show rule name="LAN Hub"
echo.

echo ============================================================
echo  Done!
echo ============================================================
pause
