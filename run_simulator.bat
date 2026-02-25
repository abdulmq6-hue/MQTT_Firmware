@echo off
echo ==========================================
echo Starting ATG Simulator (Python)
echo Broker: localhost:1883
echo Web UI: http://localhost:8000/atg_simulator.html
echo ==========================================
python atg_simulator_server.py

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:3000/ 
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:8000/atg_simulator.html

exit /b