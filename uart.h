#ifndef UART_H
#define UART_H

#include <windows.h>
#include <conio.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>

extern HANDLE hPort;
extern char chComPort[10];
extern unsigned long chBuadRate;

// Function prototypes
bool fnInitComPort(HANDLE *hPort, const char *chPortName, DWORD chBuadRate);
void fnCloseComPort(HANDLE hPort);
uint16_t fnUartTransmit(HANDLE *hPort, uint8_t *u8Buffer, uint16_t u16Length);
uint16_t fnUartReceive(HANDLE *hPort, uint8_t *u8Buffer);
void setComPort(const char *comPort);
void setBaudRate(unsigned long baudRate);
void getComPort(char *comPort);
unsigned long getBaudRate();

#endif
