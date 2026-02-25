#include "uart.h"
#include <windows.h>
#include <conio.h>
#include <stdio.h>
#include <stdlib.h>

HANDLE hPort;
char chComPort[10] = {0};
unsigned long chBuadRate = 0;

bool fnInitComPort(HANDLE *hPort, const char *chPortName, DWORD chBuadRate)
{
    // Open the serial port
    *hPort = CreateFile(chPortName, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (*hPort == INVALID_HANDLE_VALUE)
    {
        return INVALID_HANDLE_VALUE;
    }

    // Set device parameters (baud rate, byte size, etc.)
    DCB dcbSerialParams = {0};
    dcbSerialParams.DCBlength = sizeof(dcbSerialParams);
    if (!GetCommState(*hPort, &dcbSerialParams))
    {
        CloseHandle(*hPort);
        printf("Error opening COM port at GetCommState\n");
        return INVALID_HANDLE_VALUE;
    }

    dcbSerialParams.BaudRate = (DWORD)chBuadRate;
    dcbSerialParams.ByteSize = 8;
    dcbSerialParams.StopBits = ONESTOPBIT;
    dcbSerialParams.Parity = NOPARITY;

    if (!SetCommState(*hPort, &dcbSerialParams))
    {
        CloseHandle(*hPort);
        printf("Error opening COM port at SetCommState\n");
        return INVALID_HANDLE_VALUE;
    }

    // Set timeouts
    COMMTIMEOUTS timeouts = {0};
    timeouts.ReadIntervalTimeout = 1;
    timeouts.ReadTotalTimeoutConstant = 1;
    timeouts.ReadTotalTimeoutMultiplier = 1;
    timeouts.WriteTotalTimeoutConstant = 50;
    timeouts.WriteTotalTimeoutMultiplier = 10;

    if (!SetCommTimeouts(*hPort, &timeouts))
    {
        CloseHandle(*hPort);
        printf("Error opening COM port at SetCommTimeouts\n");
        return INVALID_HANDLE_VALUE;
    }
    return true;
}

void fnCloseComPort(HANDLE hSerial)
{
    // Close the serial port
    CloseHandle(hSerial);
}
uint16_t fnUartTransmit(HANDLE *hPort, uint8_t *u8Buffer, uint16_t u16Length)
{
    DWORD bytesWrite;
    bool ret = WriteFile(*hPort, u8Buffer, u16Length, &bytesWrite, NULL);
    printf("S:%s\n",u8Buffer);
    return (uint16_t)bytesWrite;
}

uint16_t fnUartReceive(HANDLE *hPort, uint8_t *u8Buffer)
{
    DWORD bytesRead = 0;
    ReadFile(*hPort, u8Buffer, sizeof(u8Buffer), &bytesRead, NULL);
    return (uint16_t)bytesRead;
}
void setComPort(const char *comPort)
{
    strncpy(chComPort, comPort, sizeof(chComPort) - 1);
    chComPort[sizeof(chComPort) - 1] = '\0';
}

void setBaudRate(unsigned long baudRate)
{
    chBuadRate = baudRate;
}

void getComPort(char *comPort)
{
    if (comPort != NULL)
    {
        strcpy(comPort, chComPort);
    }
}

unsigned long getBaudRate()
{
    return chBuadRate;
}
