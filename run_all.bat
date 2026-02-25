@echo off
echo ==========================================
echo   ATG MQTT System Launcher
echo ==========================================

echo 1. Starting MQTT Broker and Web UI (Node.js)...
start "MQTT Broker & Web UI" cmd /k "node server.js"

echo Waiting for Broker to initialize...
timeout /t 3 /nobreak >nul

echo ==========================================
echo   System Started!
echo   Web UI: http://localhost:3000
echo ==========================================

exit /b