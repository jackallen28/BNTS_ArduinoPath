// ESP32 DevKit: HC-SR04 distance sensor + reed switch lid sensor.
// HC-SR04 ECHO is 5 V: use a voltage divider before the ESP's 3.3 V input!
// After flashing, power the board, join BNTS-Bin-Monitor Wi-Fi and open
// http://192.168.4.1. No USB data connection or Internet service is needed.
#include <WiFi.h>
#include <WebServer.h>
#include "dashboard_assets.h" // Generated from the existing SANDBOX dashboard.

const int TRIG = 5;
const int ECHO = 18;
const int LID = 19; // switch to GND when lid is CLOSED
const float EMPTY_CM = 40.0;
const float FULL_CM = 5.0;
const char *AP_SSID = "BNTS-Bin-Monitor";
const unsigned long SAMPLE_INTERVAL_MS = 500;

WebServer server(80);
int fill = 0;
bool lidOpen = false;
bool sensorOk = false;
unsigned long lastValidReadingMs = 0;
unsigned long lastSampleMs = 0;
bool serverReady = false;

String telemetryJson() {
  const unsigned long ageMs = millis() - lastValidReadingMs;
  String json;
  json.reserve(96);
  json = "{\"fill\":";
  json += fill;
  json += ",\"lidOpen\":";
  json += lidOpen ? "true" : "false";
  json += ",\"sensorOk\":";
  json += sensorOk ? "true" : "false";
  json += ",\"ageMs\":";
  json += ageMs;
  json += "}";
  return json;
}

void sendTelemetry() {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", telemetryJson());
}

void sendDashboardAsset() {
  const String uri = server.uri();
  for (size_t i = 0; i < DASHBOARD_ASSET_COUNT; ++i) {
    const DashboardAsset &asset = DASHBOARD_ASSETS[i];
    if (uri == asset.path) {
      server.sendHeader("Cache-Control", "no-store");
      server.send_P(200, asset.contentType,
                    reinterpret_cast<const char *>(asset.data), asset.size);
      return;
    }
  }
  server.send(404, "text/plain", "Not found");
}

void sampleSensors() {
  // Keep the lid live even when the distance sensor has no echo.
  lidOpen = digitalRead(LID) == HIGH;
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  const unsigned long duration = pulseIn(ECHO, HIGH, 30000);
  sensorOk = duration > 0;
  if (sensorOk) {
    const float cm = duration * 0.0343f / 2.0f;
    fill = constrain((int)((EMPTY_CM - cm) * 100 / (EMPTY_CM - FULL_CM)), 0, 100);
    lastValidReadingMs = millis();
  }
  // Both transports use the same payload. On a timeout, fill is the last known
  // value and sensorOk is false; consumers must not present it as a fresh fill.
  Serial.println(telemetryJson());
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  digitalWrite(TRIG, LOW);
  pinMode(ECHO, INPUT);
  pinMode(LID, INPUT_PULLUP);

  const IPAddress address(192, 168, 4, 1);
  const IPAddress subnet(255, 255, 255, 0);
  const bool modeReady = WiFi.mode(WIFI_AP);
  const bool addressReady = modeReady && WiFi.softAPConfig(address, address, subnet);
  // Deliberately open for a classroom demo; join this SSID directly. No router
  // connection or saved network credentials are involved.
  const bool apReady = addressReady && WiFi.softAP(AP_SSID);
  if (apReady) {
    server.on("/api/telemetry", HTTP_GET, sendTelemetry);
    server.onNotFound(sendDashboardAsset);
    server.begin();
    serverReady = true;
    Serial.println("Wi-Fi ready: join BNTS-Bin-Monitor and open http://192.168.4.1");
  } else {
    Serial.println("Wi-Fi AP setup failed; check board/power. USB telemetry remains available.");
  }
  sampleSensors();
  lastSampleMs = millis();
}

void loop() {
  if (serverReady) server.handleClient();
  // Unsigned subtraction also handles millis() rollover.
  if ((unsigned long)(millis() - lastSampleMs) >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = millis();
    sampleSensors();
  }
  delay(1); // Yield to the ESP32 network stack without blocking between samples.
}
