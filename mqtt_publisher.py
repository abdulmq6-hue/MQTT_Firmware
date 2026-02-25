import paho.mqtt.client as mqtt
import json
import time
import sys
import socket

# ========================================
# SIMULATOR ENABLE/DISABLE
# ========================================
# Set to True to enable fake data publishing
# Set to False to disable (default)
SIMULATOR_ENABLED = False
# ========================================

# MQTT Server Configuration
#BROKER_IP = "72.255.62.111"
#BROKER_IP = "192.168.137.158"
BROKER_IP = "127.0.0.1"
BROKER_PORT = 1883
USERNAME = "duc"
PASSWORD = "SRT123"
TOPIC = "ATG83729"
PUBLISH_INTERVAL = 2  # seconds
CONNECTION_TIMEOUT = 30  # seconds
MAX_RETRIES = 3

# Data to publish
data = {
    "Address": "83729",
    "req_type": 0,
    "Status": "0",
    "Temp": 25.13,
    "Product": 1234.12,
    "Water": 12.98
}

def test_network_connection(host, port, timeout=5):
    """Test if we can reach the MQTT broker"""
    print(f"Testing network connectivity to {host}:{port}...")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()

        if result == 0:
            print("Network connection successful!")
            return True
        else:
            print(f"Cannot reach the server (Error code: {result})")
            print("Possible issues:")
            print("  - MQTT broker is not running")
            print("  - Firewall is blocking the connection")
            print("  - Incorrect IP address or port")
            print("  - Network connectivity issues")
            return False
    except socket.gaierror:
        print(f"Hostname resolution failed for {host}")
        return False
    except socket.timeout:
        print(f"Connection timeout after {timeout} seconds")
        return False
    except Exception as e:
        print(f"Network test error: {e}")
        return False

def on_connect(client, userdata, flags, rc, properties=None):
    """Callback when connected to MQTT broker"""
    if rc == 0:
        print(f"Connected successfully to MQTT broker at {BROKER_IP}:{BROKER_PORT}")
        print(f"Publishing to topic: {TOPIC}")
        print("-" * 50)
    else:
        print(f"Connection failed with code {rc}")
        sys.exit(1)

def on_publish(client, userdata, mid, properties=None, reason_code=None):
    """Callback when message is published"""
    print(f"Message published successfully (ID: {mid})")

def on_disconnect(client, userdata, rc, properties=None):
    """Callback when disconnected from broker"""
    if rc != 0:
        print(f"Unexpected disconnection. Code: {rc}")

def main():
    # Check if simulator is enabled
    if not SIMULATOR_ENABLED:
        print("=" * 50)
        print("ATG83729 Simulator is DISABLED by default.")
        print("To enable, set SIMULATOR_ENABLED = True in mqtt_publisher.py")
        print("=" * 50)
        sys.exit(0)

    # Test network connectivity first
    if not test_network_connection(BROKER_IP, BROKER_PORT):
        print("\nFailed to establish network connection to MQTT broker.")
        print("Please check:")
        print("  1. Is the MQTT broker IP address correct?")
        print("  2. Is the MQTT broker running?")
        print("  3. Can you ping the broker? Try: ping 72.255.62.111")
        print("  4. Is port 1883 open on the broker?")
        sys.exit(1)

    print("\n" + "=" * 50)

    # Create MQTT client instance with callback API version 2
    client = mqtt.Client(
        client_id="ATG_Publisher",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        clean_session=True
    )

    # Set username and password
    client.username_pw_set(USERNAME, PASSWORD)

    # Assign callbacks
    client.on_connect = on_connect
    client.on_publish = on_publish
    client.on_disconnect = on_disconnect

    try:
        # Connect to broker
        print(f"Connecting to MQTT broker at {BROKER_IP}:{BROKER_PORT}...")
        client.connect(BROKER_IP, BROKER_PORT, keepalive=60)

        # Start network loop in background
        client.loop_start()

        # Wait a moment for connection to establish
        time.sleep(1)

        # Publish data every 2 seconds
        message_count = 0
        while True:
            message_count += 1
            json_data = json.dumps(data)

            # Publish message
            result = client.publish(TOPIC, json_data, qos=1)

            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                print(f"[{message_count}] Published at {time.strftime('%Y-%m-%d %H:%M:%S')}")
                print(f"    Data: {json_data}")
            else:
                print(f"[{message_count}] Failed to publish message. Error code: {result.rc}")

            # Wait for specified interval
            time.sleep(PUBLISH_INTERVAL)

    except KeyboardInterrupt:
        print("\n" + "-" * 50)
        print(f"Stopped by user. Total messages sent: {message_count}")

    except Exception as e:
        print(f"Error occurred: {e}")

    finally:
        # Cleanup
        client.loop_stop()
        client.disconnect()
        print("Disconnected from MQTT broker")

if __name__ == "__main__":
    main()
