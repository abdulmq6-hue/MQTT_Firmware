/**
 * UART Header for Linux (Orange Pi / ARM)
 * Cross-platform compatible header file
 */

#ifndef UART_LINUX_H
#define UART_LINUX_H

#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdint.h>

// Linux uses int file descriptor instead of Windows HANDLE
extern int serialFd;
extern char chComPort[64];
extern unsigned long chBaudRate;

// Function prototypes (using int instead of HANDLE for Linux)
bool fnInitComPort(int *fd, const char *portName, unsigned long baudRate);
void fnCloseComPort(int fd);
uint16_t fnUartTransmit(int *fd, uint8_t *buffer, uint16_t length);
uint16_t fnUartReceive(int *fd, uint8_t *buffer);
void setComPort(const char *comPort);
void setBaudRate(unsigned long baudRate);
void getComPort(char *comPort);
unsigned long getBaudRate();

#endif
