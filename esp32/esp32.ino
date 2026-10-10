#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// I2C Pins
#define I2C_SDA 8
#define I2C_SCL 9

// Safe Relay Pins
#define PIN_FAN   10
#define PIN_VALVE 11

// Relay logic: Set HIGH if your relay is Active-HIGH, or LOW if Active-LOW
#define RELAY_ON  HIGH
#define RELAY_OFF LOW

Adafruit_BME280 bme;

unsigned long previousMillis = 0;
const unsigned long txInterval = 1000; // Send telemetry every 1000 ms

String serialRxBuffer = "";

void setup() {
  Serial.begin(115200);

  // Initialize Relay GPIOs as outputs in the OFF state
  pinMode(PIN_FAN, OUTPUT);
  pinMode(PIN_VALVE, OUTPUT);
  digitalWrite(PIN_FAN, RELAY_OFF);
  digitalWrite(PIN_VALVE, RELAY_OFF);

  unsigned long start = millis();
  while (!Serial && (millis() - start < 2000)) {
    delay(10);
  }

  Wire.begin(I2C_SDA, I2C_SCL);

  if (!bme.begin(0x76, &Wire) && !bme.begin(0x77, &Wire)) {
    Serial.println("{\"error\": \"BME280 not found on 0x76 or 0x77\"}");
  }
}

void processIncomingCommand(const String& jsonStr) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);

  if (err) {
    return; // Ignore malformed packets or boot junk
  }

  if (doc.containsKey("fan")) {
    bool fanState = doc["fan"];
    digitalWrite(PIN_FAN, fanState ? RELAY_ON : RELAY_OFF);
  }

  if (doc.containsKey("valve")) {
    bool valveState = doc["valve"];
    digitalWrite(PIN_VALVE, valveState ? RELAY_ON : RELAY_OFF);
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialRxBuffer.trim();
      if (serialRxBuffer.length() > 0) {
        processIncomingCommand(serialRxBuffer);
      }
      serialRxBuffer = "";
    } else if (c != '\r') {
      serialRxBuffer += c;
    }
  }
}

void loop() {
  // 1. Non-blocking read of control commands from Python
  readSerialCommands();

  // 2. Transmit sensor data at 1-second intervals
  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= txInterval) {
    previousMillis = currentMillis;

    float temperature = bme.readTemperature();
    float humidity    = bme.readHumidity();
    float pressure    = bme.readPressure() / 100.0F;

    char jsonBuffer[128];
    snprintf(jsonBuffer, sizeof(jsonBuffer),
             "{\"temperature\": %.2f, \"humidity\": %.2f, \"pressure\": %.2f}",
             temperature, humidity, pressure);

    Serial.println(jsonBuffer);
  }
}