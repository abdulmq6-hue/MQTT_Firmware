/**
 * UART Linux Implementation for Orange Pi
 * Replaces Windows-specific uart.c for ARM Linux systems
 */

#include "uart.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <termios.h>
#include <errno.h>

static int serialFd = -1;
static char chComPort[64] = "/dev/ttyS0";
static unsigned long chBaudRate = 9600;

/**
 * Convert baud rate number to termios constant
 */
static speed_t getBaudRateConstant(unsigned long baudRate)
{
    switch (baudRate)
    {
    case 1200:
        return B1200;
    case 2400:
        return B2400;
    case 4800:
        return B4800;
    case 9600:
        return B9600;
    case 19200:
        return B19200;
    case 38400:
        return B38400;
    case 57600:
        return B57600;
    case 115200:
        return B115200;
    default:
        return B9600;
    }
}

/**
 * Initialize serial port for Linux
 * @param fd Pointer to file descriptor (replaces HANDLE)
 * @param portName Serial port name (e.g., "/dev/ttyS0", "/dev/ttyUSB0")
 * @param baudRate Baud rate
 * @return true on success, false on failure
 */
bool fnInitComPort(int *fd, const char *portName, unsigned long baudRate)
{
    struct termios tty;

    // Open serial port
    *fd = open(portName, O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (*fd < 0)
    {
        printf("Error opening serial port %s: %s\n", portName, strerror(errno));
        return false;
    }

    // Get current serial port settings
    if (tcgetattr(*fd, &tty) != 0)
    {
        printf("Error getting serial port attributes: %s\n", strerror(errno));
        close(*fd);
        *fd = -1;
        return false;
    }

    // Set baud rate
    speed_t speed = getBaudRateConstant(baudRate);
    cfsetispeed(&tty, speed);
    cfsetospeed(&tty, speed);

    // Configure serial port: 8N1 (8 data bits, no parity, 1 stop bit)
    tty.c_cflag &= ~PARENB;        // No parity
    tty.c_cflag &= ~CSTOPB;        // 1 stop bit
    tty.c_cflag &= ~CSIZE;         // Clear size bits
    tty.c_cflag |= CS8;            // 8 data bits
    tty.c_cflag &= ~CRTSCTS;       // No hardware flow control
    tty.c_cflag |= CREAD | CLOCAL; // Enable receiver, ignore modem control lines

    // Raw input mode
    tty.c_lflag &= ~(ICANON | ECHO | ECHOE | ISIG);

    // Raw output mode
    tty.c_oflag &= ~OPOST;

    // Disable software flow control
    tty.c_iflag &= ~(IXON | IXOFF | IXANY);
    tty.c_iflag &= ~(IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL);

    // Set read timeout (non-blocking with minimal wait)
    tty.c_cc[VMIN] = 0;  // Minimum number of characters
    tty.c_cc[VTIME] = 1; // Timeout in deciseconds (0.1 sec)

    // Apply settings
    if (tcsetattr(*fd, TCSANOW, &tty) != 0)
    {
        printf("Error setting serial port attributes: %s\n", strerror(errno));
        close(*fd);
        *fd = -1;
        return false;
    }

    // Flush any pending data
    tcflush(*fd, TCIOFLUSH);

    serialFd = *fd;
    return true;
}

/**
 * Close serial port
 */
void fnCloseComPort(int fd)
{
    if (fd >= 0)
    {
        close(fd);
    }
    serialFd = -1;
}

/**
 * Transmit data over UART
 * @param fd Pointer to file descriptor
 * @param buffer Data buffer to send
 * @param length Number of bytes to send
 * @return Number of bytes actually sent
 */
uint16_t fnUartTransmit(int *fd, uint8_t *buffer, uint16_t length)
{
    if (*fd < 0)
    {
        printf("Serial port not open\n");
        return 0;
    }

    ssize_t bytesWritten = write(*fd, buffer, length);

    if (bytesWritten < 0)
    {
        printf("Error writing to serial port: %s\n", strerror(errno));
        return 0;
    }

    // Ensure data is transmitted
    tcdrain(*fd);

    printf("S:%s\n", buffer);
    return (uint16_t)bytesWritten;
}

/**
 * Receive data from UART
 * @param fd Pointer to file descriptor
 * @param buffer Buffer to store received data
 * @return Number of bytes received
 */
uint16_t fnUartReceive(int *fd, uint8_t *buffer)
{
    if (*fd < 0)
    {
        return 0;
    }

    ssize_t bytesRead = read(*fd, buffer, 1); // Read one byte at a time

    if (bytesRead < 0)
    {
        if (errno != EAGAIN && errno != EWOULDBLOCK)
        {
            printf("Error reading from serial port: %s\n", strerror(errno));
        }
        return 0;
    }

    return (uint16_t)bytesRead;
}

/**
 * Set COM port name
 */
void setComPort(const char *comPort)
{
    strncpy(chComPort, comPort, sizeof(chComPort) - 1);
    chComPort[sizeof(chComPort) - 1] = '\0';
}

/**
 * Set baud rate
 */
void setBaudRate(unsigned long baudRate)
{
    chBaudRate = baudRate;
}

/**
 * Get COM port name
 */
void getComPort(char *comPort)
{
    if (comPort != NULL)
    {
        strcpy(comPort, chComPort);
    }
}

/**
 * Get baud rate
 */
unsigned long getBaudRate()
{
    return chBaudRate;
}
