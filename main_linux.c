/**
 * ATG Poller Main Program - Linux Version for Orange Pi
 * Stingray Technologies
 *
 * This version is compatible with ARM Linux (Orange Pi 3 LTS)
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include <math.h>
#include <unistd.h>
#include <signal.h>

#include "main_linux.h"
#include "uart_linux.h"
#include "atg.h"
#include "mqtt.h"

// Global variables
int hPortDart = -1;  // File descriptor for serial port (replaces Windows HANDLE)
AtgData stLatestAtgData[NUMBER_OF_ATGS];
AtgData stPreviousAtgData[NUMBER_OF_ATGS];
double dbLastMqttPublishTime[NUMBER_OF_ATGS];

// Flag for graceful shutdown
static volatile int keepRunning = 1;

// Signal handler for graceful shutdown (Ctrl+C)
void signalHandler(int signum)
{
    printf("\nReceived signal %d, shutting down...\n", signum);
    keepRunning = 0;
}

// Get current time in milliseconds
double getCurrentTimeMs()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (ts.tv_sec * 1000.0) + (ts.tv_nsec / 1000000.0);
}

// Function to check if ATG data has changed significantly
int fnHasDataChanged(const AtgData *current, const AtgData *previous)
{
    if (fabs(current->temperature - previous->temperature) >= TEMP_CHANGE_THRESHOLD)
        return 1;
    if (fabs(current->product - previous->product) >= PRODUCT_CHANGE_THRESHOLD)
        return 1;
    if (abs(current->water - previous->water) >= (int)WATER_CHANGE_THRESHOLD)
        return 1;
    if (current->status != previous->status)
        return 1;
    return 0;
}

int main()
{
    // Setup signal handlers for graceful shutdown
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    printf("==============================================\n");
    printf("  ATG Poller - Linux/Orange Pi Version\n");
    printf("  Stingray Technologies\n");
    printf("==============================================\n\n");

    fnInitMachine();

    double dbCurrentTime = 0;
    double dbLastSendMicros = -(DELAY_BW_PACKET);
    uint8_t chPacketSend[10] = {0};
    uint8_t chPacketRec[50] = {0};
    uint8_t u8PacketPointer = 0;
    AtgData stAtgData;

    // Initialize ATG data structures
    fnInitAtgData(&stAtgData);
    for (int i = 0; i < NUMBER_OF_ATGS; i++)
    {
        fnInitAtgData(&stLatestAtgData[i]);
        fnInitAtgData(&stPreviousAtgData[i]);
        stLatestAtgData[i].address = atoi(achAtgAddress[i]);
        stPreviousAtgData[i].address = atoi(achAtgAddress[i]);
        dbLastMqttPublishTime[i] = -(MQTT_PERIODIC_INTERVAL);
    }

    fnUpdateLastAddressSentIndex((NUMBER_OF_ATGS - 1));

    printf("Starting ATG polling loop...\n");
    printf("Press Ctrl+C to stop\n\n");

    while (keepRunning)
    {
        dbCurrentTime = getCurrentTimeMs();

        // Send ATG polling requests
        if ((dbCurrentTime - dbLastSendMicros) > DELAY_BW_PACKET)
        {
            uint8_t u8AddIndex = fnGetNextAddress();
            uint8_t u8Length = fnPacketAtgPacket(chPacketSend, &achAtgAddress[u8AddIndex][0]);
            fnUartTransmit(&hPortDart, (uint8_t *)chPacketSend, u8Length);
            fnUpdateLastAddressSentIndex(u8AddIndex);
            dbLastSendMicros = getCurrentTimeMs();
        }

        // Receive and process ATG responses
        uint8_t u8LengReceived = fnUartReceive(&hPortDart, &chPacketRec[u8PacketPointer]);
        u8PacketPointer += u8LengReceived;

        if (u8PacketPointer > 0)
        {
            if (fnCheckStopFlag(chPacketRec, u8PacketPointer))
            {
#ifdef PRINT_PACKET
                fnPrintPacket('R', chPacketRec, u8PacketPointer);
#endif
                fnParseAtgResponse((char *)chPacketRec, &stAtgData);
                fnPrintAtgData(&stAtgData);

                // Update latest data and check for changes
                for (int i = 0; i < NUMBER_OF_ATGS; i++)
                {
                    if (stLatestAtgData[i].address == stAtgData.address)
                    {
                        memcpy(&stLatestAtgData[i], &stAtgData, sizeof(AtgData));

                        double timeSinceLastPublish = dbCurrentTime - dbLastMqttPublishTime[i];
                        int dataChanged = fnHasDataChanged(&stLatestAtgData[i], &stPreviousAtgData[i]);

                        if (dataChanged || (timeSinceLastPublish >= MQTT_PERIODIC_INTERVAL))
                        {
                            char topic[32];
                            sprintf(topic, "ATG%d", stLatestAtgData[i].address);

                            if (fnMqttPublishAtgData(topic, &stLatestAtgData[i]) == 0)
                            {
                                memcpy(&stPreviousAtgData[i], &stLatestAtgData[i], sizeof(AtgData));
                                dbLastMqttPublishTime[i] = dbCurrentTime;

                                if (dataChanged)
                                {
                                    printf("[MQTT] Published due to data change\n");
                                }
                                else
                                {
                                    printf("[MQTT] Published due to periodic interval (2 min)\n");
                                }
                            }
                        }
                        break;
                    }
                }

                fnInitAtgData(&stAtgData);
                u8PacketPointer = 0;
                memset(chPacketRec, 0x00, sizeof(chPacketRec));
            }
        }

        // Small delay to prevent CPU spinning (1ms)
        usleep(1000);
    }

    // Cleanup
    printf("\nCleaning up...\n");
    fnMqttCleanup();
    fnCloseComPort(hPortDart);
    printf("Shutdown complete.\n");

    return 0;
}

void fnInitMachine()
{
    // Set serial port - common Orange Pi serial ports:
    // /dev/ttyS0 - UART0 (debug console, may not be available)
    // /dev/ttyS1 - UART1
    // /dev/ttyS2 - UART2
    // /dev/ttyUSB0 - USB to Serial adapter
    setComPort(SERIAL_PORT);
    setBaudRate(BAUDRATE);

    char comPort[64] = {0};
    getComPort(comPort);

    printf("Connecting to serial port: %s at %d baud\n", comPort, (int)getBaudRate());

    if (fnInitComPort(&hPortDart, comPort, getBaudRate()))
    {
        printf("Serial port connected successfully\n");
    }
    else
    {
        printf("ERROR: Serial port connection failed!\n");
        printf("Please check:\n");
        printf("  1. Port %s exists (ls -la %s)\n", comPort, comPort);
        printf("  2. You have permission (sudo usermod -a -G dialout $USER)\n");
        printf("  3. The device is connected\n");
    }

    // Initialize MQTT connection
    printf("\nInitializing MQTT connection to %s:%d...\n", MQTT_BROKER, MQTT_PORT);
    if (fnMqttInit("ATGClient_OrangePi") == 0)
    {
        printf("MQTT connected successfully\n");
    }
    else
    {
        printf("Warning: MQTT initialization failed, will retry during operation\n");
    }
    printf("\n");
}

void fnDelay(int milliseconds)
{
    usleep(milliseconds * 1000);
}
