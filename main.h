#ifndef MAIN_H
#define MAIN_H

#define COMPORT "COM5"
#define BUADRATE 9600

// ========================================
// MQTT PUBLISHING CONFIGURATION
// ========================================
// Publish data after every X minutes regardless of change (in milliseconds)
#define MQTT_PERIODIC_INTERVAL 120000  // 2 minutes = 120 seconds = 120000 ms

// Minimum change threshold to trigger publish (avoid publishing on tiny fluctuations)
#define TEMP_CHANGE_THRESHOLD 0.1     // 0.1 degree Celsius
#define PRODUCT_CHANGE_THRESHOLD 1.0  // 1 mm
#define WATER_CHANGE_THRESHOLD 1.0    // 1 mm
// ========================================

// #define PRINT_ONELINE
// #define PRINT_PACKET

void fnInitMachine();
void fnDelay(int milliseconds);

#endif