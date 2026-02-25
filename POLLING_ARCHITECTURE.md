# Polling-Only UI Display Architecture

## Overview
The system now uses **polling as the exclusive source** for UI data display. MQTT is optional and only used for publishing data, never for UI consumption.

---

## Data Flow

### Both MQTT ON and OFF - UI Always Shows Polling Data
```
ATG Device (Serial)
    ↓
atg_poller.js (reads serial)
    ├─→ ALWAYS send polling data → server.js (Socket.io)
    │
    └─→ IF ENABLE_MQTT=true: ALSO publish → MQTT Broker
                              (stored for external systems, NOT UI)
    
server.js
    ├─→ Receives polling data from Socket.io
    ├─→ Processes (calibration, volume, DB storage)
    └─→ Broadcasts to UI as `polling-data` event

Web UI
    └─→ Listens ONLY to `polling-data` event
        (Never listens to MQTT messages)
```

---

## Configuration

### atg_poller.js - Line 21
```javascript
const ENABLE_MQTT = true;  // true = publish to MQTT, false = polling only
```

### Behavior

| ENABLE_MQTT | Action | Result |
|---|---|---|
| `true` | Send polling data to server + publish to MQTT | UI shows polling data, MQTT broker receives data |
| `false` | Send polling data to server only | UI shows polling data, no MQTT publication |

---

## Files Modified

1. **atg_poller.js**
   - Socket.io client **always initialized** (regardless of ENABLE_MQTT)
   - Polling data **always sent** to server via Socket.io
   - MQTT publish is **optional** (only if ENABLE_MQTT=true)

2. **server.js**
   - Listen to `polling-data` events from poller
   - Process and store data in database
   - Broadcast as `polling-data` event to UI (not `mqtt_message`)
   - MQTT messages are ignored for UI display

3. **public/app.js**
   - Changed event listener from `mqtt_message` to `polling-data`
   - Renamed handler from `handleMqttMessage()` to `handlePollingData()`
   - UI only displays polling data

---

## Startup Instructions

```bash
# 1. Install dependencies
npm install

# 2. Start main server (Terminal 1)
npm start

# 3. Configure atg_poller.js line 21
const ENABLE_MQTT = true;   # or false

# 4. Start poller (Terminal 2)
node atg_poller.js COM7 9600
```

---

## Expected Console Output

### server.js
```
Web UI running at http://localhost:3000
Web Client connected
Received polling data: ATG83731
Broadcasted polling data to UI: ATG83731
```

### atg_poller.js (with ENABLE_MQTT=true)
```
Port opened COM7 baud 9600
Connected to main server for polling data at http://localhost:3000
Connected to MQTT broker at mqtt://127.0.0.1:1883
Sent polling data to UI: ATG83731
Published to MQTT broker: ATG83731
```

### atg_poller.js (with ENABLE_MQTT=false)
```
Port opened COM7 baud 9600
Connected to main server for polling data at http://localhost:3000
Sent polling data to UI: ATG83731
```

---

## Summary

✅ **Polling is the single source of truth for UI data**  
✅ **MQTT is optional publication channel only**  
✅ **UI never displays MQTT messages**  
✅ **Works seamlessly whether MQTT is enabled or disabled**  
✅ **Same database storage and functionality in both modes**
