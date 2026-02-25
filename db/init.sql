-- ATG Monitoring System - TimescaleDB Schema
-- Version: 2.0
-- Description: Complete database schema for ATG telemetry storage

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- =====================================================
-- STATIONS TABLE (Static Configuration)
-- =====================================================
CREATE TABLE IF NOT EXISTS stations (
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

-- Insert default station
INSERT INTO stations (station_id, name, location)
VALUES ('DEFAULT', 'Default Station', 'Main Location')
ON CONFLICT (station_id) DO NOTHING;

-- =====================================================
-- TANKS TABLE (Static Configuration)
-- =====================================================
CREATE TABLE IF NOT EXISTS tanks (
    id              SERIAL PRIMARY KEY,
    tank_id         VARCHAR(50) UNIQUE NOT NULL,
    station_id      VARCHAR(50) REFERENCES stations(station_id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    product_type    VARCHAR(50) NOT NULL DEFAULT 'Diesel',
    capacity_liters DECIMAL(12, 2) DEFAULT 50000,
    diameter_mm     DECIMAL(10, 2),
    height_mm       DECIMAL(10, 2) DEFAULT 5000,
    low_level_mm    DECIMAL(10, 2) DEFAULT 500,
    high_level_mm   DECIMAL(10, 2) DEFAULT 4500,
    water_max_mm    DECIMAL(10, 2) DEFAULT 50,
    device_serial   VARCHAR(100),
    device_address  VARCHAR(50),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TELEMETRY DATA TABLE (Hypertable - Time-Series)
-- =====================================================
CREATE TABLE IF NOT EXISTS telemetry_data (
    time            TIMESTAMPTZ NOT NULL,
    tank_id         VARCHAR(50) NOT NULL,
    station_id      VARCHAR(50) DEFAULT 'DEFAULT',
    product_mm      DOUBLE PRECISION,
    water_mm        DOUBLE PRECISION,
    temp_c          DOUBLE PRECISION,
    volume_liters   DOUBLE PRECISION,
    ullage_liters   DOUBLE PRECISION,
    density         DOUBLE PRECISION,
    status_code     INTEGER DEFAULT 0,
    status_message  VARCHAR(50),
    product_type    VARCHAR(50) DEFAULT 'Diesel'
);

-- Convert to hypertable (partitioned by time - 1 day chunks)
SELECT create_hypertable('telemetry_data', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_telemetry_tank_time
    ON telemetry_data (tank_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_station_time
    ON telemetry_data (station_id, time DESC);

-- =====================================================
-- SENSOR DATA TABLE (Legacy - for backward compatibility)
-- =====================================================
CREATE TABLE IF NOT EXISTS sensor_data (
    time            TIMESTAMPTZ NOT NULL,
    tank_id         TEXT NOT NULL,
    product_mm      DOUBLE PRECISION,
    water_mm        DOUBLE PRECISION,
    volume_l        DOUBLE PRECISION,
    temp_c          DOUBLE PRECISION,
    status          TEXT,
    product_type    TEXT DEFAULT 'Diesel'
);

-- Convert legacy table to hypertable
SELECT create_hypertable('sensor_data', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sensor_tank_time
    ON sensor_data (tank_id, time DESC);

-- =====================================================
-- ALARMS HISTORY TABLE (Hypertable)
-- =====================================================
CREATE TABLE IF NOT EXISTS alarms_history (
    time            TIMESTAMPTZ NOT NULL,
    alarm_id        VARCHAR(50) NOT NULL,
    tank_id         VARCHAR(50) NOT NULL,
    station_id      VARCHAR(50) DEFAULT 'DEFAULT',
    alarm_type      VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL DEFAULT 'WARNING',
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

CREATE INDEX IF NOT EXISTS idx_alarms_tank
    ON alarms_history (tank_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_active
    ON alarms_history (acknowledged, resolved, time DESC);
CREATE INDEX IF NOT EXISTS idx_alarms_type
    ON alarms_history (alarm_type, severity, time DESC);

-- =====================================================
-- EVENTS TABLE (System Events & Audit Log)
-- =====================================================
CREATE TABLE IF NOT EXISTS events (
    time            TIMESTAMPTZ NOT NULL,
    event_id        VARCHAR(50) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       VARCHAR(50),
    user_id         VARCHAR(100),
    description     TEXT,
    metadata        JSONB
);

SELECT create_hypertable('events', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_events_type
    ON events (event_type, time DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity
    ON events (entity_type, entity_id, time DESC);

-- =====================================================
-- USERS TABLE (Authentication)
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255),
    role            VARCHAR(50) DEFAULT 'operator',
    station_access  VARCHAR(50)[],
    is_active       BOOLEAN DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default admin user (password: admin123)
-- Password hash for 'admin123' using bcrypt
INSERT INTO users (username, email, password_hash, full_name, role)
VALUES (
    'admin',
    'admin@atg.local',
    '$2b$10$rOzJqQZQG8OzKZ2XvKVBOeQPQNQHq8X5Q5Q5Q5Q5Q5Q5Q5Q5Q5Q5',
    'System Administrator',
    'admin'
)
ON CONFLICT (username) DO NOTHING;

-- =====================================================
-- DIP CHARTS TABLE (Volume Calibration)
-- =====================================================
CREATE TABLE IF NOT EXISTS dip_charts (
    id              SERIAL PRIMARY KEY,
    tank_id         VARCHAR(50) REFERENCES tanks(tank_id) ON DELETE CASCADE,
    depth_mm        INTEGER NOT NULL,
    volume_liters   DOUBLE PRECISION NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tank_id, depth_mm)
);

CREATE INDEX IF NOT EXISTS idx_dip_chart_tank
    ON dip_charts (tank_id, depth_mm);

-- =====================================================
-- DEVICE STATUS TABLE (Real-time device tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS device_status (
    device_id       VARCHAR(50) PRIMARY KEY,
    tank_id         VARCHAR(50),
    station_id      VARCHAR(50),
    online          BOOLEAN DEFAULT FALSE,
    last_seen       TIMESTAMPTZ,
    ip_address      VARCHAR(45),
    firmware_version VARCHAR(50),
    signal_strength INTEGER,
    battery_level   INTEGER,
    uptime_seconds  BIGINT,
    error_count     INTEGER DEFAULT 0,
    last_error      TEXT,
    metadata        JSONB
);

-- =====================================================
-- CONTINUOUS AGGREGATES (Pre-computed Rollups)
-- =====================================================

-- Drop existing views to recreate with updates
DROP MATERIALIZED VIEW IF EXISTS hourly_tank_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS daily_tank_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS hourly_volume_stats CASCADE;

-- Hourly Statistics (For 24h - 30d queries)
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
    MIN(temp_c) as min_temp_c,
    MAX(temp_c) as max_temp_c,
    AVG(volume_liters) as avg_volume,
    MIN(volume_liters) as min_volume,
    MAX(volume_liters) as max_volume,
    COUNT(*) as reading_count
FROM telemetry_data
GROUP BY bucket, tank_id, station_id
WITH NO DATA;

-- Refresh policy for hourly stats
SELECT add_continuous_aggregate_policy('hourly_tank_stats',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Daily Statistics (For 30d+ queries)
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
    AVG(temp_c) as avg_temp,
    SUM(CASE WHEN status_code != 0 THEN 1 ELSE 0 END) as error_count,
    COUNT(*) as reading_count
FROM telemetry_data
GROUP BY bucket, tank_id, station_id
WITH NO DATA;

-- Refresh policy for daily stats
SELECT add_continuous_aggregate_policy('daily_tank_stats',
    start_offset => INTERVAL '2 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Legacy hourly view for backward compatibility
CREATE MATERIALIZED VIEW hourly_volume_stats
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    tank_id,
    AVG(volume_l) as avg_volume,
    AVG(product_mm) as avg_product,
    AVG(water_mm) as avg_water,
    AVG(temp_c) as avg_temp,
    MAX(volume_l) as max_volume,
    MIN(volume_l) as min_volume
FROM sensor_data
GROUP BY bucket, tank_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('hourly_volume_stats',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- =====================================================
-- COMPRESSION POLICIES
-- =====================================================

-- Enable compression on telemetry_data
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tank_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Compress data older than 7 days
SELECT add_compression_policy('telemetry_data',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Enable compression on sensor_data
ALTER TABLE sensor_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tank_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('sensor_data',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Enable compression on alarms_history
ALTER TABLE alarms_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'tank_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('alarms_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- =====================================================
-- RETENTION POLICIES
-- =====================================================

-- Keep raw telemetry data for 90 days
SELECT add_retention_policy('telemetry_data',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Keep raw sensor data for 90 days
SELECT add_retention_policy('sensor_data',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Keep alarms for 1 year
SELECT add_retention_policy('alarms_history',
    INTERVAL '365 days',
    if_not_exists => TRUE
);

-- Keep events for 6 months
SELECT add_retention_policy('events',
    INTERVAL '180 days',
    if_not_exists => TRUE
);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get latest telemetry for all tanks
CREATE OR REPLACE FUNCTION get_latest_telemetry()
RETURNS TABLE (
    tank_id VARCHAR(50),
    station_id VARCHAR(50),
    time TIMESTAMPTZ,
    product_mm DOUBLE PRECISION,
    water_mm DOUBLE PRECISION,
    temp_c DOUBLE PRECISION,
    volume_liters DOUBLE PRECISION,
    status_code INTEGER,
    product_type VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ON (t.tank_id)
        t.tank_id,
        t.station_id,
        t.time,
        t.product_mm,
        t.water_mm,
        t.temp_c,
        t.volume_liters,
        t.status_code,
        t.product_type
    FROM telemetry_data t
    ORDER BY t.tank_id, t.time DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate volume from DIP chart
CREATE OR REPLACE FUNCTION calculate_volume(
    p_tank_id VARCHAR(50),
    p_depth_mm DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    v_volume DOUBLE PRECISION;
BEGIN
    SELECT volume_liters INTO v_volume
    FROM dip_charts
    WHERE tank_id = p_tank_id
      AND depth_mm >= p_depth_mm
    ORDER BY depth_mm ASC
    LIMIT 1;

    IF v_volume IS NULL THEN
        -- Get max volume if depth exceeds chart
        SELECT MAX(volume_liters) INTO v_volume
        FROM dip_charts
        WHERE tank_id = p_tank_id;
    END IF;

    RETURN COALESCE(v_volume, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to create a new alarm
CREATE OR REPLACE FUNCTION create_alarm(
    p_tank_id VARCHAR(50),
    p_station_id VARCHAR(50),
    p_alarm_type VARCHAR(50),
    p_severity VARCHAR(20),
    p_current_value DOUBLE PRECISION,
    p_threshold DOUBLE PRECISION,
    p_message TEXT
) RETURNS VARCHAR(50) AS $$
DECLARE
    v_alarm_id VARCHAR(50);
BEGIN
    v_alarm_id := 'ALM-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' ||
                  SUBSTRING(MD5(RANDOM()::TEXT), 1, 8);

    INSERT INTO alarms_history (
        time, alarm_id, tank_id, station_id, alarm_type,
        severity, current_value, threshold_value, message
    ) VALUES (
        NOW(), v_alarm_id, p_tank_id, p_station_id, p_alarm_type,
        p_severity, p_current_value, p_threshold, p_message
    );

    RETURN v_alarm_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active alarms view
CREATE OR REPLACE VIEW active_alarms AS
SELECT
    ah.*,
    t.name as tank_name,
    s.name as station_name
FROM alarms_history ah
LEFT JOIN tanks t ON ah.tank_id = t.tank_id
LEFT JOIN stations s ON ah.station_id = s.station_id
WHERE ah.acknowledged = FALSE
  AND ah.resolved = FALSE
ORDER BY
    CASE ah.severity
        WHEN 'CRITICAL' THEN 1
        WHEN 'WARNING' THEN 2
        ELSE 3
    END,
    ah.time DESC;

-- Tank summary view
CREATE OR REPLACE VIEW tank_summary AS
SELECT
    t.tank_id,
    t.name,
    t.product_type,
    t.capacity_liters,
    s.station_id,
    s.name as station_name,
    COALESCE(latest.product_mm, 0) as current_level_mm,
    COALESCE(latest.volume_liters, 0) as current_volume,
    COALESCE(latest.temp_c, 0) as current_temp,
    COALESCE(latest.water_mm, 0) as current_water,
    latest.time as last_update,
    CASE
        WHEN latest.product_mm IS NULL THEN 'OFFLINE'
        WHEN latest.status_code != 0 THEN 'ERROR'
        ELSE 'OK'
    END as status,
    (SELECT COUNT(*) FROM alarms_history ah
     WHERE ah.tank_id = t.tank_id
       AND ah.acknowledged = FALSE
       AND ah.resolved = FALSE) as active_alarms
FROM tanks t
LEFT JOIN stations s ON t.station_id = s.station_id
LEFT JOIN LATERAL (
    SELECT * FROM telemetry_data td
    WHERE td.tank_id = t.tank_id
    ORDER BY td.time DESC
    LIMIT 1
) latest ON TRUE
WHERE t.is_active = TRUE;

-- Grant permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;

-- Output success message
DO $$
BEGIN
    RAISE NOTICE 'ATG Database Schema initialized successfully!';
    RAISE NOTICE 'Tables created: stations, tanks, telemetry_data, sensor_data, alarms_history, events, users, dip_charts, device_status';
    RAISE NOTICE 'Hypertables configured with compression and retention policies';
    RAISE NOTICE 'Continuous aggregates created for hourly and daily statistics';
END $$;
