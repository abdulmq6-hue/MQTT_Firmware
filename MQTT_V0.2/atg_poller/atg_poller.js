// Node.js ATG poller
// Polls ATG devices over serial and publishes data to MQTT
// Usage: node atg_poller.js [COM_PORT] [BAUD]

const { SerialPort } = require('serialport');
const mqtt = require('mqtt');

// ---------------- CONFIG ----------------
const DELAY_BW_PACKET = 700; // ms
const COMMAND_HEADER = 'M';
const ADDRESSES = ['83731'];

const portPath = process.argv[2] || process.env.COMPORT || 'COM7';
const baudRate = parseInt(process.argv[3], 10) || 9600;

// MQTT (matches previous simulator/UI)
const MQTT_URL = 'mqtt://127.0.0.1:1883';
const MQTT_CLIENT_ID = 'ATG_Publisher';

// ----------------------------------------

let lastIndex = ADDRESSES.length - 1;
let recvBuffer = '';

// ---------- MQTT INIT (OLD BEHAVIOR) ----------
const mqttClient = mqtt.connect(MQTT_URL, {
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

// ---------- PARSER + MQTT PUBLISH ----------
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

  // MQTT publish (same as before)
  if (mqttClient.connected) {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
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

  sendNext();
  setInterval(sendNext, DELAY_BW_PACKET);
});

// ---------- GRACEFUL SHUTDOWN ----------
process.on('SIGINT', () => {
  console.log('\nClosing serial port...');
  try { port.close(); } catch (e) {}
  try { mqttClient.end(); } catch (e) {}
  process.exit(0);
});
