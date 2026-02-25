const mqtt = require("mqtt");
const net = require("net");

// ========================================
// SIMULATOR ENABLE/DISABLE
// ========================================
const SIMULATOR_ENABLED = true;
// ========================================

// MQTT Server Configuration
const BROKER_IP = "y6e66ccc.ala.dedicated.aws.emqxcloud.com";
const BROKER_PORT = 1883;
const USERNAME = "admin";
const PASSWORD = "admin";
const TOPIC = "ATG83724";
const PUBLISH_INTERVAL = 2000; // milliseconds
const CONNECTION_TIMEOUT = 5000; // ms
const MAX_RETRIES = 3;

// Data template
let data = {
  Address: "8372",
  req_type: 0,
  Status: "0",
  Temp: 25.13,
  Product: 1234.12,
  Water: 12.98,
};

let messageCount = 0;
let publishInterval;

// ========================================
// Network Connectivity Test
// ========================================
function testNetworkConnection(host, port, timeout = 5000) {
  return new Promise((resolve) => {
    console.log(`Testing network connectivity to ${host}:${port}...`);

    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on("connect", () => {
      console.log("Network connection successful!");
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      console.log(`Connection timeout after ${timeout} ms`);
      socket.destroy();
      resolve(false);
    });

    socket.on("error", (err) => {
      console.log(`Cannot reach the server: ${err.message}`);
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

// ========================================
// Main Function
// ========================================
async function main() {
  if (!SIMULATOR_ENABLED) {
    console.log("==================================================");
    console.log("ATG83729 Simulator is DISABLED.");
    console.log("Set SIMULATOR_ENABLED = true to enable.");
    console.log("==================================================");
    process.exit(0);
  }

  const networkOk = await testNetworkConnection(
    BROKER_IP,
    BROKER_PORT,
    CONNECTION_TIMEOUT
  );

  if (!networkOk) {
    console.log("\nFailed to establish network connection to MQTT broker.");
    process.exit(1);
  }

  console.log("\n==================================================");

  console.log(
    `Connecting to MQTT broker at ${BROKER_IP}:${BROKER_PORT}...`
  );

  const client = mqtt.connect(`mqtt://${BROKER_IP}:${BROKER_PORT}`, {
    username: USERNAME,
    password: PASSWORD,
    clean: true,
    reconnectPeriod: 0, // disable auto reconnect
  });

  // ========================================
  // MQTT Event Handlers
  // ========================================

  client.on("connect", () => {
    console.log(
      `Connected successfully to MQTT broker at ${BROKER_IP}:${BROKER_PORT}`
    );
    console.log(`Publishing to topic: ${TOPIC}`);
    console.log("--------------------------------------------------");

    publishInterval = setInterval(() => {
      messageCount++;

      data.Temp = Number((Math.random() * (40 - 20) + 20).toFixed(2));
      data.Product = Number((Math.random() * (45000 - 500) + 500).toFixed(2));
      data.Water = Number((Math.random() * 20000).toFixed(2));

      const jsonData = JSON.stringify(data);

      client.publish(TOPIC, jsonData, { qos: 1 }, (err) => {
        if (!err) {
          console.log(
            `[${messageCount}] Published at ${new Date().toISOString()}`
          );
          console.log(`    Data: ${jsonData}`);
        } else {
          console.log(
            `[${messageCount}] Failed to publish message: ${err.message}`
          );
        }
      });
    }, PUBLISH_INTERVAL);
  });

  client.on("error", (err) => {
    console.log(`Connection failed: ${err.message}`);
    process.exit(1);
  });

  client.on("close", () => {
    console.log("Disconnected from MQTT broker");
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n--------------------------------------------------");
    console.log(`Stopped by user. Total messages sent: ${messageCount}`);

    clearInterval(publishInterval);

    client.end(false, () => {
      console.log("Disconnected cleanly");
      process.exit(0);
    });
  });
}

main();