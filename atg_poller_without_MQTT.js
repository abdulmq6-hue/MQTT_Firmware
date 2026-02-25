// Node.js ATG poller - polls ATG devices over serial and prints parsed results
// Usage: node atg_poller.js [COM_PORT] [BAUD]

const { SerialPort } = require('serialport');

const DELAY_BW_PACKET = 700; // ms
const COMMAND_HEADER = 'M';
const ADDRESSES = ['83731'];

const portPath = process.argv[2] || process.env.COMPORT || 'COM7';
const baudRate = parseInt(process.argv[3], 10) || parseInt(process.env.BAUD, 10) || 9600;
 n
let lastIndex = ADDRESSES.length - 1;
let recvBuffer = '';

const port = new SerialPort({ path: portPath, baudRate: baudRate, autoOpen: false });

function buildPacket(address) {
  return COMMAND_HEADER + address + '\r\n';
}

function getNextIndex() {
  if (lastIndex === (ADDRESSES.length - 1)) return 0;
  return lastIndex + 1;
}

function sendNext() {
  lastIndex = getNextIndex();
  const packet = buildPacket(ADDRESSES[lastIndex]);
  port.write(packet, (err) => {
    if (err) console.error('Write error:', err.message);
    else process.stdout.write('S:' + packet);
  });
}

function parseAndPrint(line) {
  // Remove optional R: prefix
  const start = line.startsWith('R:') ? line.slice(2) : line;
  // Regex based on C parser: address N status =+ tempRaw = product = water = checksum
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
  const checksum = parseInt(m[6], 10);

  console.log('Address:', address);
  console.log('Status:', status, '-', status === 0 ? 'OK' : 'Measurement Error');
  console.log('Temperature:', temperature.toFixed(1), 'C');
  console.log('Product:', product.toFixed(1), 'mm');
  console.log('Water:', water, 'mm');
  // console.log('Checksum:', checksum);
  console.log('');
}

port.on('error', (err) => console.error('Serial port error:', err.message));

port.on('data', (data) => {
  recvBuffer += data.toString('utf8');
  if (recvBuffer.includes('\r') || recvBuffer.includes('\n')) {
    const parts = recvBuffer.split(/\r\n|\r|\n/);
    // Process all complete lines (last element may be incomplete)
    for (let i = 0; i < parts.length - 1; i++) {
      const line = parts[i].trim();
      if (line.length) parseAndPrint(line);
    }
    recvBuffer = parts[parts.length - 1];
  }
});

port.open((err) => {
  if (err) {
    console.error('Failed to open port', portPath, 'baud', baudRate, err.message);
    process.exit(1);
  }
  console.log('Port opened', portPath, 'baud', baudRate);
  // Send immediately then periodically
  sendNext();
  setInterval(sendNext, DELAY_BW_PACKET);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nClosing serial port...');
  try { port.close(); } catch (e) {}
  process.exit(0);
});
