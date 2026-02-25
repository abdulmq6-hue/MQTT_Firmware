#ifndef MQTT_H
#define MQTT_H

#include <stdint.h>
#include <stdbool.h>
#include "atg.h"

#define MQTT_BROKER "127.0.0.1"
#define MQTT_PORT 1883
#define MQTT_USERNAME "duc"
#define MQTT_PASSWORD "SRT123"
#define MQTT_KEEPALIVE 60
#define MQTT_QOS 1

// MQTT connection and publishing functions
int fnMqttInit(const char *clientId);
void fnMqttCleanup();
bool fnMqttIsConnected();
int fnMqttPublishAtgData(const char *topic, const AtgData *data);
int fnMqttReconnect();

#endif
