// ESP32-C3-Zero: receive-only UART-to-Wi-Fi bridge. ALL bin decisions run on Uno.
// Uno D1/TX -> 5V-to-3.3V divider -> C3 GPIO4/RX, plus common GND.
// No C3 TX connection. Never wire the Uno's 5 V signal directly to the C3.
// Arduino IDE: ESP32C3 Dev Module (check your board), USB CDC On Boot: Enabled.
#include <WiFi.h>
#include <WebServer.h>
#include "relay_protocol.h"
#include "dashboard_assets.h" // Generate with tools/embed_dashboard.py.

const int UNO_UART_RX = 4;
const uint32_t UNO_UART_BAUD = 115200;
const char *AP_SSID = "BNTS-Bin-Monitor";

WebServer server(80);
bntsrelay::Receiver unoReceiver;
bool serverReady = false;

void receiveUnoBytes() {
  while (Serial1.available() > 0) {
    unoReceiver.feed(static_cast<uint8_t>(Serial1.read()), millis());
  }
}

void sendTelemetry() {
  receiveUnoBytes();
  const uint32_t nowMs = millis();
  String body;
  body.reserve(bntsrelay::kMaxJsonLength + 90);
  body = "{\"connected\":";
  body += unoReceiver.connected(nowMs) ? "true" : "false";
  body += ",\"receivedAgeMs\":";
  if (unoReceiver.hasTelemetry()) body += unoReceiver.receivedAgeMs(nowMs);
  else body += "null";
  body += ",\"telemetry\":";
  // Forward original JSON unchanged. The bridge never recalculates fill, sensor
  // validity, lid state or sample age; those values come entirely from the Uno.
  if (unoReceiver.hasTelemetry()) body += unoReceiver.json();
  else body += "null";
  body += "}";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", body);
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

void setup() {
  Serial.begin(115200); // Optional USB debug only; not the Uno UART.
  Serial1.setRxBufferSize(2048); // Absorb frames while serving the static display assets.
  Serial1.begin(UNO_UART_BAUD, SERIAL_8N1, UNO_UART_RX, -1);
  // We never write to Serial1. Only its RX pin and the common ground are wired.

  const IPAddress address(192, 168, 4, 1);
  const IPAddress subnet(255, 255, 255, 0);
  const bool modeReady = WiFi.mode(WIFI_AP);
  const bool addressReady = modeReady && WiFi.softAPConfig(address, address, subnet);
  // Open demonstration AP: no router, internet, cloud key or password required.
  const bool apReady = addressReady && WiFi.softAP(AP_SSID);
  if (apReady) {
    server.on("/api/telemetry", HTTP_GET, sendTelemetry);
    server.onNotFound(sendDashboardAsset);
    server.begin();
    serverReady = true;
    Serial.println("Wi-Fi ready: join BNTS-Bin-Monitor and open http://192.168.4.1");
    Serial.println("Waiting for checksummed Uno telemetry on GPIO4.");
  } else {
    Serial.println("Wi-Fi AP setup failed. Uno control is independent and continues.");
  }
}

void loop() {
  receiveUnoBytes();
  if (serverReady) server.handleClient();
  receiveUnoBytes();
  delay(1); // Yield to the radio stack. No bin-control logic runs here.
}
