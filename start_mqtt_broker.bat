@echo off
REM ATG Monitoring System - Quick Start Script
REM This script starts the EMQX MQTT broker and TimescaleDB

echo ============================================
echo  ATG Monitoring System - Quick Start
echo  Stingray Technologies
echo ============================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running!
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)

echo [1/4] Starting EMQX MQTT Broker and TimescaleDB...
docker-compose up -d emqx timescaledb

echo.
echo [2/4] Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo.
echo [3/4] Checking service status...
docker-compose ps

echo.
echo [4/4] Service URLs:
echo.
echo   MQTT Broker:     mqtt://localhost:1883
echo   MQTT WebSocket:  ws://localhost:8083/mqtt
echo   EMQX Dashboard:  http://localhost:18083
echo                    Username: admin
echo                    Password: public
echo.
echo   TimescaleDB:     localhost:5432
echo                    Database: atg_db
echo                    Username: postgres
echo                    Password: password
echo.
echo ============================================
echo  Services are running!
echo.
echo  To stop services:  docker-compose down
echo  To view logs:      docker-compose logs -f
echo ============================================
echo.

REM Start the Node.js server
echo Starting ATG Web Server...
echo.
start "ATG Server" cmd /k "node server.js"

echo.
echo [5/5] Starting ATG Device Poller (run.exe)...
timeout /t 2 /nobreak >nul

REM Check if run.exe exists in current directory
if exist "run.exe" (
    start "ATG Device Poller" cmd /k "run.exe"
    echo ATG Device Poller started!
) else (
    echo WARNING: run.exe not found in current directory
    echo Please start run.exe manually from its location
)

echo.
echo Opening dashboard in browser...
timeout /t 3 /nobreak >nul
start http://localhost:3000

echo.
echo ============================================
echo  All services started!
echo.
echo  Running processes:
echo    - EMQX MQTT Broker (Docker)
echo    - TimescaleDB (Docker)
echo    - ATG Web Server (Node.js)
echo    - ATG Device Poller (run.exe)
echo.
echo  Dashboard: http://localhost:3000
echo ============================================

pause
