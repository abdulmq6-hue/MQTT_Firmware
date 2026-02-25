# ATG Poller - Orange Pi 3 LTS Setup Guide

This guide explains how to compile and run the ATG Poller on Orange Pi 3 LTS running Ubuntu.

## Prerequisites

### 1. Install Required Packages

```bash
# Update package list
sudo apt update

# Install build tools
sudo apt install -y build-essential git

# Install Eclipse Paho MQTT C library
sudo apt install -y libpaho-mqtt-dev

# If libpaho-mqtt-dev is not available, build from source:
# git clone https://github.com/eclipse/paho.mqtt.c.git
# cd paho.mqtt.c
# make
# sudo make install
```

### 2. Enable UART on Orange Pi 3 LTS

The Orange Pi 3 LTS has multiple UART ports. You need to enable them in the device tree.

```bash
# Check available serial ports
ls -la /dev/ttyS*
ls -la /dev/ttyUSB*  # If using USB-to-Serial adapter

# Add user to dialout group for serial port access
sudo usermod -a -G dialout $USER

# Logout and login again for group changes to take effect
```

### 3. Configure Serial Port

Edit `main_linux.h` to set your serial port:

```c
// Common options:
#define SERIAL_PORT "/dev/ttyS1"    // UART1 on GPIO
#define SERIAL_PORT "/dev/ttyS2"    // UART2 on GPIO
#define SERIAL_PORT "/dev/ttyUSB0"  // USB-to-Serial adapter
```

### 4. Configure MQTT Broker

Edit `mqtt.h` to set your MQTT broker address:

```c
#define MQTT_BROKER "192.168.1.100"  // Your MQTT broker IP
#define MQTT_PORT 1883
#define MQTT_USERNAME "duc"
#define MQTT_PASSWORD "SRT123"
```

### 5. Configure ATG Addresses

Edit `atg.c` to set your ATG probe addresses:

```c
#define NUMBER_OF_ATGS 1  // In atg.h
char achAtgAddress[NUMBER_OF_ATGS][7] = {"83727"};  // In atg.c
```

## Building

### Option A: Build Directly on Orange Pi (Recommended)

1. Copy the source files to your Orange Pi:
```bash
scp -r /path/to/source/* orangepi@192.168.1.xxx:~/atg_poller/
```

2. SSH into the Orange Pi:
```bash
ssh orangepi@192.168.1.xxx
cd ~/atg_poller
```

3. Build:
```bash
make -f Makefile.orangepi
```

4. Run:
```bash
./atg_poller
```

### Option B: Cross-Compile from x86 Linux

1. Install ARM cross-compiler:
```bash
sudo apt install gcc-aarch64-linux-gnu
```

2. Cross-compile:
```bash
make -f Makefile.orangepi CROSS=1
```

3. Copy binary to Orange Pi:
```bash
scp atg_poller orangepi@192.168.1.xxx:~/
```

## Running

### Manual Run
```bash
./atg_poller
```

Press `Ctrl+C` to stop.

### Run as System Service

1. Generate service file:
```bash
make -f Makefile.orangepi service
```

2. Install service:
```bash
sudo cp atg_poller.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable atg_poller
sudo systemctl start atg_poller
```

3. Check status:
```bash
sudo systemctl status atg_poller
```

4. View logs:
```bash
sudo journalctl -u atg_poller -f
```

## Wiring

### Orange Pi 3 LTS UART Pins

| UART | TX Pin | RX Pin | Device |
|------|--------|--------|--------|
| UART1 | Pin 8 (GPIO4) | Pin 10 (GPIO5) | /dev/ttyS1 |
| UART2 | Pin 13 (GPIO19) | Pin 15 (GPIO21) | /dev/ttyS2 |

### ATG Connection

```
Orange Pi          ATG Probe
---------          ---------
TX  ────────────── RX
RX  ────────────── TX
GND ────────────── GND
```

**Note:** You may need a level shifter if your ATG uses different voltage levels (3.3V vs 5V).

## Troubleshooting

### Serial Port Permission Denied
```bash
sudo usermod -a -G dialout $USER
# Logout and login again
```

### Serial Port Not Found
```bash
# List available ports
ls -la /dev/tty*

# Check if UART is enabled in device tree
sudo cat /boot/orangepiEnv.txt
```

### MQTT Connection Failed
```bash
# Test MQTT broker connectivity
nc -vz 192.168.1.100 1883

# Check if Mosquitto is running on broker
sudo systemctl status mosquitto
```

### No Response from ATG
1. Check wiring (TX to RX, RX to TX)
2. Verify baud rate matches ATG settings (usually 9600)
3. Test with minicom:
```bash
sudo apt install minicom
minicom -D /dev/ttyS1 -b 9600
```

## Files Overview

| File | Description |
|------|-------------|
| `main_linux.c` | Main program (Linux version) |
| `main_linux.h` | Configuration header (Linux) |
| `uart_linux.c` | Serial port driver (Linux) |
| `uart_linux.h` | Serial port header (Linux) |
| `atg.c` | ATG protocol parser |
| `atg.h` | ATG definitions |
| `mqtt.c` | MQTT client |
| `mqtt.h` | MQTT configuration |
| `Makefile.orangepi` | Build script |

## Support

For issues, contact Stingray Technologies.
