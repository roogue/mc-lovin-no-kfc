#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <ArduinoJson.h>

// I2C Pins
#define I2C_SDA 8
#define I2C_SCL 9

// Actuator Pins
#define PIN_FAN   10  // Relay for fan (Active-LOW)
#define PIN_VALVE 11  // LED for simulated valve (Active-HIGH)

// Relay Logic for Fan
#define RELAY_ON  LOW
#define RELAY_OFF HIGH

// LED Logic for Valve
#define LED_ON    HIGH
#define LED_OFF   LOW

Adafruit_BME280 bme;

unsigned long previousTxMillis = 0;
const unsigned long txInterval = 1000;

String serialRxBuffer = "";

void setup() {
  Serial.begin(115200);

  // 1. Initialize Actuator Pins
  pinMode(PIN_FAN, OUTPUT);
  pinMode(PIN_VALVE, OUTPUT);

  digitalWrite(PIN_FAN, RELAY_OFF);
  digitalWrite(PIN_VALVE, LED_OFF);

  unsigned long start = millis();
  while (!Serial && (millis() - start < 2000)) {
    delay(10);
  }

  // 2. Initialize BME280 Sensor
  Wire.begin(I2C_SDA, I2C_SCL);
  if (!bme.begin(0x76, &Wire) && !bme.begin(0x77, &Wire)) {
    Serial.println("{\"error\": \"BME280 not found on 0x76 or 0x77\"}");
  }
}

void processIncomingCommand(const String& jsonStr) {
  StaticJsonDocument<256> doc;
  DeserializationError err = deserializeJson(doc, jsonStr);

  if (err) {
    return; // Ignore malformed JSON or boot junk
  }

  // Fan Relay Control
  if (doc.containsKey("fan")) {
    bool fanState = doc["fan"];
    digitalWrite(PIN_FAN, fanState ? RELAY_ON : RELAY_OFF);
  }

  // Valve LED Control
  if (doc.containsKey("valve")) {
    bool valveState = doc["valve"];
    digitalWrite(PIN_VALVE, valveState ? LED_ON : LED_OFF);
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
  // 1. Read commands from Python
  readSerialCommands();

  // 2. Read sensor and transmit JSON telemetry every 1 second
  unsigned long currentMillis = millis();
  if (currentMillis - previousTxMillis >= txInterval) {
    previousTxMillis = currentMillis;

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