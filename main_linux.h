/**
 * ATG Poller Configuration - Linux Version for Orange Pi
 * Stingray Technologies
 */

#ifndef MAIN_LINUX_H
#define MAIN_LINUX_H

// ========================================
// SERIAL PORT CONFIGURATION
// ========================================
// Common serial ports on Orange Pi 3 LTS:
//   /dev/ttyS1  - UART1 (GPIO pins)
//   /dev/ttyS2  - UART2 (GPIO pins)
//   /dev/ttyUSB0 - USB to Serial adapter
//   /dev/ttyAMA0 - Alternative UART name
//
// Change this to match your setup:
#define SERIAL_PORT "/dev/ttyS1"
#define BAUDRATE 9600

// ========================================
// MQTT PUBLISHING CONFIGURATION
// ========================================
// Publish data after every X minutes regardless of change (in milliseconds)
#define MQTT_PERIODIC_INTERVAL 120000  // 2 minutes = 120000 ms

// Minimum change threshold to trigger publish
#define TEMP_CHANGE_THRESHOLD 0.1     // 0.1 degree Celsius
#define PRODUCT_CHANGE_THRESHOLD 1.0  // 1 mm
#define WATER_CHANGE_THRESHOLD 1.0    // 1 mm

// ========================================
// DEBUG OPTIONS
// ========================================
// Uncomment to enable debug output
// #define PRINT_ONELINE
// #define PRINT_PACKET

// ========================================
// FUNCTION PROTOTYPES
// ========================================
void fnInitMachine();
void fnDelay(int milliseconds);

#endif
