"""
ATG Simulator Web Server with MQTT Integration
Stingray Technologies

This server provides:
1. Web UI hosting for the ATG Simulator
2. REST API for configuration and control
3. Multiple ATG support with individual topics
4. MQTT publishing to configured broker
"""

import http.server
import socketserver
import json
import threading
import time
import socket
import os
import sys
from urllib.parse import urlparse, parse_qs
import random
import uuid

# Try to import paho-mqtt
try:
    import paho.mqtt.client as mqtt
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False
    print("Warning: paho-mqtt not installed. MQTT publishing disabled.")
    print("Install with: pip install paho-mqtt")

# Global MQTT Configuration
DEFAULT_MQTT_CONFIG = {
#    "broker_ip": "192.168.137.158",
    "broker_ip": "127.0.0.1",
    "broker_port": 1883,
    "username": "duc",
    "password": "SRT123",
    "qos": 1,
    "keep_alive": 60,
    "clean_session": True,
    "auto_reconnect": True
}

# Default ATG template
DEFAULT_ATG_TEMPLATE = {
    "name": "ATG",
    "address": "83729",
    "topic": "ATG/83729",
    "publish_interval": 2,
    "product_type": "Diesel",
    "enabled": True,
    "sensor_data": {
        "Address": "83729",
        "req_type": 0,
        "Status": "0",
        "Temp": 25.13,
        "Product": 1230.00,
        "Water": 12.98
    },
    "auto_variation": False,
    "temp_variance": 0.5,
    "product_variance": 2.0,
    "water_variance": 0.5,
    "simulate_trend": False,
    "consumption_rate": 0.5
}

# Global state
mqtt_config = DEFAULT_MQTT_CONFIG.copy()
atg_list = {}  # Dictionary of ATGs by ID
mqtt_client = None
mqtt_connected = False
simulation_running = False
simulation_thread = None
total_message_count = 0
total_error_count = 0
history_data = []
state_lock = threading.Lock()


def generate_atg_id():
    """Generate a unique ATG ID"""
    return str(uuid.uuid4())[:8]


def create_default_atg(atg_id=None, address=None, name=None):
    """Create a new ATG with default values"""
    if atg_id is None:
        atg_id = generate_atg_id()

    atg = DEFAULT_ATG_TEMPLATE.copy()
    atg["sensor_data"] = DEFAULT_ATG_TEMPLATE["sensor_data"].copy()
    atg["id"] = atg_id
    atg["message_count"] = 0
    atg["error_count"] = 0
    atg["last_publish"] = None

    if address:
        atg["address"] = address
        atg["sensor_data"]["Address"] = address
        atg["topic"] = f"ATG/{address}"

    if name:
        atg["name"] = name
    else:
        atg["name"] = f"ATG-{address or atg_id}"

    return atg


def test_network_connection(host, port, timeout=5):
    """Test if we can reach the MQTT broker"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def on_connect(client, userdata, flags, rc, properties=None):
    """MQTT connection callback"""
    global mqtt_connected
    if rc == 0:
        mqtt_connected = True
        print(f"[{time.strftime('%H:%M:%S')}] Connected to MQTT broker at {mqtt_config['broker_ip']}:{mqtt_config['broker_port']}")
    else:
        mqtt_connected = False
        error_messages = {
            1: "Incorrect protocol version",
            2: "Invalid client identifier",
            3: "Server unavailable",
            4: "Bad username or password",
            5: "Not authorized"
        }
        error_msg = error_messages.get(rc, f"Unknown error code {rc}")
        print(f"[{time.strftime('%H:%M:%S')}] MQTT connection failed: {error_msg}")


def on_disconnect(client, userdata, disconnect_flags, reason_code, properties=None):
    """MQTT disconnection callback"""
    global mqtt_connected, simulation_running
    mqtt_connected = False

    # Only log unexpected disconnections (not when we intentionally disconnect)
    if simulation_running and reason_code != 0:
        print(f"[{time.strftime('%H:%M:%S')}] MQTT disconnected (Code: {reason_code}). Will attempt to reconnect...")


def on_publish(client, userdata, mid, properties=None, reason_code=None):
    """MQTT publish callback"""
    pass


def connect_mqtt():
    """Connect to MQTT broker"""
    global mqtt_client, mqtt_connected

    if not MQTT_AVAILABLE:
        return False

    try:
        mqtt_client = mqtt.Client(
            client_id=f"ATG_Simulator_{generate_atg_id()}",
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            clean_session=mqtt_config['clean_session']
        )

        mqtt_client.username_pw_set(mqtt_config['username'], mqtt_config['password'])
        mqtt_client.on_connect = on_connect
        mqtt_client.on_disconnect = on_disconnect
        mqtt_client.on_publish = on_publish

        # Enable auto-reconnect
        mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)

        mqtt_client.connect(
            mqtt_config['broker_ip'],
            mqtt_config['broker_port'],
            keepalive=mqtt_config['keep_alive']
        )
        mqtt_client.loop_start()
        time.sleep(1)  # Wait for connection
        return mqtt_connected
    except Exception as e:
        print(f"[{time.strftime('%H:%M:%S')}] MQTT connection error: {e}")
        return False


def disconnect_mqtt():
    """Disconnect from MQTT broker"""
    global mqtt_client, mqtt_connected

    if mqtt_client:
        try:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
        except Exception as e:
            print(f"[{time.strftime('%H:%M:%S')}] Disconnect warning: {e}")
        finally:
            mqtt_client = None
    mqtt_connected = False


def publish_atg_data(atg):
    """Publish data for a single ATG"""
    global total_message_count, total_error_count, history_data

    if not atg.get("enabled", True):
        return False

    if mqtt_client is None:
        return False

    # Check if connected, if not, the auto-reconnect should handle it
    if not mqtt_connected:
        return False

    try:
        # Create payload with Timestamp and ProductType
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        payload_data = {
            **atg["sensor_data"],
            "Timestamp": timestamp,
            "ProductType": atg.get("product_type", "Diesel")
        }
        payload = json.dumps(payload_data)
        result = mqtt_client.publish(
            atg["topic"],
            payload,
            qos=mqtt_config['qos']
        )
        if result.rc == 0:
            with state_lock:
                atg["message_count"] = atg.get("message_count", 0) + 1
                atg["last_publish"] = timestamp
                total_message_count += 1

                # Add to history
                history_entry = {
                    "id": total_message_count,
                    "atg_id": atg["id"],
                    "atg_name": atg["name"],
                    "topic": atg["topic"],
                    "timestamp": timestamp,
                    "product_type": atg.get("product_type", "Diesel"),
                    **atg["sensor_data"]
                }
                history_data.append(history_entry)
                if len(history_data) > 1000:
                    history_data.pop(0)

            print(f"[{time.strftime('%H:%M:%S')}] [{atg['name']}] Published to {atg['topic']}: T={atg['sensor_data']['Temp']:.2f}C, P={atg['sensor_data']['Product']:.2f}mm, W={atg['sensor_data']['Water']:.2f}mm, Type={atg.get('product_type', 'Diesel')}, Timestamp={timestamp}")
            return True
        else:
            with state_lock:
                atg["error_count"] = atg.get("error_count", 0) + 1
                total_error_count += 1
            print(f"[{time.strftime('%H:%M:%S')}] [{atg['name']}] Publish failed with code: {result.rc}")
            return False
    except Exception as e:
        with state_lock:
            atg["error_count"] = atg.get("error_count", 0) + 1
            total_error_count += 1
        print(f"[{time.strftime('%H:%M:%S')}] [{atg['name']}] Publish error: {e}")
        return False


def apply_variation(atg):
    """Apply auto-variation to sensor data"""
    if not atg.get("auto_variation", False):
        return

    sensor = atg["sensor_data"]

    temp_var = atg.get("temp_variance", 0.5)
    product_var = atg.get("product_variance", 2.0)
    water_var = atg.get("water_variance", 0.5)

    sensor["Temp"] += (random.random() - 0.5) * 2 * temp_var
    sensor["Product"] += (random.random() - 0.5) * 2 * product_var
    sensor["Water"] += (random.random() - 0.5) * 2 * water_var

    # Clamp values
    sensor["Temp"] = max(-20, min(60, sensor["Temp"]))
    sensor["Product"] = max(0, min(3000, sensor["Product"]))
    sensor["Water"] = max(0, min(100, sensor["Water"]))


def apply_consumption(atg, elapsed_time):
    """Apply consumption trend to product level"""
    if not atg.get("simulate_trend", False):
        return

    rate = atg.get("consumption_rate", 0.5)
    atg["sensor_data"]["Product"] -= (rate / 60) * elapsed_time
    atg["sensor_data"]["Product"] = max(0, atg["sensor_data"]["Product"])


def simulation_loop():
    """Main simulation loop for all ATGs"""
    global simulation_running

    last_publish_times = {}

    while simulation_running:
        current_time = time.time()

        with state_lock:
            atgs_to_process = list(atg_list.values())

        for atg in atgs_to_process:
            if not atg.get("enabled", True):
                continue

            atg_id = atg["id"]
            interval = atg.get("publish_interval", 2)
            last_time = last_publish_times.get(atg_id, 0)

            if current_time - last_time >= interval:
                # Apply variations
                apply_variation(atg)
                apply_consumption(atg, interval)

                # Publish
                publish_atg_data(atg)
                last_publish_times[atg_id] = current_time

        time.sleep(0.1)  # Small sleep to prevent CPU spinning


def start_simulation():
    """Start the simulation for all ATGs"""
    global simulation_running, simulation_thread, total_message_count, total_error_count

    if simulation_running:
        return {"success": False, "message": "Simulation already running"}

    if len(atg_list) == 0:
        return {"success": False, "message": "No ATGs configured. Add at least one ATG first."}

    print(f"\n[{time.strftime('%H:%M:%S')}] Starting simulation...")
    print(f"[{time.strftime('%H:%M:%S')}] Broker: {mqtt_config['broker_ip']}:{mqtt_config['broker_port']}")
    print(f"[{time.strftime('%H:%M:%S')}] ATGs configured: {len(atg_list)}")

    for atg in atg_list.values():
        print(f"[{time.strftime('%H:%M:%S')}]   - {atg['name']}: Topic={atg['topic']}, Interval={atg['publish_interval']}s")

    # Connect to MQTT
    if MQTT_AVAILABLE:
        print(f"[{time.strftime('%H:%M:%S')}] Connecting to MQTT broker...")
        if not connect_mqtt():
            print(f"[{time.strftime('%H:%M:%S')}] ERROR: Failed to connect to MQTT broker")
            return {"success": False, "message": "Failed to connect to MQTT broker. Check if broker is running and credentials are correct."}
        print(f"[{time.strftime('%H:%M:%S')}] MQTT connected successfully!")
    else:
        print(f"[{time.strftime('%H:%M:%S')}] WARNING: MQTT not available - install paho-mqtt")
        return {"success": False, "message": "MQTT library not installed. Run: pip install paho-mqtt"}

    # Reset counters
    total_message_count = 0
    total_error_count = 0
    for atg in atg_list.values():
        atg["message_count"] = 0
        atg["error_count"] = 0

    simulation_running = True
    simulation_thread = threading.Thread(target=simulation_loop, daemon=True)
    simulation_thread.start()

    print(f"[{time.strftime('%H:%M:%S')}] Simulation started for {len(atg_list)} ATG(s)")
    return {"success": True, "message": f"Simulation started for {len(atg_list)} ATG(s)"}


def stop_simulation():
    """Stop the simulation"""
    global simulation_running

    simulation_running = False
    disconnect_mqtt()

    print(f"[{time.strftime('%H:%M:%S')}] Simulation stopped. Total messages sent: {total_message_count}")
    return {"success": True, "message": f"Simulation stopped. Messages sent: {total_message_count}"}


class ATGRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP request handler with API endpoints"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(os.path.abspath(__file__)), **kwargs)

    def do_GET(self):
        """Handle GET requests"""
        parsed = urlparse(self.path)

        if parsed.path == '/':
            self.send_response(302)
            self.send_header('Location', '/atg_simulator.html')
            self.end_headers()

        elif parsed.path == '/api/status':
            with state_lock:
                self.send_json_response({
                    "simulation_running": simulation_running,
                    "mqtt_connected": mqtt_connected,
                    "total_message_count": total_message_count,
                    "total_error_count": total_error_count,
                    "atg_count": len(atg_list),
                    "atg_list": list(atg_list.values()),
                    "mqtt_config": mqtt_config
                })

        elif parsed.path == '/api/mqtt-config':
            self.send_json_response(mqtt_config)

        elif parsed.path == '/api/atgs':
            with state_lock:
                self.send_json_response(list(atg_list.values()))

        elif parsed.path.startswith('/api/atg/'):
            atg_id = parsed.path.split('/')[-1]
            with state_lock:
                if atg_id in atg_list:
                    self.send_json_response(atg_list[atg_id])
                else:
                    self.send_json_response({"error": "ATG not found"}, 404)

        elif parsed.path == '/api/history':
            with state_lock:
                self.send_json_response(history_data[-100:])

        elif parsed.path == '/api/test-connection':
            success = test_network_connection(mqtt_config['broker_ip'], mqtt_config['broker_port'])
            self.send_json_response({
                "success": success,
                "message": "Connection successful" if success else "Connection failed"
            })

        else:
            super().do_GET()

    def do_POST(self):
        """Handle POST requests"""
        global mqtt_config, atg_list, history_data, total_message_count, total_error_count

        parsed = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}

        if parsed.path == '/api/start':
            result = start_simulation()
            self.send_json_response(result)

        elif parsed.path == '/api/stop':
            result = stop_simulation()
            self.send_json_response(result)

        elif parsed.path == '/api/mqtt-config':
            mqtt_config.update(data)
            self.send_json_response({"success": True, "config": mqtt_config})

        elif parsed.path == '/api/atg/add':
            # Add a new ATG
            atg_id = data.get("id") or generate_atg_id()
            address = data.get("address", f"8372{len(atg_list)}")
            name = data.get("name", f"ATG-{address}")

            atg = create_default_atg(atg_id, address, name)

            # Apply any additional settings from request
            if "topic" in data:
                atg["topic"] = data["topic"]
            if "publish_interval" in data:
                atg["publish_interval"] = data["publish_interval"]
            if "product_type" in data:
                atg["product_type"] = data["product_type"]
            if "sensor_data" in data:
                atg["sensor_data"].update(data["sensor_data"])
            if "enabled" in data:
                atg["enabled"] = data["enabled"]

            # Apply simulation options
            if "auto_variation" in data:
                atg["auto_variation"] = data["auto_variation"]
            if "temp_variance" in data:
                atg["temp_variance"] = data["temp_variance"]
            if "product_variance" in data:
                atg["product_variance"] = data["product_variance"]
            if "water_variance" in data:
                atg["water_variance"] = data["water_variance"]
            if "simulate_trend" in data:
                atg["simulate_trend"] = data["simulate_trend"]
            if "consumption_rate" in data:
                atg["consumption_rate"] = data["consumption_rate"]

            with state_lock:
                atg_list[atg_id] = atg

            print(f"[{time.strftime('%H:%M:%S')}] Added ATG: {name} (ID: {atg_id}, Topic: {atg['topic']}, ProductType: {atg.get('product_type', 'Diesel')}, AutoVar: {atg['auto_variation']}, Trend: {atg['simulate_trend']})")
            self.send_json_response({"success": True, "atg": atg})

        elif parsed.path == '/api/atg/remove':
            atg_id = data.get("id")
            if atg_id:
                with state_lock:
                    if atg_id in atg_list:
                        removed = atg_list.pop(atg_id)
                        print(f"[{time.strftime('%H:%M:%S')}] Removed ATG: {removed['name']} (ID: {atg_id})")
                        self.send_json_response({"success": True, "message": f"ATG {removed['name']} removed"})
                    else:
                        self.send_json_response({"success": False, "message": "ATG not found"})
            else:
                self.send_json_response({"success": False, "message": "ATG ID required"})

        elif parsed.path == '/api/atg/update':
            atg_id = data.get("id")
            if atg_id and atg_id in atg_list:
                with state_lock:
                    atg = atg_list[atg_id]

                    # Update allowed fields
                    for field in ["name", "address", "topic", "publish_interval", "enabled",
                                  "product_type", "auto_variation", "temp_variance", "product_variance",
                                  "water_variance", "simulate_trend", "consumption_rate"]:
                        if field in data:
                            atg[field] = data[field]

                    # Update sensor data if provided
                    if "sensor_data" in data:
                        atg["sensor_data"].update(data["sensor_data"])

                    # Sync address
                    if "address" in data:
                        atg["sensor_data"]["Address"] = data["address"]

                self.send_json_response({"success": True, "atg": atg})
            else:
                self.send_json_response({"success": False, "message": "ATG not found"})

        elif parsed.path == '/api/reset':
            stop_simulation()
            with state_lock:
                atg_list.clear()
                history_data = []
                total_message_count = 0
                total_error_count = 0
            mqtt_config.update(DEFAULT_MQTT_CONFIG)
            self.send_json_response({"success": True, "message": "Reset complete"})

        else:
            self.send_error(404, "Endpoint not found")

    def send_json_response(self, data, status=200):
        """Send JSON response"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        """Custom log format"""
        print(f"[{time.strftime('%H:%M:%S')}] {args[0]}")


def main():
    """Main entry point"""
    PORT = 8000

    print("=" * 60)
    print("  ATG Simulator Web Server (Multi-ATG Support)")
    print("  Stingray Technologies")
    print("=" * 60)
    print()
    print(f"Starting server on http://localhost:{PORT}")
    print(f"Open http://localhost:{PORT}/atg_simulator.html in your browser")
    print()
    print("API Endpoints:")
    print("  GET  /api/status          - Get simulation status")
    print("  GET  /api/mqtt-config     - Get MQTT configuration")
    print("  GET  /api/atgs            - Get all ATGs")
    print("  GET  /api/atg/<id>        - Get specific ATG")
    print("  GET  /api/history         - Get message history")
    print("  GET  /api/test-connection - Test MQTT broker connection")
    print("  POST /api/start           - Start simulation")
    print("  POST /api/stop            - Stop simulation")
    print("  POST /api/mqtt-config     - Update MQTT configuration")
    print("  POST /api/atg/add         - Add new ATG")
    print("  POST /api/atg/remove      - Remove ATG")
    print("  POST /api/atg/update      - Update ATG settings")
    print("  POST /api/reset           - Reset to defaults")
    print()

    if not MQTT_AVAILABLE:
        print("WARNING: paho-mqtt not installed!")
        print("         Install with: pip install paho-mqtt")
        print("         MQTT publishing will be disabled.")
        print()

    print("Press Ctrl+C to stop the server")
    print("-" * 60)

    with socketserver.TCPServer(("", PORT), ATGRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
            stop_simulation()
            httpd.shutdown()


if __name__ == "__main__":
    main()
