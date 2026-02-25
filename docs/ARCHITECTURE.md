# ATG Monitoring System - Complete Architecture Design

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Component Descriptions](#3-component-descriptions)
4. [MQTT Topic Hierarchy](#4-mqtt-topic-hierarchy)
5. [Message Formats](#5-message-formats)
6. [TimescaleDB Schema](#6-timescaledb-schema)
7. [Backend Architecture](#7-backend-architecture)
8. [Frontend UI Design](#8-frontend-ui-design)
9. [Alert Logic](#9-alert-logic)
10. [Deployment Model](#10-deployment-model)
11. [Security Considerations](#11-security-considerations)

---

## 1. System Overview

The ATG (Automatic Tank Gauge) Monitoring System is an end-to-end IoT telemetry solution designed to:
- Collect real-time tank measurements from multiple ATG devices
- Store time-series data efficiently in TimescaleDB
- Provide real-time dashboards and historical analytics
- Generate alerts for abnormal conditions
- Support multi-station, multi-tank deployments

### Key Features
- Real-time MQTT-based telemetry collection
- Time-series optimized storage with automatic data compression
- WebSocket-powered live dashboard updates
- Role-based access control (Admin/Operator)
- Configurable alerting thresholds
- Historical reporting with CSV/PDF export
- DIP chart integration for volume calculations

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              ATG MONITORING SYSTEM ARCHITECTURE                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   ATG Unit   │  │   ATG Unit   │  │   ATG Unit   │  │   ATG Unit   │
│   Station A  │  │   Station A  │  │   Station B  │  │   Station B  │
│   Tank 1     │  │   Tank 2     │  │   Tank 1     │  │   Tank 2     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                 │
       │    MQTT (QoS 1) │                 │    MQTT (QoS 1) │
       │    TLS/SSL      │                 │    TLS/SSL      │
       └────────┬────────┘                 └────────┬────────┘
                │                                   │
                ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        EMQX MQTT BROKER                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │   Auth Plugin   │  │   Rule Engine   │  │   Data Bridge       │  │
│  │   (ACL/JWT)     │  │   (Filtering)   │  │   (TimescaleDB)     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
│  Port 1883 (MQTT) | Port 8883 (MQTTS) | Port 18083 (Dashboard)      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐
│  BACKEND SERVICE  │  │   TIMESCALEDB     │  │   REDIS CACHE         │
│  (Node.js/Python) │  │   (Time-Series)   │  │   (Optional)          │
│                   │  │                   │  │                       │
│  ┌─────────────┐  │  │  ┌─────────────┐  │  │  - Session store      │
│  │ MQTT Client │  │  │  │ Hypertables │  │  │  - Real-time cache    │
│  │ Subscriber  │  │  │  │             │  │  │  - Alarm state        │
│  └─────────────┘  │  │  │ telemetry   │  │  │                       │
│  ┌─────────────┐  │  │  │ alarms      │  │  └───────────────────────┘
│  │ REST API    │  │  │  │ events      │  │
│  │ /api/*      │  │  │  │             │  │
│  └─────────────┘  │  │  └─────────────┘  │
│  ┌─────────────┐  │  │  ┌─────────────┐  │
│  │ WebSocket   │  │  │  │ Continuous  │  │
│  │ Server      │  │  │  │ Aggregates  │  │
│  └─────────────┘  │  │  └─────────────┘  │
│  ┌─────────────┐  │  │  ┌─────────────┐  │
│  │ Alert       │  │  │  │ Compression │  │
│  │ Engine      │◄─┼──┤  │ Policies    │  │
│  └─────────────┘  │  │  └─────────────┘  │
└─────────┬─────────┘  └───────────────────┘
          │
          │  HTTP/WebSocket
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         WEB APPLICATION                              │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    React/Vue Frontend                        │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│    │
│  │  │  Login   │ │ Station  │ │  Tank    │ │   Historical     ││    │
│  │  │  Page    │ │ Overview │ │ Details  │ │   Reports        ││    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│    │
│  │  │  Alarms  │ │  Events  │ │ Settings │ │   Map View       ││    │
│  │  │  Panel   │ │  Log     │ │  Panel   │ │   (Optional)     ││    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
          │
          │  HTTPS / Browser
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                            END USERS                                 │
│     ┌───────────┐         ┌───────────┐         ┌───────────┐       │
│     │   Admin   │         │ Operator  │         │  Viewer   │       │
│     │  (Full)   │         │ (Monitor) │         │ (ReadOnly)│       │
│     └───────────┘         └───────────┘         └───────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

1. TELEMETRY INGESTION FLOW:
   ATG Device → MQTT Publish → EMQX Broker → Backend Subscriber → TimescaleDB
                                    │
                                    ├──→ Rule Engine (Optional)
                                    │         │
                                    │         └──→ Direct DB Write (High Performance)
                                    │
                                    └──→ Alert Evaluation → Notification Service

2. REAL-TIME DISPLAY FLOW:
   TimescaleDB → Backend API → WebSocket → Browser → UI Update
        │
        └──→ Cache (Redis) → WebSocket → Browser

3. HISTORICAL QUERY FLOW:
   Browser → REST API → Backend → TimescaleDB (Continuous Aggregate) → Response
                                        │
                                        └──→ Raw Data (< 24h)
                                        └──→ Hourly Aggregate (24h - 30d)
                                        └──→ Daily Aggregate (> 30d)
```

---

## 3. Component Descriptions

### 3.1 ATG Device Layer
| Component | Description |
|-----------|-------------|
| ATG Unit | Physical tank gauge measuring product level, water level, temperature |
| Protocol | Serial (RS-485/RS-232) to MQTT Gateway or Native MQTT |
| Data Format | JSON payload with sensor readings |
| Frequency | Configurable (default: 2-30 seconds) |

### 3.2 MQTT Broker (EMQX)
| Feature | Configuration |
|---------|---------------|
| Ports | 1883 (TCP), 8883 (TLS), 8083 (WebSocket), 18083 (Dashboard) |
| Authentication | Username/Password, JWT, X.509 Certificates |
| ACL | Topic-based access control per device/user |
| Persistence | Message queue for offline devices |
| Rule Engine | Data transformation and routing |
| Clustering | Horizontal scaling support |

### 3.3 Backend Service
| Component | Technology | Purpose |
|-----------|------------|---------|
| MQTT Subscriber | mqtt.js / paho-mqtt | Subscribe to telemetry topics |
| REST API | Express.js / FastAPI | HTTP endpoints for UI |
| WebSocket Server | Socket.io / FastAPI WebSockets | Real-time updates |
| Alert Engine | Custom Logic | Threshold monitoring and notifications |
| Auth Service | JWT + bcrypt | User authentication |

### 3.4 TimescaleDB
| Feature | Usage |
|---------|-------|
| Hypertables | Automatic partitioning by time |
| Compression | 90%+ storage reduction for old data |
| Continuous Aggregates | Pre-computed hourly/daily stats |
| Retention Policies | Automatic data lifecycle management |

### 3.5 Web Frontend
| Feature | Technology |
|---------|------------|
| Framework | React 18 / Vue 3 |
| UI Library | Tailwind CSS / Ant Design |
| Charts | Apache ECharts / Chart.js |
| State | Redux Toolkit / Pinia |
| Real-time | Socket.io-client |

---

## 4. MQTT Topic Hierarchy

### Topic Structure
```
atg/
├── {station_id}/
│   ├── {tank_id}/
│   │   ├── telemetry          # Real-time sensor data
│   │   ├── status             # Device health status
│   │   └── config             # Remote configuration
│   ├── alarms                 # Station-level alarms
│   └── status                 # Station connectivity
├── sys/
│   ├── devices/online         # Device presence
│   └── devices/offline        # Device disconnection
└── cmd/
    └── {station_id}/
        └── {tank_id}/
            ├── read           # Command to poll device
            └── calibrate      # Calibration command
```

### Example Topics
```
atg/STATION001/TANK001/telemetry     # Tank telemetry data
atg/STATION001/TANK001/status        # Tank device status
atg/STATION001/alarms                # Station alarms
atg/sys/devices/online               # Device online events
cmd/STATION001/TANK001/read          # Poll command
```

### Topic Naming Conventions
- Station ID: `STATION` + 3-digit code (e.g., `STATION001`)
- Tank ID: `TANK` + 3-digit code (e.g., `TANK001`)
- Legacy support: Flat topics like `ATG83729` (your current format)

---

## 5. Message Formats

### 5.1 Telemetry Message (Device → Broker)

```json
{
  "device_id": "ATG83731",
  "station_id": "STATION001",
  "tank_id": "TANK001",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "data": {
    "product_level_mm": 3619.9,
    "water_level_mm": 3510.0,
    "temperature_c": 23.8,
    "volume_liters": 45230.5,
    "ullage_liters": 4769.5,
    "product_type": "Diesel",
    "density_kg_m3": 835.0
  },
  "status": {
    "code": 0,
    "message": "OK",
    "sensor_health": "GOOD",
    "battery_level": 95,
    "signal_strength": -45
  },
  "metadata": {
    "firmware_version": "2.1.0",
    "last_calibration": "2024-12-01T00:00:00.000Z"
  }
}
```

### 5.2 Simplified Telemetry (Backward Compatible)

```json
{
  "Address": "83731",
  "req_type": 0,
  "Status": "0",
  "Temp": 23.8,
  "Product": 3619.9,
  "Water": 3510.0,
  "ProductType": "Diesel",
  "Timestamp": "2025-01-15T10:30:00.000Z"
}
```

### 5.3 Alarm Event Message

```json
{
  "alarm_id": "ALM-2025-001234",
  "type": "HIGH_LEVEL",
  "severity": "WARNING",
  "station_id": "STATION001",
  "tank_id": "TANK001",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "details": {
    "current_value": 4850.0,
    "threshold": 4500.0,
    "unit": "mm",
    "message": "Product level exceeded high threshold"
  },
  "acknowledged": false
}
```

### 5.4 Device Status Message

```json
{
  "device_id": "ATG83731",
  "online": true,
  "last_seen": "2025-01-15T10:30:00.000Z",
  "uptime_seconds": 86400,
  "connection_quality": "EXCELLENT",
  "errors": []
}
```

---

## 6. TimescaleDB Schema

### 6.1 Core Tables

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =====================================================
-- STATIONS TABLE (Static Configuration)
-- =====================================================
CREATE TABLE stations (
    id              SERIAL PRIMARY KEY,
    station_id      VARCHAR(50) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    location        VARCHAR(255),
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    address         TEXT,
    contact_name    VARCHAR(255),
    contact_phone   VARCHAR(50),
    contact_email   VARCHAR(255),
    timezone        VARCHAR(50) DEFAULT 'UTC',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TANKS TABLE (Static Configuration)
-- =====================================================
CREATE TABLE tanks (
    id              SERIAL PRIMARY KEY,
    tank_id         VARCHAR(50) UNIQUE NOT NULL,
    station_id      VARCHAR(50) REFERENCES stations(station_id),
    name            VARCHAR(255) NOT NULL,
    product_type    VARCHAR(50) NOT NULL,        -- Diesel, Petrol, Oil, etc.
    capacity_liters DECIMAL(12, 2) NOT NULL,
    diameter_mm     DECIMAL(10, 2),
    height_mm       DECIMAL(10, 2),
    low_level_mm    DECIMAL(10, 2) DEFAULT 500,   -- Low level alarm threshold
    high_level_mm   DECIMAL(10, 2),               -- High level alarm threshold
    water_max_mm    DECIMAL(10, 2) DEFAULT 50,    -- Max water threshold
    device_serial   VARCHAR(100),
    device_address  VARCHAR(50),                  -- e.g., "83731"
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TELEMETRY DATA TABLE (Hypertable - Time-Series)
-- =====================================================
CREATE TABLE telemetry_data (
    time            TIMESTAMPTZ NOT NULL,
    tank_id         VARCHAR(50) NOT NULL,
    station_id      VARCHAR(50),
    product_mm      DOUBLE PRECISION,
    water_mm        DOUBLE PRECISION,
    temp_c          DOUBLE PRECISION,
    volume_liters   DOUBLE PRECISION,
    ullage_liters   DOUBLE PRECISION,
    density         DOUBLE PRECISION,
    status_code     INTEGER DEFAULT 0,
    status_message  VARCHAR(50),
    product_type    VARCHAR(50)
);

-- Convert to hypertable (partitioned by time)
SELECT create_hypertable('telemetry_data', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create indexes for common queries
CREATE INDEX idx_telemetry_tank_time ON telemetry_data (tank_id, time DESC);
CREATE INDEX idx_telemetry_station_time ON telemetry_data (station_id, time DESC);

-- =====================================================
-- ALARMS HISTORY TABLE (Hypertable)
-- =====================================================
CREATE TABLE alarms_history (
    time            TIMESTAMPTZ NOT NULL,
    alarm_id        VARCHAR(50) NOT NULL,
    tank_id         VARCHAR(50) NOT NULL,
    station_id      VARCHAR(50),
    alarm_type      VARCHAR(50) NOT NULL,         -- HIGH_LEVEL, LOW_LEVEL, HIGH_WATER, etc.
    severity        VARCHAR(20) NOT NULL,         -- CRITICAL, WARNING, INFO
    current_value   DOUBLE PRECISION,
    threshold_value DOUBLE PRECISION,
    message         TEXT,
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMPTZ,
    resolved        BOOLEAN DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ
);

SELECT create_hypertable('alarms_history', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX idx_alarms_tank ON alarms_history (tank_id, time DESC);
CREATE INDEX idx_alarms_active ON alarms_history (acknowledged, resolved, time DESC);

-- =====================================================
-- EVENTS TABLE (System Events & Audit Log)
-- =====================================================
CREATE TABLE events (
    time            TIMESTAMPTZ NOT NULL,
    event_id        VARCHAR(50) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,         -- DEVICE_ONLINE, DELIVERY, CALIBRATION, etc.
    entity_type     VARCHAR(50),                  -- tank, station, device
    entity_id       VARCHAR(50),
    user_id         VARCHAR(100),
    description     TEXT,
    metadata        JSONB
);

SELECT create_hypertable('events', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- =====================================================
-- USERS TABLE (Authentication)
-- =====================================================
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255),
    role            VARCHAR(50) DEFAULT 'operator',  -- admin, operator, viewer
    station_access  VARCHAR(50)[],                   -- Array of station_ids (null = all)
    is_active       BOOLEAN DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- DIP CHARTS TABLE (Volume Calibration)
-- =====================================================
CREATE TABLE dip_charts (
    id              SERIAL PRIMARY KEY,
    tank_id         VARCHAR(50) REFERENCES tanks(tank_id),
    depth_mm        INTEGER NOT NULL,
    volume_liters   DOUBLE PRECISION NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tank_id, depth_mm)
);

CREATE INDEX idx_dip_chart_tank ON dip_charts (tank_id, depth_mm);
```

### 6.2 Continuous Aggregates (Pre-computed Rollups)

```sql
-- =====================================================
-- HOURLY STATISTICS (For 24h - 30d queries)
-- =====================================================
CREATE MATERIALIZED VIEW hourly_tank_stats
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    tank_id,
    station_id,
    AVG(product_mm) as avg_product_mm,
    MIN(product_mm) as min_product_mm,
    MAX(product_mm) as max_product_mm,
    AVG(water_mm) as avg_water_mm,
    MAX(water_mm) as max_water_mm,
    AVG(temp_c) as avg_temp_c,
    AVG(volume_liters) as avg_volume,
    MIN(volume_liters) as min_volume,
    MAX(volume_liters) as max_volume,
    COUNT(*) as reading_count
FROM telemetry_data
GROUP BY bucket, tank_id, station_id
WITH NO DATA;

-- Refresh policy (every hour, refresh last 3 hours)
SELECT add_continuous_aggregate_policy('hourly_tank_stats',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- =====================================================
-- DAILY STATISTICS (For 30d+ queries)
-- =====================================================
CREATE MATERIALIZED VIEW daily_tank_stats
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    tank_id,
    station_id,
    AVG(product_mm) as avg_product_mm,
    MIN(product_mm) as min_product_mm,
    MAX(product_mm) as max_product_mm,
    AVG(volume_liters) as avg_volume,
    MIN(volume_liters) as min_volume,
    MAX(volume_liters) as max_volume,
    SUM(CASE WHEN status_code != 0 THEN 1 ELSE 0 END) as error_count,
    COUNT(*) as reading_count
FROM telemetry_data
GROUP BY bucket, tank_id, station_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_tank_stats',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);
```

### 6.3 Compression and Retention Policies

```sql
-- Enable compression on telemetry_data
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tank_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress data older than 7 days
SELECT add_compression_policy('telemetry_data', INTERVAL '7 days');

-- Retention: Keep raw data for 90 days
SELECT add_retention_policy('telemetry_data', INTERVAL '90 days');

-- Retention: Keep alarms for 1 year
SELECT add_retention_policy('alarms_history', INTERVAL '365 days');

-- Retention: Keep events for 6 months
SELECT add_retention_policy('events', INTERVAL '180 days');
```

---

## 7. Backend Architecture

### 7.1 Project Structure (Node.js)

```
backend/
├── src/
│   ├── config/
│   │   ├── database.js         # PostgreSQL/TimescaleDB connection
│   │   ├── mqtt.js             # MQTT client configuration
│   │   └── env.js              # Environment variables
│   │
│   ├── services/
│   │   ├── mqttService.js      # MQTT subscriber & message handler
│   │   ├── telemetryService.js # Telemetry processing & storage
│   │   ├── alertService.js     # Alarm detection & notifications
│   │   ├── dipChartService.js  # Volume calculation from DIP charts
│   │   └── authService.js      # JWT authentication
│   │
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── stationController.js
│   │   ├── tankController.js
│   │   ├── telemetryController.js
│   │   ├── alarmController.js
│   │   └── reportController.js
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── stations.routes.js
│   │   ├── tanks.routes.js
│   │   ├── telemetry.routes.js
│   │   ├── alarms.routes.js
│   │   └── reports.routes.js
│   │
│   ├── middleware/
│   │   ├── auth.js             # JWT verification
│   │   ├── rateLimiter.js      # API rate limiting
│   │   └── validator.js        # Request validation
│   │
│   ├── websocket/
│   │   └── socketHandler.js    # WebSocket event handlers
│   │
│   ├── utils/
│   │   ├── logger.js           # Winston logger
│   │   └── helpers.js          # Utility functions
│   │
│   └── app.js                  # Express app initialization
│
├── package.json
├── Dockerfile
└── .env.example
```

### 7.2 Core Backend Code Examples

#### MQTT Service (mqttService.js)
```javascript
const mqtt = require('mqtt');
const { Pool } = require('pg');
const alertService = require('./alertService');
const dipChartService = require('./dipChartService');

class MqttService {
    constructor() {
        this.client = null;
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL
        });
    }

    connect() {
        const options = {
            clientId: `atg-backend-${Date.now()}`,
            username: process.env.MQTT_USERNAME,
            password: process.env.MQTT_PASSWORD,
            clean: false,
            reconnectPeriod: 5000,
            keepalive: 60
        };

        this.client = mqtt.connect(process.env.MQTT_BROKER_URL, options);

        this.client.on('connect', () => {
            console.log('Connected to MQTT broker');

            // Subscribe to all ATG telemetry topics
            this.client.subscribe('atg/+/+/telemetry', { qos: 1 });
            this.client.subscribe('atg/+/+/status', { qos: 1 });

            // Legacy flat topic support
            this.client.subscribe('ATG+', { qos: 1 });
        });

        this.client.on('message', this.handleMessage.bind(this));
        this.client.on('error', (err) => console.error('MQTT Error:', err));
    }

    async handleMessage(topic, message) {
        try {
            const payload = JSON.parse(message.toString());
            const topicParts = topic.split('/');

            let tankId, stationId;

            if (topicParts[0] === 'atg' && topicParts.length >= 4) {
                // Structured topic: atg/STATION001/TANK001/telemetry
                stationId = topicParts[1];
                tankId = topicParts[2];
            } else {
                // Legacy flat topic: ATG83731
                tankId = topic;
                stationId = 'DEFAULT';
            }

            // Calculate volume from DIP chart
            const volume = await dipChartService.getVolume(tankId, payload.Product);

            // Prepare telemetry record
            const telemetry = {
                time: payload.Timestamp || new Date(),
                tank_id: tankId,
                station_id: stationId,
                product_mm: payload.Product || payload.data?.product_level_mm,
                water_mm: payload.Water || payload.data?.water_level_mm,
                temp_c: payload.Temp || payload.data?.temperature_c,
                volume_liters: volume,
                status_code: parseInt(payload.Status) || 0,
                product_type: payload.ProductType || 'Diesel'
            };

            // Store in database
            await this.storeTelemetry(telemetry);

            // Check for alarms
            await alertService.evaluateAlarms(telemetry);

            // Broadcast to WebSocket clients
            this.broadcastUpdate(telemetry);

        } catch (err) {
            console.error('Message processing error:', err);
        }
    }

    async storeTelemetry(data) {
        const query = `
            INSERT INTO telemetry_data
            (time, tank_id, station_id, product_mm, water_mm, temp_c,
             volume_liters, status_code, product_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        await this.pool.query(query, [
            data.time, data.tank_id, data.station_id,
            data.product_mm, data.water_mm, data.temp_c,
            data.volume_liters, data.status_code, data.product_type
        ]);
    }

    broadcastUpdate(data) {
        // Emit to Socket.io (handled in socketHandler.js)
        if (global.io) {
            global.io.to(`tank:${data.tank_id}`).emit('telemetry', data);
            global.io.to(`station:${data.station_id}`).emit('telemetry', data);
        }
    }
}

module.exports = new MqttService();
```

#### Alert Service (alertService.js)
```javascript
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

class AlertService {
    constructor() {
        this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
        this.tankThresholds = new Map(); // Cache thresholds
    }

    async loadThresholds() {
        const result = await this.pool.query(`
            SELECT tank_id, low_level_mm, high_level_mm, water_max_mm
            FROM tanks WHERE is_active = true
        `);

        result.rows.forEach(row => {
            this.tankThresholds.set(row.tank_id, {
                lowLevel: row.low_level_mm,
                highLevel: row.high_level_mm,
                waterMax: row.water_max_mm
            });
        });
    }

    async evaluateAlarms(telemetry) {
        const thresholds = this.tankThresholds.get(telemetry.tank_id);
        if (!thresholds) return;

        const alarms = [];

        // HIGH LEVEL ALARM
        if (thresholds.highLevel && telemetry.product_mm > thresholds.highLevel) {
            alarms.push({
                type: 'HIGH_LEVEL',
                severity: 'WARNING',
                current: telemetry.product_mm,
                threshold: thresholds.highLevel,
                message: `Product level (${telemetry.product_mm}mm) exceeded high threshold (${thresholds.highLevel}mm)`
            });
        }

        // LOW LEVEL ALARM
        if (thresholds.lowLevel && telemetry.product_mm < thresholds.lowLevel) {
            alarms.push({
                type: 'LOW_LEVEL',
                severity: telemetry.product_mm < thresholds.lowLevel * 0.5 ? 'CRITICAL' : 'WARNING',
                current: telemetry.product_mm,
                threshold: thresholds.lowLevel,
                message: `Product level (${telemetry.product_mm}mm) below low threshold (${thresholds.lowLevel}mm)`
            });
        }

        // HIGH WATER ALARM
        if (thresholds.waterMax && telemetry.water_mm > thresholds.waterMax) {
            alarms.push({
                type: 'HIGH_WATER',
                severity: 'CRITICAL',
                current: telemetry.water_mm,
                threshold: thresholds.waterMax,
                message: `Water level (${telemetry.water_mm}mm) exceeded maximum (${thresholds.waterMax}mm)`
            });
        }

        // SENSOR ERROR
        if (telemetry.status_code !== 0) {
            alarms.push({
                type: 'SENSOR_ERROR',
                severity: 'CRITICAL',
                current: telemetry.status_code,
                threshold: 0,
                message: `Sensor error detected (code: ${telemetry.status_code})`
            });
        }

        // Store and broadcast alarms
        for (const alarm of alarms) {
            await this.createAlarm(telemetry, alarm);
        }
    }

    async createAlarm(telemetry, alarmData) {
        const alarmId = `ALM-${Date.now()}-${uuidv4().slice(0, 8)}`;

        await this.pool.query(`
            INSERT INTO alarms_history
            (time, alarm_id, tank_id, station_id, alarm_type, severity,
             current_value, threshold_value, message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            new Date(), alarmId, telemetry.tank_id, telemetry.station_id,
            alarmData.type, alarmData.severity, alarmData.current,
            alarmData.threshold, alarmData.message
        ]);

        // Broadcast alarm to WebSocket
        if (global.io) {
            global.io.emit('alarm', {
                alarm_id: alarmId,
                tank_id: telemetry.tank_id,
                station_id: telemetry.station_id,
                ...alarmData,
                timestamp: new Date()
            });
        }
    }
}

module.exports = new AlertService();
```

### 7.3 REST API Endpoints

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           REST API ENDPOINTS                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Authentication                                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ POST   /api/auth/login           Login with username/password              │
│ POST   /api/auth/refresh         Refresh access token                      │
│ POST   /api/auth/logout          Logout and invalidate token               │
│ GET    /api/auth/me              Get current user profile                  │
├────────────────────────────────────────────────────────────────────────────┤
│ Stations                                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/stations             List all stations                         │
│ GET    /api/stations/:id         Get station details                       │
│ POST   /api/stations             Create new station (Admin)                │
│ PUT    /api/stations/:id         Update station (Admin)                    │
│ DELETE /api/stations/:id         Delete station (Admin)                    │
│ GET    /api/stations/:id/summary Station dashboard summary                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Tanks                                                                       │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/tanks                List all tanks                            │
│ GET    /api/tanks/:id            Get tank details                          │
│ POST   /api/tanks                Create new tank (Admin)                   │
│ PUT    /api/tanks/:id            Update tank (Admin)                       │
│ DELETE /api/tanks/:id            Delete tank and data (Admin)              │
│ GET    /api/tanks/:id/latest     Get latest telemetry for tank             │
├────────────────────────────────────────────────────────────────────────────┤
│ Telemetry                                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/telemetry/latest     Get latest data for all tanks             │
│ GET    /api/telemetry/:tankId    Get historical data for a tank            │
│        ?range=24h|7d|30d|custom                                            │
│        &start=ISO_DATE&end=ISO_DATE                                        │
│        &interval=raw|5m|1h|1d                                              │
│ GET    /api/telemetry/export     Export data as CSV                        │
├────────────────────────────────────────────────────────────────────────────┤
│ Alarms                                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/alarms               List alarms (with filters)                │
│        ?active=true|false                                                  │
│        &severity=CRITICAL|WARNING|INFO                                     │
│        &tank_id=...&station_id=...                                         │
│ GET    /api/alarms/active        Get active (unacknowledged) alarms        │
│ POST   /api/alarms/:id/ack       Acknowledge an alarm                      │
│ POST   /api/alarms/:id/resolve   Resolve an alarm                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Reports                                                                     │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/reports/daily        Daily summary report                      │
│ GET    /api/reports/consumption  Consumption analysis                      │
│ GET    /api/reports/alarms       Alarm statistics                          │
│ POST   /api/reports/generate     Generate PDF report                       │
├────────────────────────────────────────────────────────────────────────────┤
│ Configuration                                                               │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/config/thresholds    Get alarm thresholds                      │
│ PUT    /api/config/thresholds    Update alarm thresholds                   │
│ POST   /api/config/dip-chart     Upload DIP chart PDF                      │
│ GET    /api/config/dip-chart/:id Get DIP chart data                        │
├────────────────────────────────────────────────────────────────────────────┤
│ System                                                                      │
├────────────────────────────────────────────────────────────────────────────┤
│ GET    /api/system/health        Health check endpoint                     │
│ GET    /api/system/stats         System statistics                         │
│ GET    /api/system/devices       Connected device status                   │
└────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 WebSocket Events

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          WEBSOCKET EVENTS                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Client → Server                                                             │
├────────────────────────────────────────────────────────────────────────────┤
│ subscribe:tank      { tankId }         Subscribe to tank updates           │
│ subscribe:station   { stationId }      Subscribe to station updates        │
│ subscribe:alarms    { }                Subscribe to all alarms             │
│ unsubscribe:tank    { tankId }         Unsubscribe from tank               │
├────────────────────────────────────────────────────────────────────────────┤
│ Server → Client                                                             │
├────────────────────────────────────────────────────────────────────────────┤
│ telemetry           { tankId, data }   Real-time telemetry update          │
│ alarm               { alarmData }      New alarm notification              │
│ alarm:resolved      { alarmId }        Alarm resolved notification         │
│ device:online       { deviceId }       Device connected                    │
│ device:offline      { deviceId }       Device disconnected                 │
│ system:status       { stats }          System status update                │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Frontend UI Design

### 8.1 Application Structure

```
frontend/
├── src/
│   ├── assets/
│   │   ├── images/
│   │   └── styles/
│   │       └── globals.css
│   │
│   ├── components/
│   │   ├── common/
│   │   │   ├── Header.jsx
│   │   │   ├── Sidebar.jsx
│   │   │   ├── LoadingSpinner.jsx
│   │   │   └── Modal.jsx
│   │   │
│   │   ├── dashboard/
│   │   │   ├── StationCard.jsx
│   │   │   ├── TankCard.jsx
│   │   │   ├── AlarmBanner.jsx
│   │   │   └── SystemStats.jsx
│   │   │
│   │   ├── tanks/
│   │   │   ├── TankGauge.jsx
│   │   │   ├── TankChart.jsx
│   │   │   ├── TankDetails.jsx
│   │   │   └── TankSettings.jsx
│   │   │
│   │   ├── alarms/
│   │   │   ├── AlarmList.jsx
│   │   │   ├── AlarmItem.jsx
│   │   │   └── AlarmHistory.jsx
│   │   │
│   │   └── charts/
│   │       ├── LevelChart.jsx
│   │       ├── TemperatureChart.jsx
│   │       └── VolumeChart.jsx
│   │
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── StationView.jsx
│   │   ├── TankDetails.jsx
│   │   ├── Alarms.jsx
│   │   ├── Reports.jsx
│   │   ├── Settings.jsx
│   │   └── MapView.jsx
│   │
│   ├── hooks/
│   │   ├── useWebSocket.js
│   │   ├── useTelemetry.js
│   │   └── useAlarms.js
│   │
│   ├── services/
│   │   ├── api.js
│   │   ├── auth.js
│   │   └── socket.js
│   │
│   ├── store/
│   │   ├── index.js
│   │   ├── authSlice.js
│   │   ├── telemetrySlice.js
│   │   └── alarmSlice.js
│   │
│   ├── utils/
│   │   ├── formatters.js
│   │   └── constants.js
│   │
│   └── App.jsx
│
├── package.json
└── vite.config.js
```

### 8.2 UI Wireframes

#### Login Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         ┌─────────────────────────┐                         │
│                         │      [LOGO]             │                         │
│                         │   ATG MONITORING        │                         │
│                         │      SYSTEM             │                         │
│                         └─────────────────────────┘                         │
│                                                                             │
│                         ┌─────────────────────────┐                         │
│                         │                         │                         │
│                         │   Username              │                         │
│                         │   ┌───────────────────┐ │                         │
│                         │   │                   │ │                         │
│                         │   └───────────────────┘ │                         │
│                         │                         │                         │
│                         │   Password              │                         │
│                         │   ┌───────────────────┐ │                         │
│                         │   │ ●●●●●●●●          │ │                         │
│                         │   └───────────────────┘ │                         │
│                         │                         │                         │
│                         │   ☐ Remember me         │                         │
│                         │                         │                         │
│                         │   ┌───────────────────┐ │                         │
│                         │   │      LOGIN        │ │                         │
│                         │   └───────────────────┘ │                         │
│                         │                         │                         │
│                         └─────────────────────────┘                         │
│                                                                             │
│                         Stingray Technologies © 2025                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Main Dashboard
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ┌───────────────────────────────────────────────────────────────────────┐   │
│ │ [LOGO] ATG Monitoring    Dashboard  Stations  Reports  Alarms  Settings│  │
│ │                                                          🔔 3  👤 Admin │  │
│ └───────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   STATIONS   │ │    TANKS     │ │   ACTIVE     │ │   MESSAGES   │       │
│  │      5       │ │     23       │ │   ALARMS     │ │    /sec      │       │
│  │     ●●●●●    │ │   ●●●●●...   │ │      3       │ │    24.5      │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ⚠️ ACTIVE ALARMS                                        [View All]  │  │
│  │  ┌────────────────────────────────────────────────────────────────┐  │  │
│  │  │ 🔴 CRITICAL │ Station A - Tank 1 │ LOW LEVEL │ 450mm < 500mm   │  │  │
│  │  │ 🟡 WARNING  │ Station B - Tank 3 │ HIGH WATER │ 55mm > 50mm    │  │  │
│  │  │ 🟡 WARNING  │ Station A - Tank 2 │ HIGH LEVEL │ 4520mm > 4500mm│  │  │
│  │  └────────────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  STATIONS OVERVIEW                                                          │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐         │
│  │  STATION A        │ │  STATION B        │ │  STATION C        │         │
│  │  📍 Location 1    │ │  📍 Location 2    │ │  📍 Location 3    │         │
│  │  ───────────────  │ │  ───────────────  │ │  ───────────────  │         │
│  │  Tanks: 5         │ │  Tanks: 4         │ │  Tanks: 6         │         │
│  │  Online: 5 ● 🟢   │ │  Online: 4 ● 🟢   │ │  Online: 5 ● 🟢   │         │
│  │  Alarms: 2 ⚠️     │ │  Alarms: 1 ⚠️     │ │  Alarms: 0 ✓      │         │
│  │  ───────────────  │ │  ───────────────  │ │  ───────────────  │         │
│  │  [View Details]   │ │  [View Details]   │ │  [View Details]   │         │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Station Dashboard
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Dashboard          STATION A - Main Depot                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  STATION SUMMARY                                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   TOTAL      │ │   TOTAL      │ │   ACTIVE     │ │   SYSTEM     │       │
│  │   TANKS      │ │   VOLUME     │ │   ALARMS     │ │   STATUS     │       │
│  │      5       │ │  125,430 L   │ │      2       │ │     🟢       │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                             │
│  TANKS                                                      [+ Add Tank]    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │   │
│  │  │   TANK 1         │  │   TANK 2         │  │   TANK 3         │  │   │
│  │  │   Diesel         │  │   Petrol         │  │   Diesel         │  │   │
│  │  │  ┌────────────┐  │  │  ┌────────────┐  │  │  ┌────────────┐  │  │   │
│  │  │  │            │  │  │  │████████    │  │  │  │██████████  │  │  │   │
│  │  │  │████        │  │  │  │████████    │  │  │  │██████████  │  │  │   │
│  │  │  │████  45%   │  │  │  │████████73% │  │  │  │██████████91%│  │  │   │
│  │  │  │████████████│  │  │  │████████████│  │  │  │████████████│  │  │   │
│  │  │  │████████████│  │  │  │████████████│  │  │  │████████████│  │  │   │
│  │  │  └────────────┘  │  │  └────────────┘  │  │  └────────────┘  │  │   │
│  │  │                  │  │                  │  │   ⚠️ HIGH LEVEL  │  │   │
│  │  │  22,500 L        │  │  36,500 L        │  │  45,500 L        │  │   │
│  │  │  Temp: 23.5°C    │  │  Temp: 24.1°C    │  │  Temp: 22.8°C    │  │   │
│  │  │  Water: 12mm     │  │  Water: 8mm      │  │  Water: 15mm     │  │   │
│  │  │                  │  │                  │  │                  │  │   │
│  │  │  [View Details]  │  │  [View Details]  │  │  [View Details]  │  │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Tank Details Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Station A          TANK 1 - Diesel                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────┐  ┌────────────────────────────────────┐│
│  │   LIVE TELEMETRY              │  │   QUICK STATS                      ││
│  │   ─────────────────────────── │  │   ────────────────────────────     ││
│  │                               │  │                                    ││
│  │   ┌─────────────────────────┐ │  │   Capacity:     50,000 L           ││
│  │   │                         │ │  │   Current:      22,500 L (45%)     ││
│  │   │         ████            │ │  │   Ullage:       27,500 L           ││
│  │   │         ████            │ │  │   ────────────────────────────     ││
│  │   │         ████            │ │  │   Product:      3,245 mm           ││
│  │   │    45%  ████            │ │  │   Water:        12 mm              ││
│  │   │         ████            │ │  │   Temperature:  23.5 °C            ││
│  │   │         ████████████████│ │  │   ────────────────────────────     ││
│  │   │         ████████████████│ │  │   Status:       🟢 OK              ││
│  │   │         ████████████████│ │  │   Last Update:  10:45:32           ││
│  │   └─────────────────────────┘ │  │   Device:       ATG83731           ││
│  │                               │  │                                    ││
│  │   🔴 ALARM: LOW LEVEL         │  │   [⚙️ Configure] [📄 Export]       ││
│  │   Product level below 500mm   │  │                                    ││
│  └────────────────────────────────┘  └────────────────────────────────────┘│
│                                                                             │
│  HISTORICAL DATA           [24h] [7d] [30d] [Custom]                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  VOLUME TREND                                                        │  │
│  │  50k ┤                                                               │  │
│  │      │     ╭──╮                                                      │  │
│  │  40k ┤    ╱    ╲         ╭────╮                                      │  │
│  │      │   ╱      ╲       ╱      ╲                                     │  │
│  │  30k ┤  ╱        ╲     ╱        ╲      ╭──────────────────           │  │
│  │      │ ╱          ╲   ╱          ╲____╱                              │  │
│  │  20k ┤╱            ╲_╱                                               │  │
│  │      │                                                               │  │
│  │  10k ┤                                                               │  │
│  │      └───────────────────────────────────────────────────────────    │  │
│  │        00:00    04:00    08:00    12:00    16:00    20:00            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐│
│  │  TEMPERATURE CHART               │  │  WATER LEVEL CHART               ││
│  │  28°┤      ╭─╮    ╭──╮          │  │  60 ┤                            ││
│  │  26°┤  ╭──╯   ╲__╱    ╲         │  │  40 ┤    ╭╮    ╭─╮               ││
│  │  24°┤_╱                ╲___     │  │  20 ┤___╱  ╲__╱   ╲________      ││
│  │  22°┤                          │  │   0 ┤                            ││
│  │     └────────────────────────   │  │     └────────────────────────    ││
│  └──────────────────────────────────┘  └──────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Alarms Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ALARMS & EVENTS                                          [Active] [History] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FILTERS                                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Severity: [All ▼]  Station: [All ▼]  Type: [All ▼]  [🔍 Search]     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ACTIVE ALARMS (3)                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ┌─────┐                                                              │  │
│  │ │ 🔴  │  LOW LEVEL ALARM                                   [ACK]    │  │
│  │ │CRIT │  Station A > Tank 1 (Diesel)                                │  │
│  │ └─────┘  Product level (450mm) below threshold (500mm)              │  │
│  │          Triggered: 2025-01-15 10:32:15 (15 min ago)                │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ ┌─────┐                                                              │  │
│  │ │ 🟡  │  HIGH WATER ALARM                                  [ACK]    │  │
│  │ │WARN │  Station B > Tank 3 (Petrol)                                │  │
│  │ └─────┘  Water level (55mm) exceeded maximum (50mm)                 │  │
│  │          Triggered: 2025-01-15 10:28:42 (18 min ago)                │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ ┌─────┐                                                              │  │
│  │ │ 🟡  │  HIGH LEVEL WARNING                                [ACK]    │  │
│  │ │WARN │  Station A > Tank 2 (Diesel)                                │  │
│  │ └─────┘  Product level (4520mm) above threshold (4500mm)            │  │
│  │          Triggered: 2025-01-15 09:45:00 (1 hour ago)                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  RECENT HISTORY                                              [Export CSV]   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ TIME       │ STATION  │ TANK   │ TYPE      │ STATUS    │ ACK BY     │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ 10:15:00   │ Station C│ Tank 2 │ LOW LEVEL │ Resolved  │ Admin      │  │
│  │ 09:30:22   │ Station A│ Tank 1 │ HIGH WATER│ Resolved  │ Operator 1 │  │
│  │ 08:45:10   │ Station B│ Tank 4 │ SENSOR ERR│ Resolved  │ Admin      │  │
│  │ 07:20:55   │ Station A│ Tank 3 │ HIGH LEVEL│ Resolved  │ Auto       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Reports Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REPORTS & ANALYTICS                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GENERATE REPORT                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                                                                      │  │
│  │  Report Type: [Daily Summary ▼]                                      │  │
│  │                                                                      │  │
│  │  Date Range:  [2025-01-01] to [2025-01-15]                          │  │
│  │                                                                      │  │
│  │  Station:     [All Stations ▼]                                       │  │
│  │                                                                      │  │
│  │  Tank:        [All Tanks ▼]                                          │  │
│  │                                                                      │  │
│  │  Format:      ○ CSV    ○ PDF    ● Excel                              │  │
│  │                                                                      │  │
│  │  ┌────────────────┐  ┌────────────────┐                              │  │
│  │  │  📊 Preview    │  │  📥 Download   │                              │  │
│  │  └────────────────┘  └────────────────┘                              │  │
│  │                                                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  QUICK REPORTS                                                              │
│  ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐         │
│  │  📈 Daily Volume  │ │  ⚠️ Alarm Report  │ │  📉 Consumption   │         │
│  │     Summary       │ │     Summary       │ │     Analysis      │         │
│  │                   │ │                   │ │                   │         │
│  │  Last 24 hours    │ │  Last 7 days      │ │  Last 30 days     │         │
│  │  [Generate]       │ │  [Generate]       │ │  [Generate]       │         │
│  └───────────────────┘ └───────────────────┘ └───────────────────┘         │
│                                                                             │
│  RECENT REPORTS                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ DATE       │ TYPE             │ RANGE         │ FORMAT │ ACTION     │  │
│  ├──────────────────────────────────────────────────────────────────────┤  │
│  │ 2025-01-14 │ Daily Summary    │ Jan 1-14      │ PDF    │ [Download] │  │
│  │ 2025-01-10 │ Consumption      │ December      │ Excel  │ [Download] │  │
│  │ 2025-01-05 │ Alarm Report     │ Week 1        │ CSV    │ [Download] │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Settings Page
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SETTINGS                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐                                                    │
│  │ General Settings    │ ──────────────────────────────────────────────────│
│  │ Tank Configuration  │                                                   │
│  │ Alarm Thresholds    │  GENERAL SETTINGS                                 │
│  │ User Management     │  ─────────────────────────────────────────────    │
│  │ MQTT Configuration  │                                                   │
│  │ System Maintenance  │  System Name: [ATG Monitoring System      ]       │
│  └─────────────────────┘                                                   │
│                          Timezone:    [Asia/Karachi ▼]                     │
│                                                                             │
│                          Date Format: [YYYY-MM-DD ▼]                       │
│                                                                             │
│                          Auto Refresh: [5 seconds ▼]                       │
│                                                                             │
│                          ☑ Enable email notifications                      │
│                          ☑ Enable sound alerts                             │
│                          ☐ Dark mode                                       │
│                                                                             │
│                          ─────────────────────────────────────────────     │
│                                                                             │
│                          MQTT BROKER                                        │
│                          ─────────────────────────────────────────────     │
│                                                                             │
│                          Broker URL:  [mqtt://localhost:1883        ]      │
│                          Username:    [admin                        ]      │
│                          Password:    [●●●●●●●●                     ]      │
│                          QoS Level:   [1 - At least once ▼]                │
│                                                                             │
│                          [Test Connection]  [Save Changes]                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Color Scheme (Dark Industrial Theme)

```css
:root {
    /* Primary Colors */
    --bg-primary: #0a1628;
    --bg-secondary: #1a2d4a;
    --bg-card: rgba(26, 45, 74, 0.8);

    /* Accent Colors */
    --accent-cyan: #00d4ff;
    --accent-green: #00ff88;
    --accent-orange: #ff9500;
    --accent-red: #ff4757;
    --accent-yellow: #ffd93d;

    /* Text Colors */
    --text-primary: #ffffff;
    --text-secondary: #8892a0;
    --text-muted: #5a6a7a;

    /* Border Colors */
    --border-default: rgba(0, 212, 255, 0.3);
    --border-active: rgba(0, 212, 255, 0.6);

    /* Status Colors */
    --status-ok: #00ff88;
    --status-warning: #ff9500;
    --status-critical: #ff4757;
    --status-offline: #5a6a7a;

    /* Gauge Colors */
    --gauge-diesel: #ff9500;
    --gauge-petrol: #00d4ff;
    --gauge-water: #4a90d9;
    --gauge-empty: #1a2d4a;
}
```

---

## 9. Alert Logic

### 9.1 Alarm Types and Thresholds

| Alarm Type | Condition | Severity | Default Threshold |
|------------|-----------|----------|-------------------|
| HIGH_LEVEL | product_mm > high_level_mm | WARNING | 90% of capacity |
| CRITICAL_HIGH | product_mm > 95% capacity | CRITICAL | 95% of capacity |
| LOW_LEVEL | product_mm < low_level_mm | WARNING | 500mm |
| CRITICAL_LOW | product_mm < 250mm | CRITICAL | 250mm |
| HIGH_WATER | water_mm > water_max_mm | CRITICAL | 50mm |
| HIGH_TEMP | temp_c > 45 | WARNING | 45°C |
| CRITICAL_TEMP | temp_c > 55 | CRITICAL | 55°C |
| SENSOR_ERROR | status_code != 0 | CRITICAL | - |
| DEVICE_OFFLINE | no data for > 5 min | WARNING | 5 minutes |
| RAPID_CHANGE | level change > 10% in 5min | INFO | 10% / 5min |

### 9.2 Alarm State Machine

```
                    ┌─────────────┐
                    │   NORMAL    │
                    └──────┬──────┘
                           │
                    Threshold Exceeded
                           │
                           ▼
                    ┌─────────────┐
                    │   ACTIVE    │◄──────────────────┐
                    └──────┬──────┘                   │
                           │                          │
                    Acknowledged                 Condition
                           │                    Still True
                           ▼                          │
                    ┌─────────────┐                   │
                    │ ACKNOWLEDGED├───────────────────┘
                    └──────┬──────┘
                           │
                    Condition Cleared
                    (with hysteresis)
                           │
                           ▼
                    ┌─────────────┐
                    │  RESOLVED   │
                    └─────────────┘
```

### 9.3 Hysteresis Logic

To prevent alarm flapping:
- HIGH_LEVEL: Alarm clears when level drops 2% below threshold
- LOW_LEVEL: Alarm clears when level rises 2% above threshold
- Debounce: Condition must persist for 30 seconds before triggering

---

## 10. Deployment Model

### 10.1 Docker Compose (Development)

```yaml
version: '3.8'

services:
  # MQTT Broker (EMQX)
  emqx:
    image: emqx/emqx:5.8.3
    container_name: atg-emqx
    environment:
      - EMQX_NODE_NAME=emqx@node1.emqx.io
      - EMQX_DASHBOARD__DEFAULT_USERNAME=admin
      - EMQX_DASHBOARD__DEFAULT_PASSWORD=public
      - EMQX_AUTHENTICATION__1__MECHANISM=password_based
      - EMQX_AUTHENTICATION__1__BACKEND=built_in_database
    ports:
      - "1883:1883"      # MQTT TCP
      - "8083:8083"      # MQTT WebSocket
      - "8883:8883"      # MQTT SSL
      - "18083:18083"    # Dashboard
    volumes:
      - emqx-data:/opt/emqx/data
      - emqx-log:/opt/emqx/log
    networks:
      - atg-network
    healthcheck:
      test: ["CMD", "emqx", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # TimescaleDB
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    container_name: atg-timescaledb
    environment:
      - POSTGRES_USER=atg_user
      - POSTGRES_PASSWORD=atg_secure_password
      - POSTGRES_DB=atg_db
    ports:
      - "5432:5432"
    volumes:
      - timescale-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - atg-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atg_user -d atg_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis (Optional - for caching & sessions)
  redis:
    image: redis:7-alpine
    container_name: atg-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - atg-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Backend API Service
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: atg-backend
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://atg_user:atg_secure_password@timescaledb:5432/atg_db
      - MQTT_BROKER_URL=mqtt://emqx:1883
      - MQTT_USERNAME=admin
      - MQTT_PASSWORD=public
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=your-super-secret-jwt-key
      - PORT=3000
    ports:
      - "3000:3000"
    depends_on:
      timescaledb:
        condition: service_healthy
      emqx:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - atg-network
    restart: unless-stopped

  # Frontend (React/Vue)
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: atg-frontend
    ports:
      - "80:80"
    depends_on:
      - backend
    networks:
      - atg-network
    restart: unless-stopped

volumes:
  emqx-data:
  emqx-log:
  timescale-data:
  redis-data:

networks:
  atg-network:
    driver: bridge
```

### 10.2 Kubernetes Deployment (Production)

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: atg-system
---
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: atg-config
  namespace: atg-system
data:
  MQTT_BROKER_URL: "mqtt://emqx-service:1883"
  DATABASE_HOST: "timescaledb-service"
  DATABASE_PORT: "5432"
  DATABASE_NAME: "atg_db"
---
# secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: atg-secrets
  namespace: atg-system
type: Opaque
data:
  DATABASE_PASSWORD: YXRnX3NlY3VyZV9wYXNzd29yZA==  # base64 encoded
  JWT_SECRET: c3VwZXItc2VjcmV0LWp3dC1rZXk=
  MQTT_PASSWORD: cHVibGlj
---
# backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: atg-backend
  namespace: atg-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: atg-backend
  template:
    metadata:
      labels:
        app: atg-backend
    spec:
      containers:
      - name: backend
        image: your-registry/atg-backend:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: atg-config
        - secretRef:
            name: atg-secrets
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /api/system/health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/system/health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
# backend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: atg-backend-service
  namespace: atg-system
spec:
  selector:
    app: atg-backend
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
---
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: atg-ingress
  namespace: atg-system
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - atg.yourdomain.com
    secretName: atg-tls-secret
  rules:
  - host: atg.yourdomain.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: atg-backend-service
            port:
              number: 3000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: atg-frontend-service
            port:
              number: 80
```

### 10.3 Deployment Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION DEPLOYMENT                                  │
└──────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │   CLOUDFLARE    │
                              │   (CDN + WAF)   │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │   LOAD BALANCER │
                              │   (NGINX/HAProxy)│
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
    ┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
    │  Frontend   │             │  Frontend   │             │  Frontend   │
    │  Instance 1 │             │  Instance 2 │             │  Instance 3 │
    └─────────────┘             └─────────────┘             └─────────────┘
           │                           │                           │
           └───────────────────────────┼───────────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │  API GATEWAY    │
                              │  (Kong/Traefik) │
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
    ┌──────▼──────┐             ┌──────▼──────┐             ┌──────▼──────┐
    │  Backend    │             │  Backend    │             │  Backend    │
    │  Instance 1 │             │  Instance 2 │             │  Instance 3 │
    └──────┬──────┘             └──────┬──────┘             └──────┬──────┘
           │                           │                           │
           └───────────────────────────┼───────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
       ┌──────▼──────┐          ┌──────▼──────┐          ┌──────▼──────┐
       │   EMQX      │          │ TimescaleDB │          │   Redis     │
       │   Cluster   │          │  Primary +  │          │   Cluster   │
       │   (3 nodes) │          │  Replicas   │          │   (3 nodes) │
       └─────────────┘          └─────────────┘          └─────────────┘
```

---

## 11. Security Considerations

### 11.1 MQTT Security

```yaml
# EMQX ACL Rules
acl:
  rules:
    # Devices can only publish to their own topics
    - match:
        username: "device_*"
        action: publish
        topics:
          - "atg/${device_id}/+/telemetry"
          - "atg/${device_id}/+/status"
      permission: allow

    # Backend can subscribe to all topics
    - match:
        username: "backend_service"
        action: subscribe
        topics:
          - "atg/#"
          - "sys/#"
      permission: allow

    # Deny all other access
    - match:
        action: "*"
      permission: deny
```

### 11.2 API Security

- JWT tokens with short expiry (15 min) + refresh tokens
- Rate limiting: 100 requests/minute per IP
- Input validation on all endpoints
- SQL injection prevention with parameterized queries
- CORS restricted to allowed origins
- HTTPS enforced in production

### 11.3 Database Security

```sql
-- Create read-only role for reporting
CREATE ROLE atg_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO atg_readonly;

-- Create application role with limited permissions
CREATE ROLE atg_app;
GRANT SELECT, INSERT ON telemetry_data TO atg_app;
GRANT SELECT, INSERT, UPDATE ON alarms_history TO atg_app;
GRANT SELECT ON stations, tanks, dip_charts TO atg_app;

-- Row-level security for multi-tenant access
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY station_access ON stations
    USING (station_id = ANY(current_setting('app.station_access')::text[]));
```

---

## Quick Start Guide

### 1. Start EMQX and TimescaleDB

```bash
cd D:\ATG_Project\Local_MQTT\MQTT
docker-compose up -d
```

### 2. Verify EMQX is Running

```bash
# Check EMQX Dashboard
# Open: http://localhost:18083
# Login: admin / public
```

### 3. Test MQTT Connection

```bash
# Run your existing publisher
python mqtt_publisher.py
```

### 4. Start Backend Server

```bash
node server.js
```

### 5. Access Dashboard

```bash
# Open: http://localhost:3000
```

---

*Document Version: 2.0*
*Last Updated: 2025-01-15*
*Author: ATG System Architecture Team*
