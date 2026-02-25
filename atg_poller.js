// Node.js ATG poller
// Polls ATG devices over serial and publishes data to MQTT
// Usage: node atg_poller.js [COM_PORT] [BAUD]

const { SerialPort } = require('serialport');
const mqtt = require('mqtt');

// ---------------- CONFIG ----------------
const DELAY_BW_PACKET = 700; // ms
const COMMAND_HEADER = 'M';
const ADDRESSES = ['83731','83730'];

const portPath = process.argv[2] || process.env.COMPORT || 'COM7';
const baudRate = parseInt(process.argv[3], 10) || 9600;

// MQTT (matches previous simulator/UI)
const MQTT_URL = 'mqtt://127.0.0.1:1883';
const MQTT_CLIENT_ID = 'ATG_Publisher';

// FLAG: Control MQTT publishing via environment variable.
// Set ENABLE_MQTT=true to publish to MQTT broker, otherwise polling data is sent to the UI only.
const ENABLE_MQTT = process.env.ENABLE_MQTT === 'true';

// ----------------------------------------

let lastIndex = ADDRESSES.length - 1;
let recvBuffer = '';
let ioClient = null;
let pendingData = []; // Buffer for data until Socket.io connects
let isConnected = false;

// ---------- INITIALIZE SOCKET.IO CLIENT (FOR POLLING DATA) ----------
const socketIOClient = require('socket.io-client');
const MAIN_SERVER_URL = 'http://localhost:3000';

ioClient = socketIOClient(MAIN_SERVER_URL);

ioClient.on('connect', () => {
  isConnected = true;
  console.log('Connected to main server for polling data at', MAIN_SERVER_URL);
  
  // Send any buffered data
  while (pendingData.length > 0) {
    const data = pendingData.shift();
    ioClient.emit('polling-data', data);
    console.log('Sent buffered polling data:', data.topic);
  }
});

ioClient.on('error', (err) => {
  console.error('Socket.io connection error:', err);
});

ioClient.on('disconnect', () => {
  isConnected = false;
  console.log('Disconnected from main server');
});

// ---------- MQTT INIT (CONDITIONAL - FOR PUBLISHING ONLY) ----------
let mqttClient = null;

if (ENABLE_MQTT) {
  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: MQTT_CLIENT_ID,
    clean: true,
    keepalive: 60
  });

  mqttClient.on('connect', () => {
    console.log('Connected to MQTT broker at', MQTT_URL);
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT error:', err.message);
  });
}

// ---------- SERIAL INIT ----------
const port = new SerialPort({
  path: portPath,
  baudRate: baudRate,
  autoOpen: false
});

function buildPacket(address) {
  return COMMAND_HEADER + address + '\r\n';
}

function getNextIndex() {
  if (lastIndex === ADDRESSES.length - 1) return 0;
  return lastIndex + 1;
}

function sendNext() {
  lastIndex = getNextIndex();
  const packet = buildPacket(ADDRESSES[lastIndex]);

  port.write(packet, (err) => {
    if (err) {
      console.error('Write error:', err.message);
    } else {
      process.stdout.write('S:' + packet);
    }
  });
}

// ---------- PARSER + MQTT PUBLISH / UI SEND ----------
function parseAndPrint(line) {
  const start = line.startsWith('R:') ? line.slice(2) : line;

  // ATG response parser
  const re = /(\d+)N(\d)=\+?([+-]?\d+)=([+-]?\d+(?:\.\d+)?)=([^=]+)=(\d+)/;
  const m = start.match(re);

  if (!m) {
    console.log('Unparsed response:', line);
    return;
  }

  const address = parseInt(m[1], 10);
  const status = parseInt(m[2], 10);
  const tempRaw = parseInt(m[3], 10);
  const temperature = tempRaw / 10.0;
  const product = parseFloat(m[4]);
  const water = Math.floor(parseFloat(m[5]));

  // ---------- EXACT PAYLOAD (UI COMPATIBLE) ----------
  const topic = 'ATG' + address;

  const payload = {
    Address: address.toString(),   // STRING (important)
    req_type: 0,
    Status: status.toString(),     // STRING (important)
    Temp: temperature,
    Product: product,
    Water: water
  };

  // Console (optional)
  console.log(payload);

  // ALWAYS send polling data to main server (UI source of truth)
  const dataPacket = {
    topic: topic,
    payload: payload,
    timestamp: new Date().toISOString()
  };

  if (isConnected) {
    ioClient.emit('polling-data', dataPacket);
    console.log('Sent polling data to UI:', topic);
  } else {
    // Buffer data if not connected yet
    pendingData.push(dataPacket);
    console.log('Buffered polling data (waiting for connection):', topic);
  }

  // OPTIONALLY also publish to MQTT (if enabled)
  if (ENABLE_MQTT) {
    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
      console.log('Published to MQTT broker:', topic);
    }
  }
}

// ---------- SERIAL EVENTS ----------
port.on('error', (err) => {
  console.error('Serial port error:', err.message);
});

port.on('data', (data) => {
  recvBuffer += data.toString('utf8');

  if (recvBuffer.includes('\r') || recvBuffer.includes('\n')) {
    const parts = recvBuffer.split(/\r\n|\r|\n/);

    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i].trim();
      if (line.length) parseAndPrint(line);
    }

    recvBuffer = parts[parts.length - 1];
  }
});

// ---------- START ----------
port.open((err) => {
  if (err) {
    console.error('Failed to open port', portPath, 'baud', baudRate, err.message);
    process.exit(1);
  }

  console.log('Port opened', portPath, 'baud', baudRate);

  // Give Socket.io time to connect before starting polling
  const startPollingDelay = ENABLE_MQTT ? 100 : 2000; // Longer wait if MQTT disabled (only polling)
  console.log(`Waiting ${startPollingDelay}ms for Socket.io connection before polling...`);
  
  setTimeout(() => {
    sendNext();
    setInterval(sendNext, DELAY_BW_PACKET);
  }, startPollingDelay);
});

// ---------- GRACEFUL SHUTDOWN ----------
process.on('SIGINT', () => {
  console.log('\nClosing serial port...');
  try { port.close(); } catch (e) {}
  try { mqttClient.end(); } catch (e) {}
  process.exit(0);
});
