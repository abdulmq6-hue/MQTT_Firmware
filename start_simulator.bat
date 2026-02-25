@echo off
title ATG Simulator - Stingray Technologies
echo ============================================================
echo   ATG Simulator Web Server
echo   Stingray Technologies
echo ============================================================
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    pause
    exit /b 1
)

REM Check if paho-mqtt is installed
python -c "import paho.mqtt.client" >nul 2>&1
if errorlevel 1 (
    echo WARNING: paho-mqtt is not installed
    echo Installing paho-mqtt...
    pip install paho-mqtt
    echo.
)

echo Starting ATG Simulator Server...
echo.
echo Open http://localhost:8000 in your browser
echo.
echo Press Ctrl+C to stop the server
echo ============================================================

cd /d "%~dp0"
python atg_simulator_server.py

pause
