-- ATG Monitoring System - Seed Data
-- Sample stations, tanks, and configuration data

-- =====================================================
-- SAMPLE STATIONS
-- =====================================================
INSERT INTO stations (station_id, name, location, latitude, longitude, address, contact_name, contact_phone, timezone)
VALUES
    ('STATION001', 'Main Depot', 'Karachi', 24.8607, 67.0011, '123 Industrial Area, Karachi', 'Ahmed Khan', '+92-300-1234567', 'Asia/Karachi'),
    ('STATION002', 'North Terminal', 'Lahore', 31.5204, 74.3587, '456 Motorway Road, Lahore', 'Ali Raza', '+92-300-2345678', 'Asia/Karachi'),
    ('STATION003', 'South Facility', 'Karachi Port', 24.8465, 66.9780, '789 Port Area, Karachi', 'Bilal Ahmed', '+92-300-3456789', 'Asia/Karachi')
ON CONFLICT (station_id) DO NOTHING;

-- =====================================================
-- SAMPLE TANKS
-- =====================================================
INSERT INTO tanks (tank_id, station_id, name, product_type, capacity_liters, height_mm, diameter_mm, low_level_mm, high_level_mm, water_max_mm, device_address)
VALUES
    -- Station 001 Tanks
    ('TANK001', 'STATION001', 'Diesel Tank 1', 'Diesel', 50000, 5000, 2500, 500, 4500, 50, '83731'),
    ('TANK002', 'STATION001', 'Diesel Tank 2', 'Diesel', 50000, 5000, 2500, 500, 4500, 50, '83732'),
    ('TANK003', 'STATION001', 'Petrol Tank 1', 'Petrol', 40000, 4500, 2400, 450, 4050, 40, '83733'),
    ('TANK004', 'STATION001', 'HSD Tank', 'HSD', 60000, 5500, 2600, 550, 4950, 55, '83734'),

    -- Station 002 Tanks
    ('TANK005', 'STATION002', 'Diesel Storage A', 'Diesel', 80000, 6000, 3000, 600, 5400, 60, '83735'),
    ('TANK006', 'STATION002', 'Diesel Storage B', 'Diesel', 80000, 6000, 3000, 600, 5400, 60, '83736'),
    ('TANK007', 'STATION002', 'Petrol Storage', 'Petrol', 50000, 5000, 2500, 500, 4500, 50, '83737'),

    -- Station 003 Tanks
    ('TANK008', 'STATION003', 'Bulk Diesel', 'Diesel', 100000, 7000, 3500, 700, 6300, 70, '83738'),
    ('TANK009', 'STATION003', 'Bulk HSD', 'HSD', 100000, 7000, 3500, 700, 6300, 70, '83739'),
    ('TANK010', 'STATION003', 'Chemical Tank', 'Chemical', 30000, 4000, 2200, 400, 3600, 30, '83740')
ON CONFLICT (tank_id) DO NOTHING;

-- Also register legacy flat topic tanks
INSERT INTO tanks (tank_id, station_id, name, product_type, capacity_liters, height_mm, low_level_mm, high_level_mm, water_max_mm, device_address)
VALUES
    ('ATG83731', 'STATION001', 'ATG 83731 (Legacy)', 'Diesel', 50000, 5000, 500, 4500, 50, '83731'),
    ('ATG83729', 'DEFAULT', 'ATG 83729 (Legacy)', 'Diesel', 50000, 5000, 500, 4500, 50, '83729')
ON CONFLICT (tank_id) DO NOTHING;

-- =====================================================
-- SAMPLE DIP CHART (for 50,000L cylindrical tank)
-- =====================================================
INSERT INTO dip_charts (tank_id, depth_mm, volume_liters)
SELECT 'TANK001', depth, volume
FROM (VALUES
    (0, 0), (100, 1250), (200, 3520), (300, 6180), (400, 9120), (500, 12290),
    (600, 15650), (700, 19150), (800, 22750), (900, 26430), (1000, 30150),
    (1100, 33880), (1200, 37580), (1300, 41220), (1400, 44760), (1500, 48150),
    (1600, 51350), (1700, 54320), (1800, 57020), (1900, 59410), (2000, 61450),
    (2100, 63110), (2200, 64360), (2300, 65170), (2400, 65520), (2500, 65410),
    (2600, 64850), (2700, 63850), (2800, 62440), (2900, 60640), (3000, 58500),
    (3100, 56050), (3200, 53330), (3300, 50400), (3400, 47300), (3500, 44080),
    (3600, 40800), (3700, 37500), (3800, 34240), (3900, 31080), (4000, 28060),
    (4100, 25220), (4200, 22620), (4300, 20280), (4400, 18220), (4500, 16460),
    (4600, 15000), (4700, 13840), (4800, 12960), (4900, 12340), (5000, 12000)
) AS chart(depth, volume)
ON CONFLICT (tank_id, depth_mm) DO NOTHING;

-- Copy DIP chart to other diesel tanks
INSERT INTO dip_charts (tank_id, depth_mm, volume_liters)
SELECT tank_id, d.depth_mm, d.volume_liters
FROM tanks t
CROSS JOIN dip_charts d
WHERE d.tank_id = 'TANK001'
  AND t.tank_id IN ('TANK002', 'ATG83731', 'ATG83729')
  AND t.tank_id != 'TANK001'
ON CONFLICT (tank_id, depth_mm) DO NOTHING;

-- =====================================================
-- SAMPLE DEVICE STATUS
-- =====================================================
INSERT INTO device_status (device_id, tank_id, station_id, online, last_seen, firmware_version)
VALUES
    ('ATG83731', 'TANK001', 'STATION001', true, NOW(), '2.1.0'),
    ('ATG83732', 'TANK002', 'STATION001', true, NOW(), '2.1.0'),
    ('ATG83733', 'TANK003', 'STATION001', true, NOW(), '2.0.5'),
    ('ATG83734', 'TANK004', 'STATION001', true, NOW(), '2.0.5'),
    ('ATG83735', 'TANK005', 'STATION002', true, NOW(), '2.1.0'),
    ('ATG83736', 'TANK006', 'STATION002', false, NOW() - INTERVAL '2 hours', '2.0.0'),
    ('ATG83737', 'TANK007', 'STATION002', true, NOW(), '2.1.0'),
    ('ATG83738', 'TANK008', 'STATION003', true, NOW(), '2.1.0'),
    ('ATG83739', 'TANK009', 'STATION003', true, NOW(), '2.1.0'),
    ('ATG83740', 'TANK010', 'STATION003', true, NOW(), '2.0.5')
ON CONFLICT (device_id) DO UPDATE SET
    online = EXCLUDED.online,
    last_seen = EXCLUDED.last_seen;

-- =====================================================
-- SAMPLE EVENTS
-- =====================================================
INSERT INTO events (time, event_id, event_type, entity_type, entity_id, description, metadata)
VALUES
    (NOW() - INTERVAL '1 day', 'EVT-001', 'SYSTEM_START', 'system', 'main', 'ATG Monitoring System started', '{"version": "2.0.0"}'),
    (NOW() - INTERVAL '12 hours', 'EVT-002', 'DELIVERY', 'tank', 'TANK001', 'Fuel delivery received', '{"volume_liters": 25000, "supplier": "PSO"}'),
    (NOW() - INTERVAL '6 hours', 'EVT-003', 'CALIBRATION', 'tank', 'TANK003', 'Tank calibration completed', '{"technician": "Ali Raza"}'),
    (NOW() - INTERVAL '2 hours', 'EVT-004', 'DEVICE_OFFLINE', 'device', 'ATG83736', 'Device went offline', '{"last_reading": {"product": 3500, "temp": 24.5}}'),
    (NOW(), 'EVT-005', 'CONFIG_CHANGE', 'tank', 'TANK001', 'Alert thresholds updated', '{"old_low": 400, "new_low": 500}');

-- =====================================================
-- SAMPLE ALARMS (for testing)
-- =====================================================
INSERT INTO alarms_history (time, alarm_id, tank_id, station_id, alarm_type, severity, current_value, threshold_value, message, acknowledged, resolved)
VALUES
    (NOW() - INTERVAL '3 hours', 'ALM-001', 'TANK001', 'STATION001', 'LOW_LEVEL', 'WARNING', 480, 500, 'Product level below threshold', true, true),
    (NOW() - INTERVAL '1 hour', 'ALM-002', 'TANK003', 'STATION001', 'HIGH_WATER', 'WARNING', 55, 50, 'Water level exceeded maximum', true, false),
    (NOW() - INTERVAL '30 minutes', 'ALM-003', 'TANK006', 'STATION002', 'DEVICE_OFFLINE', 'CRITICAL', 0, 0, 'Device not responding', false, false);

-- =====================================================
-- SAMPLE TELEMETRY DATA (last 24 hours for testing)
-- =====================================================
INSERT INTO telemetry_data (time, tank_id, station_id, product_mm, water_mm, temp_c, volume_liters, status_code, product_type)
SELECT
    NOW() - (generate_series * INTERVAL '5 minutes'),
    'TANK001',
    'STATION001',
    3500 + (random() * 100)::int - 50,
    12 + (random() * 5)::int,
    23 + (random() * 3),
    22500 + (random() * 1000)::int - 500,
    0,
    'Diesel'
FROM generate_series(1, 288);  -- 24 hours * 12 readings/hour

INSERT INTO telemetry_data (time, tank_id, station_id, product_mm, water_mm, temp_c, volume_liters, status_code, product_type)
SELECT
    NOW() - (generate_series * INTERVAL '5 minutes'),
    'TANK002',
    'STATION001',
    4200 + (random() * 100)::int - 50,
    8 + (random() * 4)::int,
    24 + (random() * 2.5),
    32000 + (random() * 800)::int - 400,
    0,
    'Diesel'
FROM generate_series(1, 288);

INSERT INTO telemetry_data (time, tank_id, station_id, product_mm, water_mm, temp_c, volume_liters, status_code, product_type)
SELECT
    NOW() - (generate_series * INTERVAL '5 minutes'),
    'TANK003',
    'STATION001',
    2800 + (random() * 150)::int - 75,
    15 + (random() * 8)::int,
    25 + (random() * 3),
    18000 + (random() * 1200)::int - 600,
    0,
    'Petrol'
FROM generate_series(1, 288);

-- Legacy format data for ATG83731
INSERT INTO sensor_data (time, tank_id, product_mm, water_mm, temp_c, volume_l, status, product_type)
SELECT
    NOW() - (generate_series * INTERVAL '5 minutes'),
    'ATG83731',
    3619 + (random() * 50)::int - 25,
    3510 + (random() * 10)::int - 5,
    23.8 + (random() * 1) - 0.5,
    45230 + (random() * 500)::int - 250,
    '0',
    'Diesel'
FROM generate_series(1, 288);

-- =====================================================
-- Refresh continuous aggregates
-- =====================================================
CALL refresh_continuous_aggregate('hourly_tank_stats', NOW() - INTERVAL '24 hours', NOW());
CALL refresh_continuous_aggregate('hourly_volume_stats', NOW() - INTERVAL '24 hours', NOW());

-- =====================================================
-- Success message
-- =====================================================
DO $$
BEGIN
    RAISE NOTICE 'Seed data inserted successfully!';
    RAISE NOTICE 'Created 3 stations with 10 tanks';
    RAISE NOTICE 'Added sample DIP chart data';
    RAISE NOTICE 'Inserted 24 hours of sample telemetry';
END $$;
