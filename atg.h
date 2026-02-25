#ifndef ATG_H
#define ATG_H

#include <stdint.h>
#include <stdbool.h>

// ========================================
// USER CONFIGURATION
// ========================================
// Set the number of ATG devices connected (1 to 10)
#define NUMBER_OF_ATGS 1

// Delay between polling packets in milliseconds
#define DELAY_BW_PACKET 700

// Command header for ATG protocol
#define COMMAND_HEADER "M"
// ========================================

extern char achAtgAddress[NUMBER_OF_ATGS][7];

// Structure to hold the parsed sensor data
typedef struct {
    int address;
    int status;
    float temperature; // in degrees Celsius
    float product;     // in mm
    int water;         // in mm
    int checksum;
} AtgData;

uint8_t fnPacketAtgPacket(uint8_t *au8Buffer, char *achAddress);
void fnPrintAtgData(const AtgData *stAtgData);
void fnInitAtgData(AtgData *data);
void fnPrintPacket(const char chLabel, const uint8_t *chPacket, int wLength);
bool fnCheckStopFlag(uint8_t *au8Buffer, uint8_t u8LastIndex);
int fnParseAtgResponse(const char *achBuffer, AtgData *data);

uint8_t fnGetLastAddressSent();
void fnUpdateLastAddressSentIndex(uint8_t u8Index);
uint8_t fnGetNextAddress();
#endif