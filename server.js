const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const path = require('path')
const fs = require('fs')
const multer = require('multer')
const mqtt = require('mqtt')
const { Pool } = require('pg')
const { parseDipChart } = require('./dip_parser')

// Configuration
const MQTT_BROKER_URL = 'mqtt://localhost:1883'
const HTTP_PORT = 3000
// Enable MQTT integration when `ENABLE_MQTT=true` is present in the environment.
const ENABLE_MQTT = process.env.ENABLE_MQTT === 'true';
const DB_CONFIG = {
  user: 'postgres',
  host: 'localhost',
  database: 'atg_db',
  password: 'password',
  port: 5432,
}

// --- Database Setup ---
const pool = new Pool(DB_CONFIG)

async function initDB() {
  try {
    const client = await pool.connect();
    try {
      // Create table
      await client.query(`
                CREATE TABLE IF NOT EXISTS sensor_data (
                    time TIMESTAMPTZ NOT NULL,
                    tank_id TEXT NOT NULL,
                    product_mm DOUBLE PRECISION,
                    water_mm DOUBLE PRECISION,
                    volume_l DOUBLE PRECISION,
                    temp_c DOUBLE PRECISION,
                    status TEXT,
                    product_type TEXT
                );
            `);

      // Add product_type column if it doesn't exist (migrations for existing DB)
      try {
        await client.query(`ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS product_type TEXT;`);
      } catch (e) {
        console.log('Migration check:', e.message);
      }



      // Convert to hypertable (TimescaleDB)
      try {
        await client.query("SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);");
        console.log('Hypertable configured');
      } catch (e) {
        console.log('Hypertable check:', e.message);
      }

      // Create Continuous Aggregate: Hourly Stats
      // We drop it first to ensure we can update the definition to include all metrics
      try {
        // Note: In production, we wouldn't just drop data, but for this upgrade we will recreate the view
        // to include Product, Water, and Temp.
        await client.query("DROP MATERIALIZED VIEW IF EXISTS hourly_volume_stats CASCADE");

        await client.query(`
              CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_volume_stats
      WITH(timescaledb.continuous) AS
              SELECT time_bucket('1 hour', time) AS bucket,
        tank_id,
        AVG(volume_l) as avg_volume,
        AVG(product_mm) as avg_product,
        AVG(water_mm) as avg_water,
        AVG(temp_c) as avg_temp,
        MAX(volume_l) as max_volume,
        MIN(volume_l) as min_volume
              FROM sensor_data
              GROUP BY bucket, tank_id;
      `);
        console.log('Continuous Aggregate view configured (Enterprise)');
      } catch (e) {
        console.log('Continuous Aggregate check:', e.message);
      }

      // Create alarms table
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS alarms (
            id SERIAL PRIMARY KEY,
            alarm_id TEXT UNIQUE NOT NULL,
            tank_id TEXT NOT NULL,
            alarm_type TEXT NOT NULL,
            severity TEXT NOT NULL,
            current_value DOUBLE PRECISION,
            threshold_value DOUBLE PRECISION,
            message TEXT,
            acknowledged BOOLEAN DEFAULT FALSE,
            resolved BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            acknowledged_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ
          );
        `);
        console.log('Alarms table configured');
      } catch (e) {
        console.log('Alarms table check:', e.message);
      }

      // Create tank_config table for storing tank settings
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS tank_config (
            tank_id TEXT PRIMARY KEY,
            product_type TEXT DEFAULT 'HSD',
            tank_name TEXT,
            capacity_liters DOUBLE PRECISION,
            low_alarm_threshold DOUBLE PRECISION,
            high_alarm_threshold DOUBLE PRECISION,
            calibration_offset DOUBLE PRECISION DEFAULT 0,
            product_offset DOUBLE PRECISION DEFAULT 0,
            water_offset DOUBLE PRECISION DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('Tank config table configured');
      } catch (e) {
        console.log('Tank config table check:', e.message);
      }

      // Add calibration columns if they don't exist (migration)
      try {
        await client.query(`ALTER TABLE tank_config ADD COLUMN IF NOT EXISTS calibration_offset DOUBLE PRECISION DEFAULT 0;`);
        await client.query(`ALTER TABLE tank_config ADD COLUMN IF NOT EXISTS product_offset DOUBLE PRECISION DEFAULT 0;`);
        await client.query(`ALTER TABLE tank_config ADD COLUMN IF NOT EXISTS water_offset DOUBLE PRECISION DEFAULT 0;`);
      } catch (e) {
        console.log('Calibration columns migration check:', e.message);
      }

      console.log('Database initialized');
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDB();

// --- File Upload Setup ---
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

// --- DIP Chart Management ---
const dipCharts = {}; // Map<tankId, Array<{depth, volume}>>
const CHARTS_DIR = path.join(__dirname, 'dip_charts');
if (!fs.existsSync(CHARTS_DIR)) {
  fs.mkdirSync(CHARTS_DIR);
}

function loadDipCharts() {
  try {
    const files = fs.readdirSync(CHARTS_DIR);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const tankId = file.replace('.json', '');
        try {
          const data = JSON.parse(fs.readFileSync(path.join(CHARTS_DIR, file), 'utf8'));
          dipCharts[tankId] = data;
          console.log(`Loaded DIP chart for tank ${tankId}`);
        } catch (e) {
          console.error(`Error loading chart for ${tankId}: `, e.message);
        }
      }
    });

    // Load default chart if exists
    if (fs.existsSync('dip_chart.json')) {
      try {
        const defaultChart = JSON.parse(fs.readFileSync('dip_chart.json', 'utf8'));
        dipCharts['default'] = defaultChart;
        console.log('Loaded default DIP chart');
      } catch (e) { }
    }
  } catch (e) {
    console.error('Error loading charts:', e);
  }
}

loadDipCharts();

// In-memory cache for calibration offsets { tankId: { product: number, water: number } }
const calibrationCache = {};

// Load calibration offsets from database
async function loadCalibrationOffsets() {
  try {
    const result = await pool.query('SELECT tank_id, product_offset, water_offset FROM tank_config');
    result.rows.forEach(row => {
      calibrationCache[row.tank_id] = {
        product: parseFloat(row.product_offset) || 0,
        water: parseFloat(row.water_offset) || 0
      };
    });
    console.log('Loaded calibration offsets for', Object.keys(calibrationCache).length, 'tanks');
  } catch (e) {
    console.log('Could not load calibration offsets:', e.message);
  }
}

// Load calibrations on startup (after DB init)
setTimeout(loadCalibrationOffsets, 2000);

/**
 * Get volume for a given depth using linear interpolation
 * Handles floating point depth values by interpolating between DIP chart entries
 * Applies calibration offset if set for the tank
 * @param {string} tankId - Tank identifier
 * @param {number} depth - Product depth in mm (can be floating point)
 * @returns {number} - Interpolated volume in liters
 */
function getVolume(tankId, depth) {
  let chart = dipCharts[tankId] || dipCharts['default'];
  if (!chart || !chart.length) return 0;

  // Ensure depth is a number
  depth = parseFloat(depth) || 0;

  // Apply product calibration offset (subtract from raw reading)
  const offsets = calibrationCache[tankId] || { product: 0, water: 0 };
  depth = Math.max(0, depth - offsets.product); // Don't go below 0

  // Handle edge cases
  if (depth <= chart[0].depth) {
    return chart[0].volume;
  }
  if (depth >= chart[chart.length - 1].depth) {
    return chart[chart.length - 1].volume;
  }

  // Find the two entries to interpolate between
  // Binary search for efficiency with large charts
  let low = 0;
  let high = chart.length - 1;

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (chart[mid].depth <= depth) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const lower = chart[low];
  const upper = chart[high];

  // Linear interpolation
  // volume = lower.volume + (depth - lower.depth) * (upper.volume - lower.volume) / (upper.depth - lower.depth)
  const depthRange = upper.depth - lower.depth;
  if (depthRange === 0) {
    return lower.volume;
  }

  const volumeRange = upper.volume - lower.volume;
  const fraction = (depth - lower.depth) / depthRange;
  const interpolatedVolume = lower.volume + (fraction * volumeRange);

  // Round to 2 decimal places
  return Math.round(interpolatedVolume * 100) / 100;
}

/**
 * Get calibrated water level
 * @param {string} tankId - Tank identifier
 * @param {number} rawWater - Raw water level in mm
 * @returns {number} - Calibrated water level in mm
 */
function getCalibratedWater(tankId, rawWater) {
  rawWater = parseFloat(rawWater) || 0;
  const offsets = calibrationCache[tankId] || { product: 0, water: 0 };
  return Math.max(0, rawWater - offsets.water);
}

// --- Web Server & Socket.io Setup ---
const app = express()
const httpServer = http.createServer(app)
const io = socketIo(httpServer)

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json()) // Parse JSON request bodies

// API for uploading DIP chart
app.post('/api/upload-dip/:tankId', upload.single('dipChart'), async (req, res) => {
  const tankId = req.params.tankId;
  if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

  try {
    console.log(`Processing DIP chart upload for tank ${tankId}...`);
    const parsedData = await parseDipChart(req.file.buffer);

    if (parsedData.length === 0) return res.status(400).json({ success: false, message: 'No valid data' });

    const filePath = path.join(CHARTS_DIR, `${tankId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
    dipCharts[tankId] = parsedData;

    console.log(`Saved DIP chart for tank ${tankId}`);
    res.json({ success: true, message: `Uploaded ${parsedData.length} entries`, entries: parsedData.length });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: 'Failed to process PDF: ' + err.message });
  }
});

// API for Historical Data (Enterprise)
app.get('/api/history/:tankId', async (req, res) => {
  const tankId = req.params.tankId;
  const range = req.query.range || '24h';

  try {
    let query;
    let params;

    // Routing Logic:
    // - If range is <= 24h, use RAW data for high precision.
    // - If range is > 24h, use AGGREGATE data for performance.

    // Determine interval and bucket size based on range
    let intervalStr, bucketSize;
    switch (range) {
      case '1h':
        intervalStr = '1 hour';
        bucketSize = '1 minute';
        break;
      case '6h':
        intervalStr = '6 hours';
        bucketSize = '2 minutes';
        break;
      case '24h':
        intervalStr = '24 hours';
        bucketSize = '5 minutes';
        break;
      case '7d':
        intervalStr = '7 days';
        bucketSize = '1 hour';
        break;
      case '30d':
        intervalStr = '30 days';
        bucketSize = '6 hours';
        break;
      default:
        intervalStr = '24 hours';
        bucketSize = '5 minutes';
    }

    if (['1h', '6h', '24h'].includes(range)) {
      // Raw Data Query for shorter ranges
      query = `
                SELECT time_bucket($3, time) AS bucket,
        AVG(volume_l) as volume,
        AVG(product_mm) as product,
        AVG(water_mm) as water,
        AVG(temp_c) as temp
                FROM sensor_data
                WHERE tank_id = $1 AND time > NOW() - $2::INTERVAL
                GROUP BY bucket
                ORDER BY bucket ASC;
      `;
      params = [tankId, intervalStr, bucketSize];
    } else {
      // Aggregate Data Query (7 Days, 30 Days, etc.)
      // Uses the Continuous Aggregate view
      query = `
                SELECT bucket,
        avg_volume as volume,
        avg_product as product,
        avg_water as water,
        avg_temp as temp
                FROM hourly_volume_stats
                WHERE tank_id = $1 AND bucket > NOW() - $2::INTERVAL
                ORDER BY bucket ASC;
      `;
      params = [tankId, intervalStr];
    }

    const result = await pool.query(query, params);

    // Get calibration offsets for this tank
    const offsets = calibrationCache[tankId] || { product: 0, water: 0 };

    // Apply calibration to historical data
    const data = result.rows.map(row => {
      const rawProduct = parseFloat(row.product || 0);
      const rawWater = parseFloat(row.water || 0);

      return {
        time: row.bucket,
        volume: parseFloat(row.volume || 0).toFixed(2),
        product: Math.max(0, rawProduct - offsets.product).toFixed(2),  // Apply calibration
        water: Math.max(0, rawWater - offsets.water).toFixed(2),        // Apply calibration
        temp: parseFloat(row.temp || 0).toFixed(2)
      };
    });

    res.json({ success: true, data: data });
  } catch (err) {
    console.error('History query error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// API for Latest Tank Data (Persistence)
app.get('/api/tanks/latest', async (req, res) => {
  try {
    // Get the most recent record for each tank with config (including calibration offsets)
    const query = `
      SELECT DISTINCT ON(s.tank_id)
        s.tank_id,
        s.volume_l as volume,
        s.product_mm as product,
        s.water_mm as water,
        s.temp_c as temp,
        s.status,
        s.time,
        COALESCE(c.product_type, 'HSD') as product_type,
        c.tank_name,
        c.capacity_liters,
        COALESCE(c.product_offset, 0) as product_offset,
        COALESCE(c.water_offset, 0) as water_offset
      FROM sensor_data s
      LEFT JOIN tank_config c ON s.tank_id = c.tank_id
      ORDER BY s.tank_id, s.time DESC;
    `;

    const result = await pool.query(query);

    // Apply calibration offsets to the returned data
    const data = result.rows.map(row => {
      const rawProduct = parseFloat(row.product) || 0;
      const rawWater = parseFloat(row.water) || 0;
      const productOffset = parseFloat(row.product_offset) || 0;
      const waterOffset = parseFloat(row.water_offset) || 0;

      return {
        Address: row.tank_id,
        Volume: row.volume,
        Product: Math.max(0, rawProduct - productOffset),  // Apply calibration
        Water: Math.max(0, rawWater - waterOffset),        // Apply calibration
        Temp: row.temp,
        Status: row.status,
        lastSeen: row.time,
        ProductType: row.product_type,
        TankName: row.tank_name,
        Capacity: row.capacity_liters
      };
    });

    res.json({ success: true, data: data });
  } catch (err) {
    console.error('Latest data query error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ============================================
// TANK CONFIGURATION API
// ============================================

// Get tank configuration
app.get('/api/tanks/:tankId/config', async (req, res) => {
  const { tankId } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM tank_config WHERE tank_id = $1',
      [tankId]
    );

    if (result.rows.length === 0) {
      // Return default config if none exists
      return res.json({
        success: true,
        config: {
          tank_id: tankId,
          product_type: 'HSD',
          tank_name: null,
          capacity_liters: null
        }
      });
    }

    res.json({ success: true, config: result.rows[0] });
  } catch (err) {
    console.error('Get tank config error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Update tank configuration (including product type)
app.put('/api/tanks/:tankId/config', async (req, res) => {
  const { tankId } = req.params;
  const { productType, tankName, capacity } = req.body;

  try {
    // Upsert tank configuration
    const result = await pool.query(`
      INSERT INTO tank_config (tank_id, product_type, tank_name, capacity_liters, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (tank_id)
      DO UPDATE SET
        product_type = COALESCE($2, tank_config.product_type),
        tank_name = COALESCE($3, tank_config.tank_name),
        capacity_liters = COALESCE($4, tank_config.capacity_liters),
        updated_at = NOW()
      RETURNING *
    `, [tankId, productType, tankName, capacity]);

    res.json({ success: true, config: result.rows[0] });
  } catch (err) {
    console.error('Update tank config error:', err);
    res.status(500).json({ success: false, message: 'Failed to update configuration' });
  }
});

// API to Delete Tank
app.delete('/api/tanks/:tankId', async (req, res) => {
  const tankId = req.params.tankId;
  console.log(`Request to delete tank: ${tankId}`);

  try {
    // 1. Delete from sensor_data
    const result = await pool.query('DELETE FROM sensor_data WHERE tank_id = $1', [tankId]);
    console.log(`Deleted ${result.rowCount} rows from sensor_data for tank ${tankId}`);

    // 2. Delete from tank_config
    await pool.query('DELETE FROM tank_config WHERE tank_id = $1', [tankId]);
    console.log(`Deleted config for tank ${tankId}`);

    // 3. Delete related alarms
    await pool.query('DELETE FROM alarms WHERE tank_id = $1', [tankId]);
    console.log(`Deleted alarms for tank ${tankId}`);

    // 2. Delete DIP Chart file if exists
    const chartPath = path.join(CHARTS_DIR, `${tankId}.json`);
    if (fs.existsSync(chartPath)) {
      try {
        fs.unlinkSync(chartPath);
        console.log(`Deleted DIP chart file for ${tankId}`);
      } catch (e) {
        console.error(`Failed to delete chart file: ${e.message}`);
      }
    }

    // 3. Remove from in-memory cache
    if (dipCharts[tankId]) {
      delete dipCharts[tankId];
    }

    res.json({ success: true, message: `Tank ${tankId} deleted successfully` });
  } catch (err) {
    console.error('Delete tank error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete tank' });
  }

});

// ============================================
// ALARMS API
// ============================================

// Get all alarms
app.get('/api/alarms', async (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    let whereClause = '';

    switch (filter) {
      case 'active':
        whereClause = 'WHERE acknowledged = FALSE AND resolved = FALSE';
        break;
      case 'acknowledged':
        whereClause = 'WHERE acknowledged = TRUE AND resolved = FALSE';
        break;
      case 'resolved':
        whereClause = 'WHERE resolved = TRUE';
        break;
      default:
        whereClause = '';
    }

    const result = await pool.query(`
      SELECT alarm_id, tank_id, alarm_type, severity, current_value, threshold_value,
             message, acknowledged, resolved, created_at, acknowledged_at, resolved_at
      FROM alarms
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 100
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Get alarms error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Create a new alarm
app.post('/api/alarms', async (req, res) => {
  const { alarmId, tankId, type, severity, value, threshold, message } = req.body;

  try {
    // Check if similar unresolved alarm exists
    const existing = await pool.query(
      'SELECT * FROM alarms WHERE tank_id = $1 AND alarm_type = $2 AND resolved = FALSE',
      [tankId, type]
    );

    if (existing.rows.length > 0) {
      return res.json({ success: true, message: 'Alarm already exists', alarm: existing.rows[0] });
    }

    const result = await pool.query(`
      INSERT INTO alarms (alarm_id, tank_id, alarm_type, severity, current_value, threshold_value, message)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [alarmId, tankId, type, severity, value, threshold, message]);

    res.json({ success: true, alarm: result.rows[0] });
  } catch (err) {
    console.error('Create alarm error:', err);
    res.status(500).json({ success: false, message: 'Failed to create alarm' });
  }
});

// Acknowledge an alarm
app.put('/api/alarms/:alarmId/acknowledge', async (req, res) => {
  const { alarmId } = req.params;

  try {
    const result = await pool.query(`
      UPDATE alarms
      SET acknowledged = TRUE, acknowledged_at = NOW()
      WHERE alarm_id = $1
      RETURNING *
    `, [alarmId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alarm not found' });
    }

    res.json({ success: true, alarm: result.rows[0] });
  } catch (err) {
    console.error('Acknowledge alarm error:', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge alarm' });
  }
});

// Acknowledge all alarms
app.put('/api/alarms/acknowledge-all', async (req, res) => {
  try {
    await pool.query(`
      UPDATE alarms
      SET acknowledged = TRUE, acknowledged_at = NOW()
      WHERE acknowledged = FALSE
    `);

    res.json({ success: true, message: 'All alarms acknowledged' });
  } catch (err) {
    console.error('Acknowledge all alarms error:', err);
    res.status(500).json({ success: false, message: 'Failed to acknowledge alarms' });
  }
});

// Resolve an alarm
app.put('/api/alarms/:alarmId/resolve', async (req, res) => {
  const { alarmId } = req.params;

  try {
    const result = await pool.query(`
      UPDATE alarms
      SET resolved = TRUE, resolved_at = NOW()
      WHERE alarm_id = $1
      RETURNING *
    `, [alarmId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alarm not found' });
    }

    res.json({ success: true, alarm: result.rows[0] });
  } catch (err) {
    console.error('Resolve alarm error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve alarm' });
  }
});

// Delete an alarm
app.delete('/api/alarms/:alarmId', async (req, res) => {
  const { alarmId } = req.params;

  try {
    await pool.query('DELETE FROM alarms WHERE alarm_id = $1', [alarmId]);
    res.json({ success: true, message: 'Alarm deleted' });
  } catch (err) {
    console.error('Delete alarm error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete alarm' });
  }
});

// ============================================
// CALIBRATION API
// ============================================

// Get calibration for a specific tank
app.get('/api/tanks/:tankId/calibration', async (req, res) => {
  const { tankId } = req.params;

  try {
    const result = await pool.query(
      'SELECT tank_id, product_offset, water_offset, updated_at FROM tank_config WHERE tank_id = $1',
      [tankId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        calibration: { tank_id: tankId, product_offset: 0, water_offset: 0 }
      });
    }

    res.json({ success: true, calibration: result.rows[0] });
  } catch (err) {
    console.error('Get calibration error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Save/Update calibration for a tank
app.put('/api/tanks/:tankId/calibration', async (req, res) => {
  const { tankId } = req.params;
  const { productOffset, waterOffset } = req.body;

  console.log('Calibration request for tank:', tankId, 'body:', req.body);

  // Parse offset values (default to 0)
  const productVal = parseFloat(productOffset) || 0;
  const waterVal = parseFloat(waterOffset) || 0;

  try {
    // First check if tank_config exists for this tank
    const existing = await pool.query('SELECT tank_id FROM tank_config WHERE tank_id = $1', [tankId]);

    let result;
    if (existing.rows.length === 0) {
      // Insert new row
      result = await pool.query(`
        INSERT INTO tank_config (tank_id, product_offset, water_offset, updated_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING tank_id, product_offset, water_offset, updated_at
      `, [tankId, productVal, waterVal]);
    } else {
      // Update existing row
      result = await pool.query(`
        UPDATE tank_config
        SET product_offset = $2, water_offset = $3, updated_at = NOW()
        WHERE tank_id = $1
        RETURNING tank_id, product_offset, water_offset, updated_at
      `, [tankId, productVal, waterVal]);
    }

    // Update in-memory cache
    calibrationCache[tankId] = { product: productVal, water: waterVal };

    console.log(`Calibration updated for tank ${tankId}: product=${productVal}mm, water=${waterVal}mm`);
    res.json({ success: true, calibration: result.rows[0] });
  } catch (err) {
    console.error('Update calibration error:', err);
    res.status(500).json({ success: false, message: 'Failed to update calibration: ' + err.message });
  }
});

// Get all calibrations
app.get('/api/calibrations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tank_id, product_offset, water_offset, updated_at
      FROM tank_config
      ORDER BY tank_id
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Get all calibrations error:', err);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Reload calibration cache from database
app.post('/api/calibrations/reload', async (req, res) => {
  try {
    await loadCalibrationOffsets();
    res.json({ success: true, message: 'Calibration cache reloaded', cache: calibrationCache });
  } catch (err) {
    console.error('Reload calibrations error:', err);
    res.status(500).json({ success: false, message: 'Failed to reload calibrations' });
  }
});

// Debug endpoint to see current calibration cache
app.get('/api/calibrations/cache', (req, res) => {
  res.json({ success: true, cache: calibrationCache });
});

io.on('connection', (socket) => {
  console.log('Web Client connected', socket.id, 'clients:', io.sockets.sockets.size);
  socket.on('disconnect', () => {
    console.log('Web Client disconnected', socket.id, 'clients:', io.sockets.sockets.size);
  });

  // Listen for polling data from atg_poller (primary source for UI)
  socket.on('polling-data', async (data) => {
    console.log('Received polling data:', data.topic);
    
    try {
      const topic = data.topic;
      const payload = data.payload;

      // Apply same processing as MQTT messages
      if (payload.Product !== undefined) {
        const tankId = topic;
        
        // Get calibration offsets
        const offsets = calibrationCache[tankId] || { product: 0, water: 0 };

        // Store RAW values in database
        const rawProduct = parseFloat(payload.Product) || 0;
        const rawWater = parseFloat(payload.Water) || 0;

        // Apply calibration offsets for display
        const calibratedProduct = Math.max(0, rawProduct - offsets.product);
        const calibratedWater = Math.max(0, rawWater - offsets.water);

        // Calculate volume
        const volume = getVolume(tankId, rawProduct);

        // Store in DB
        try {
          const timestamp = payload.Timestamp ? new Date(payload.Timestamp) : new Date();
          const productType = payload.ProductType || 'Diesel';

          await pool.query(
            `INSERT INTO sensor_data (time, tank_id, product_mm, water_mm, volume_l, temp_c, status, product_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              timestamp,
              tankId,
              rawProduct,
              rawWater,
              volume,
              payload.Temp || 0,
              payload.Status || '0',
              productType
            ]
          );
        } catch (dbErr) {
          console.error('DB Insert Error:', dbErr.message);
        }

        // Send calibrated values to UI
        const uiPayload = {
          ...payload,
          Product: calibratedProduct,
          Water: calibratedWater,
          Volume: volume
        };

        // Broadcast polling data to all web clients (UI source of truth)
        io.emit('polling-data', {
          topic: topic,
          payload: uiPayload,
          timestamp: data.timestamp || new Date().toISOString()
        });

        console.log('Broadcasted polling data to UI:', topic, 'clients:', io.sockets.sockets.size);
      }
    } catch (e) {
      console.error('Error processing polling data:', e.message);
    }
  });
})

httpServer.listen(HTTP_PORT, () => {
  console.log(`Web UI running at http://localhost:${HTTP_PORT}`)
})





// --- MQTT Client Setup ---
if (ENABLE_MQTT) {
  console.log(`Connecting to MQTT Broker at ${MQTT_BROKER_URL}...`);
  const mqttClient = mqtt.connect(MQTT_BROKER_URL);

  mqttClient.on('connect', () => {
    console.log('Connected to EMQX Broker');
    // Subscribe to '+' to catch flat topics like ATG83729
    mqttClient.subscribe('+', (err) => {
      if (!err) console.log('Subscribed to + (Root Single Level)');
      else console.error('Subscription error:', err);
    });
  });

  mqttClient.on('message', async (topic, message) => {
    const payloadStr = message.toString();
    // Debug log
    console.log(`Received message on ${topic}: ${payloadStr.substring(0, 50)}...`);

    try {
      let data = JSON.parse(payloadStr);

      // Process Data
      if (data.Product !== undefined) {
        // FIX: Use MQTT Topic as the unique ID to prevent overlap
        const tankId = topic;

        // Get calibration offsets
        const offsets = calibrationCache[tankId] || { product: 0, water: 0 };

        // Store RAW values in database (before calibration)
        const rawProduct = parseFloat(data.Product) || 0;
        const rawWater = parseFloat(data.Water) || 0;

        // Apply calibration offsets for display
        const calibratedProduct = Math.max(0, rawProduct - offsets.product);
        const calibratedWater = Math.max(0, rawWater - offsets.water);

        // Debug: log calibration being applied
        if (offsets.product !== 0 || offsets.water !== 0) {
          console.log(`[CALIBRATION] Tank ${tankId}: Raw P=${rawProduct}, W=${rawWater} | Offset P=${offsets.product}, W=${offsets.water} | Calibrated P=${calibratedProduct}, W=${calibratedWater}`);
        }

        // Calculate volume using calibrated product level
        const volume = getVolume(tankId, rawProduct); // getVolume already applies offset internally

        // Store in DB (store RAW values for historical accuracy)
        try {
          const timestamp = data.Timestamp ? new Date(data.Timestamp) : new Date();
          const productType = data.ProductType || 'Diesel';

          await pool.query(
            `INSERT INTO sensor_data (time, tank_id, product_mm, water_mm, volume_l, temp_c, status, product_type)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              timestamp,
              tankId,
              rawProduct,      // Store raw value
              rawWater,        // Store raw value
              volume,          // Store calibrated volume
              data.Temp || 0,
              data.Status || '0',
              productType
            ]
          );
        } catch (dbErr) {
          console.error('DB Insert Error:', dbErr.message);
        }

        // Send CALIBRATED values to UI
        data.Product = calibratedProduct;  // Calibrated product level
        data.Water = calibratedWater;      // Calibrated water level
        data.Volume = volume;              // Volume (already calibrated)

        // Broadcast to Web UI
        io.emit('mqtt_message', {
          topic: topic,
          payload: data,
          timestamp: new Date().toISOString()
        });
      }

    } catch (e) {
      // Not JSON or error processing
    }
  });
} else {
  console.log('MQTT disabled (set ENABLE_MQTT=true to enable)');
}
