# UI Polling Integration Guide

## Fixed: Direct Polling Mode

The issue has been resolved! Now when `ENABLE_MQTT = false` in `atg_poller.js`, the polling data flows directly to the UI without needing MQTT.

---

## Architecture

### MQTT Mode (`ENABLE_MQTT = true`)
```
ATG Device → Serial Port → atg_poller.js → MQTT Broker → server.js → Web UI
```

### Polling Mode (`ENABLE_MQTT = false`)
```
ATG Device → Serial Port → atg_poller.js → server.js (Socket.io) → Web UI
```

---

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

This installs `socket.io-client` which is required for polling mode.

### 2. Configure atg_poller.js

**Line 21** - Toggle the flag:
```javascript
const ENABLE_MQTT = false;  // false = direct polling, true = MQTT
```

### 3. Start the Services

**Terminal 1 - Start main server:**
```bash
npm start
# Or: node server.js
# Server runs on http://localhost:3000
```

**Terminal 2 - Start polling:**
```bash
node atg_poller.js COM7 9600
# Replace COM7 with your actual COM port
```

---

## How It Works (Polling Mode)

1. **atg_poller.js** reads data from the ATG device via serial port
2. **Polling data** is emitted to `server.js` via Socket.io client connection
3. **server.js** receives the data on the `polling-data` event
4. **Data processing** (same as MQTT):
   - Applies calibration offsets
   - Calculates volume using DIP chart
   - Stores in database
   - Sends calibrated data to UI via `mqtt_message` event
5. **Web UI** receives the data and updates the dashboard

---

## Expected Console Output

### server.js
```
Web UI running at http://localhost:3000
Connected to EMQX Broker
...
Web Client connected
Connected to main server for data relay at http://localhost:3000
Received polling data: ATG83731
```

### atg_poller.js
```
Port opened COM7 baud 9600
Connected to main server for data relay at http://localhost:3000
Sent polling data to main server: ATG83731
Sent polling data to main server: ATG83731
...
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Cannot find module 'socket.io-client'" | Run `npm install socket.io-client` |
| "ECONNREFUSED 127.0.0.1:3000" | Make sure `server.js` is running first |
| UI still shows no data | Check browser console for errors, verify poller is connected |
| MQTT messages appearing | Verify `ENABLE_MQTT = false` in atg_poller.js |
| "Socket.io not connected" | Wait 2-3 seconds for poller to connect to server |

---

## Switching Between Modes

### To Use MQTT:
```javascript
// atg_poller.js line 21
const ENABLE_MQTT = true;
```
- Start: MQTT Broker → `npm start` → `node atg_poller.js`

### To Use Direct Polling:
```javascript
// atg_poller.js line 21
const ENABLE_MQTT = false;
```
- Start: `npm start` → `node atg_poller.js`

---

## Files Modified

- **atg_poller.js**: Added polling mode with Socket.io client
- **server.js**: Added polling data listener and processor
- **package.json**: Added socket.io-client dependency

Both modes use the same database storage and UI interface - seamless switching!
