CC = g++
PAHO_DIR = C:/paho-mqtt
CFLAGS = -Wall -Wextra -g -I$(PAHO_DIR)/include
LDFLAGS = -L$(PAHO_DIR)/lib -lpaho-mqtt3c -lws2_32

# Output executable
TARGET = run

# Source files and object files
SRCS = main.c uart.c atg.c mqtt.c
OBJS = $(SRCS:.c=.o)

# Default target
all: $(TARGET)

# Link object files to create the executable
$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

# Compile source files into object files
%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

# Clean up build files
clean:
	del /f /q $(OBJS) $(TARGET) 2>nul || exit 0

# Phony targets
.PHONY: all clean