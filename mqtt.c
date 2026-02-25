#include "mqtt.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "MQTTClient.h"

static MQTTClient client;
static bool isConnected = false;

int fnMqttInit(const char *clientId)
{
    char address[64];
    sprintf(address, "tcp://%s:%d", MQTT_BROKER, MQTT_PORT);

    MQTTClient_connectOptions conn_opts = MQTTClient_connectOptions_initializer;
    int rc;

    // Create MQTT client
    rc = MQTTClient_create(&client, address, clientId,
                          MQTTCLIENT_PERSISTENCE_NONE, NULL);

    if (rc != MQTTCLIENT_SUCCESS)
    {
        printf("Failed to create MQTT client, return code %d\n", rc);
        return rc;
    }

    // Set connection options
    conn_opts.keepAliveInterval = MQTT_KEEPALIVE;
    conn_opts.cleansession = 1;
    conn_opts.username = MQTT_USERNAME;
    conn_opts.password = MQTT_PASSWORD;

    // Connect to MQTT broker
    rc = MQTTClient_connect(client, &conn_opts);
    if (rc != MQTTCLIENT_SUCCESS)
    {
        printf("Failed to connect to MQTT broker, return code %d\n", rc);
        isConnected = false;
        return rc;
    }

    printf("Connected to MQTT broker at %s\n", address);
    isConnected = true;
    return MQTTCLIENT_SUCCESS;
}

void fnMqttCleanup()
{
    if (isConnected)
    {
        MQTTClient_disconnect(client, 1000);
        isConnected = false;
    }
    MQTTClient_destroy(&client);
    printf("MQTT connection closed\n");
}

bool fnMqttIsConnected()
{
    return isConnected && MQTTClient_isConnected(client);
}

int fnMqttReconnect()
{
    if (fnMqttIsConnected())
    {
        return MQTTCLIENT_SUCCESS;
    }

    MQTTClient_connectOptions conn_opts = MQTTClient_connectOptions_initializer;
    conn_opts.keepAliveInterval = MQTT_KEEPALIVE;
    conn_opts.cleansession = 1;
    conn_opts.username = MQTT_USERNAME;
    conn_opts.password = MQTT_PASSWORD;

    int rc = MQTTClient_connect(client, &conn_opts);
    if (rc != MQTTCLIENT_SUCCESS)
    {
        printf("Failed to reconnect to MQTT broker, return code %d\n", rc);
        isConnected = false;
        return rc;
    }

    printf("Reconnected to MQTT broker\n");
    isConnected = true;
    return MQTTCLIENT_SUCCESS;
}

int fnMqttPublishAtgData(const char *topic, const AtgData *data)
{
    if (!fnMqttIsConnected())
    {
        printf("MQTT not connected, attempting reconnect...\n");
        if (fnMqttReconnect() != MQTTCLIENT_SUCCESS)
        {
            return -1;
        }
    }

    // Create JSON payload
    char payload[256];
    snprintf(payload, sizeof(payload),
             "{\"Address\":\"%d\",\"req_type\":0,\"Status\":\"%d\",\"Temp\":%.2f,\"Product\":%.2f,\"Water\":%.2f}",
             data->address,
             data->status,
             data->temperature,
             data->product,
             (float)data->water);

    // Create MQTT message
    MQTTClient_message pubmsg = MQTTClient_message_initializer;
    MQTTClient_deliveryToken token;

    pubmsg.payload = payload;
    pubmsg.payloadlen = strlen(payload);
    pubmsg.qos = MQTT_QOS;
    pubmsg.retained = 0;

    // Publish message
    int rc = MQTTClient_publishMessage(client, topic, &pubmsg, &token);
    if (rc != MQTTCLIENT_SUCCESS)
    {
        printf("Failed to publish message, return code %d\n", rc);
        return rc;
    }

    // Wait for message delivery
    rc = MQTTClient_waitForCompletion(client, token, 1000);
    if (rc == MQTTCLIENT_SUCCESS)
    {
        printf("Published to %s: %s\n", topic, payload);
    }

    return rc;
}
