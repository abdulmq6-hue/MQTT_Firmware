// Simple test poll sender
// Emits `polling-data` events to the main server (Socket.IO) to simulate ATG poll responses.

const { io } = require('socket.io-client');

const MAIN_SERVER = process.env.MAIN_SERVER_URL || 'http://localhost:3000';
const ADDRESSES = (process.env.ADDRESSES || 'ATG83731,ATG83730').split(',').map(s => s.trim());
const INTERVAL = parseInt(process.env.INTERVAL || '2000', 10);
const RANDOM = (process.env.RANDOM || 'true') === 'true';

const socket = io(MAIN_SERVER);

socket.on('connect', () => {
  console.log('Connected to', MAIN_SERVER);
});

socket.on('disconnect', () => {
  console.log('Disconnected from', MAIN_SERVER);
});

function randomFloat(min, max, dp = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}

function buildPayload(address) {
  // address is like 'ATG83731'
  const product = RANDOM ? randomFloat(200, 1200, 2) : 500; // mm
  const water = RANDOM ? Math.floor(randomFloat(0, 80, 0)) : 5; // mm
  const temp = RANDOM ? randomFloat(18, 35, 1) : 25.0; // °C
  const status = '0';

  return {
    Address: address.replace(/^ATG/i, ''),
    req_type: 0,
    Status: status,
    Temp: temp,
    Product: product,
    Water: water,
    ProductType: 'HSD'
  };
}

function sendOnce() {
  const now = new Date().toISOString();
  ADDRESSES.forEach(addr => {
    const payload = buildPayload(addr);
    const packet = {
      topic: addr,
      payload: payload,
      timestamp: now
    };

    socket.emit('polling-data', packet);
    console.log('Sent', addr, JSON.stringify(payload));
  });
}

// Send immediately, then on interval
socket.on('connect', () => {
  sendOnce();
  const id = setInterval(() => {
    if (socket.connected) sendOnce();
    else clearInterval(id);
  }, INTERVAL);
});

process.on('SIGINT', () => {
  console.log('\nShutting down test sender...');
  try { socket.disconnect(); } catch (e) {}
  process.exit(0);
});

// If run directly, print usage info
if (require.main === module) {
  console.log('Test poll sender running with:');
  console.log('  MAIN_SERVER_URL=', MAIN_SERVER);
  console.log('  ADDRESSES=', ADDRESSES.join(','));
  console.log('  INTERVAL=', INTERVAL, 'ms');
  console.log('  RANDOM=', RANDOM);
}
