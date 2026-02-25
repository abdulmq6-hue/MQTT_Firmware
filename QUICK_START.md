# Quick Start Guide - Polling-Only UI

## TL;DR

**UI displays polling data ONLY** - regardless of MQTT setting.

---

## One Minute Setup

### 1. Set the flag (atg_poller.js line 21)
```javascript
const ENABLE_MQTT = true;  // or false
```

### 2. Install & Start
```bash
npm install
npm start                    # Terminal 1 - starts server
node atg_poller.js COM7 9600 # Terminal 2 - starts polling
```

### 3. Open Browser
```
http://localhost:3000
```

✅ **Done!** UI displays real-time polling data.

---

## What Changed

| Component | Change | Purpose |
|-----------|--------|---------|
| atg_poller.js | Socket.io always on + optional MQTT | Polling → UI + (optional) MQTT publish |
| server.js | Broadcasts `polling-data` (not `mqtt_message`) | UI receives polling data only |
| public/app.js | Listens to `polling-data` event | UI never gets MQTT messages |

---

## ENABLE_MQTT Behavior

### `ENABLE_MQTT = true`
- Polling data → UI ✅
- Polling data → MQTT Broker ✅
- MQTT data → UI ❌ (ignored)

### `ENABLE_MQTT = false`
- Polling data → UI ✅
- Polling data → MQTT Broker ❌
- MQTT data → UI ❌

---

## Verify It Works

**server.js console:**
```
Received polling data: ATG83731
Broadcasted polling data to UI: ATG83731
```

**UI browser console:**
```
Connected to main server for polling data
```

**Web dashboard:**
- Real-time tank data updates
- No MQTT connection required (optional)

---

## Key Files

- **atg_poller.js** - Serial reader + polling sender
- **server.js** - Socket.io handler + data processor
- **public/app.js** - UI listener (polling-data event)
