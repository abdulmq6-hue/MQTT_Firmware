#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <time.h>
#include <windows.h>
#include <math.h>
#include "main.h"
#include "uart.h"
#include "atg.h"
#include "mqtt.h"

HANDLE hPortDart;
AtgData stLatestAtgData[NUMBER_OF_ATGS];      // Store latest data for each ATG
AtgData stPreviousAtgData[NUMBER_OF_ATGS];    // Store previous published data for change detection
double dbLastMqttPublishTime[NUMBER_OF_ATGS]; // Last publish time for each ATG

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
        dbLastMqttPublishTime[i] = -(MQTT_PERIODIC_INTERVAL); // Initialize to publish immediately on first data
    }

    fnUpdateLastAddressSentIndex((NUMBER_OF_ATGS - 1)); // Just so program start sending from zero

    while (1)
    {
        dbCurrentTime = ((double)clock() / CLOCKS_PER_SEC) * 1000;

        // Send ATG polling requests
        if (((dbCurrentTime - dbLastSendMicros) > DELAY_BW_PACKET))
        {
            uint8_t u8AddIndex = fnGetNextAddress();
            uint8_t u8Length = fnPacketAtgPacket(chPacketSend, &achAtgAddress[u8AddIndex][0]);
            fnUartTransmit(&hPortDart, (uint8_t *)chPacketSend, u8Length);
            fnUpdateLastAddressSentIndex(u8AddIndex);
            dbLastSendMicros = ((double)clock() / CLOCKS_PER_SEC) * 1000;
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
                        // Update current data
                        memcpy(&stLatestAtgData[i], &stAtgData, sizeof(AtgData));

                        // Check if data changed or periodic time elapsed
                        double timeSinceLastPublish = dbCurrentTime - dbLastMqttPublishTime[i];
                        int dataChanged = fnHasDataChanged(&stLatestAtgData[i], &stPreviousAtgData[i]);

                        if (dataChanged || (timeSinceLastPublish >= MQTT_PERIODIC_INTERVAL))
                        {
                            // Publish to MQTT
                            char topic[32];
                            sprintf(topic, "ATG%d", stLatestAtgData[i].address);

                            if (fnMqttPublishAtgData(topic, &stLatestAtgData[i]) == 0)
                            {
                                // Update previous data and timestamp only on successful publish
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
    }

    fnMqttCleanup();
    fnCloseComPort(hPortDart);
}

void fnInitMachine()
{
    // SET AND GET COMPORT BAUDRATE
    setComPort(COMPORT);
    setBaudRate(BUADRATE);
    char comPort[10] = {0};
    getComPort(comPort);
    if (fnInitComPort(&hPortDart, comPort, getBaudRate()))
    {
        printf("Port Connected\n");
    }
    else
    {
        printf("Port Not Connected\n");
    }
    printf("%s\n", comPort);
    printf("%d\n", (int)getBaudRate());

    // Initialize MQTT connection
    printf("Initializing MQTT connection...\n");
    if (fnMqttInit("ATGClient") == 0)
    {
        printf("MQTT initialized successfully\n");
    }
    else
    {
        printf("Warning: MQTT initialization failed, will retry during operation\n");
    }
}

void fnDelay(int milliseconds)
{
    clock_t start_time = clock(); // Get the current CPU clock time
    while ((clock() - start_time) * 1000 / CLOCKS_PER_SEC < milliseconds)
        ;
}