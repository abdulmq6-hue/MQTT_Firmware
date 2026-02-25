#include "atg.h"
#include <stdint.h>
#include <string.h>
#include "stdio.h"
#include "stdbool.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "main.h"

char achAtgAddress[NUMBER_OF_ATGS][7] = {"83731"};
uint8_t u8LastAddressSentIndex = 0;

uint8_t fnPacketAtgPacket(uint8_t *au8Buffer, char *achAddress)
{
    uint8_t u8Pointer = 0;
    au8Buffer[u8Pointer++] = (uint8_t)COMMAND_HEADER[0];
    memcpy(&au8Buffer[u8Pointer], achAddress, strlen(achAddress));
    u8Pointer += strlen(achAddress);
    au8Buffer[u8Pointer++] = '\r';
    au8Buffer[u8Pointer++] = '\n';
#ifdef PRINT_PACKET
    fnPrintPacket('S', au8Buffer, u8Pointer);
#endif
    return u8Pointer;
}

int fnParseAtgResponse(const char *achBuffer, AtgData *data)
{
    if (!achBuffer || !data)
        return 1;

    const char *start = strstr(achBuffer, "R:");
    if (start)
        start += 2;
    else
        start = achBuffer;

    char waterStr[16];
    int tempRaw;

    int parsed = sscanf(start, "%5dN%d=+%d=%f=%[^=]=%d",
                        &data->address,
                        &data->status,
                        &tempRaw, // store as int first
                        &data->product,
                        waterStr,
                        &data->checksum);

    if (parsed == 6)
    {
        data->temperature = tempRaw / 10.0f;
        float waterFloat = strtof(waterStr, NULL);
        data->water = (int)waterFloat;
        return 0;
    }

    return 1;
}

uint8_t fnGetLastAddressSent()
{
    return u8LastAddressSentIndex;
}

void fnUpdateLastAddressSentIndex(uint8_t u8Index)
{
    u8LastAddressSentIndex = u8Index;
}

uint8_t fnGetNextAddress()
{
    uint8_t u8Index = u8LastAddressSentIndex;
    if (u8LastAddressSentIndex == (NUMBER_OF_ATGS - 1))
    {
        return 0;
    }
    else
    {
        return (u8LastAddressSentIndex + 1);
    }
}

// Function to print the parsed sensor data
void fnPrintAtgData(const AtgData *stAtgData)
{
    printf("Address: %d\n", stAtgData->address);
    printf("Status: %d - %s\n", stAtgData->status, stAtgData->status == 0 ? "OK" : "Measurement Error");
    printf("Temperature: %.1f C\n", stAtgData->temperature);
    printf("Product: %.1f mm\n", stAtgData->product);
    printf("Water: %d mm\n\n", stAtgData->water);
    // printf("Checksum: %d\n", stAtgData->checksum);
}

void fnInitAtgData(AtgData *stAtgData)
{
    if (stAtgData == NULL)
        return;
    stAtgData->address = 0;
    stAtgData->status = 0;
    stAtgData->temperature = 0.0f;
    stAtgData->product = 0.0f;
    stAtgData->water = 0;
    stAtgData->checksum = 0;
}

void fnPrintPacket(const char chLabel, const uint8_t *chPacket, int wLength)
{
    // Print the label
    printf("%c:", chLabel);

    // Print the packet data in hexadecimal format
    for (int i = 0; i < wLength; i++)
    {
        printf("%c", chPacket[i]);
    }

    // End with a newline
    fflush(stdout);
    if (chLabel == 'S')
    {
        return;
    }
#ifdef PRINT_ONELINE
    fflush(stdout);
    printf("\r");
#else
    printf("\n");
#endif
}

bool fnCheckStopFlag(uint8_t *au8Buffer, uint8_t u8LastIndex)
{
    if ((au8Buffer[u8LastIndex - 1] == '\r') || (au8Buffer[u8LastIndex - 2] == '\n'))
    {
        return true;
    }
    else
    {
        return false;
    }
}