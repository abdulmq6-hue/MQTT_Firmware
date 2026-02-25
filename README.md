# ATG Simulator - Stingray Technologies

A web-based ATG (Automatic Tank Gauge) simulator with MQTT publishing capabilities.

## Features

- **Web-Based UI**: Modern, responsive dashboard with real-time gauges
- **Configuration Panel**: Configure MQTT broker, topics, credentials, and publishing settings
- **Simulation Controls**: Start/stop simulation, adjust sensor values with sliders
- **Auto Variation**: Simulate realistic sensor fluctuations
- **Consumption Trends**: Simulate product consumption over time
- **History Tracking**: View and export message history as CSV
- **System Logs**: Real-time logging of all operations

## Quick Start

### Option 1: Web UI Simulator (Recommended)

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Start the simulator server:**
   - Double-click `start_simulator.bat`
   - Or run: `python atg_simulator_server.py`

3. **Open in browser:**
   - Navigate to http://localhost:8000

### Option 2: Command Line Publisher

Run the simple MQTT publisher:
```bash
python mqtt_publisher.py
```

## Web UI Tabs

### Dashboard
- Real-time gauges for Temperature, Product Level, Water Level
- Probe status indicator
- Statistics (messages sent, uptime, publish rate, errors)
- Current data payload display

### Simulation
- Start/Stop/Reset controls
- Manual sensor value adjustment with sliders
- Auto-variation settings for realistic fluctuations
- Product consumption trend simulation
- Probe configuration (address, request type, status code)

### Configuration
- **MQTT Settings:**
  - Broker IP Address
  - Broker Port
  - Topic name
  - Client ID
  - Username/Password
  - QoS Level
- **Publishing Settings:**
  - Publish interval
  - Connection timeout
  - Max retries
  - Keep alive
  - Clean session toggle
  - Auto reconnect toggle
- **Actions:**
  - Save/Load configuration
  - Export as JSON
  - Test connection

### History
- Table view of all published messages
- Export to CSV
- Clear history

### Logs
- Real-time system logs
- Export logs to file
- Clear logs

## API Endpoints

When running the server, the following REST API endpoints are available:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Get simulation status |
| GET | `/api/config` | Get current configuration |
| GET | `/api/data` | Get current sensor data |
| GET | `/api/history` | Get message history |
| GET | `/api/test-connection` | Test MQTT broker connection |
| POST | `/api/start` | Start simulation |
| POST | `/api/stop` | Stop simulation |
| POST | `/api/config` | Update configuration |
| POST | `/api/data` | Update sensor data |
| POST | `/api/reset` | Reset to defaults |

## Data Format

The published MQTT data follows this structure:
```json
{
    "Address": "83729",
    "req_type": 0,
    "Status": "0",
    "Temp": 25.13,
    "Product": 1234.12,
    "Water": 12.98
}
```

## Files

| File | Description |
|------|-------------|
| `atg_simulator.html` | Web-based UI (standalone, can be opened directly) |
| `atg_simulator_server.py` | Python server with MQTT integration |
| `mqtt_publisher.py` | Simple command-line MQTT publisher |
| `start_simulator.bat` | Windows batch file to start the server |
| `SRT_Logo.png` | Stingray Technologies logo |
| `requirements.txt` | Python dependencies |

## Configuration Defaults

- **Broker IP:** 192.168.137.158
- **Broker Port:** 1883
- **Topic:** ATG83729
- **Client ID:** ATG_Publisher
- **Username:** duc
- **Password:** SRT123
- **Publish Interval:** 2 seconds
- **QoS:** 1 (At least once)

## Requirements

- Python 3.7+
- paho-mqtt >= 2.0.0
- Modern web browser (Chrome, Firefox, Edge)

## Troubleshooting

1. **MQTT connection failed:**
   - Verify broker IP and port are correct
   - Check that the MQTT broker is running
   - Verify credentials are correct
   - Test network connectivity to the broker

2. **Web UI not loading:**
   - Ensure the server is running on port 8000
   - Check that no firewall is blocking the port
   - Try accessing http://localhost:8000/atg_simulator.html directly

3. **paho-mqtt import error:**
   - Run: `pip install paho-mqtt`

---
*Stingray Technologies - ATG Simulator v1.0*
