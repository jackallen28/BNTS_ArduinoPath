// =====================================================================
//  BNTS smart bin: ESP32-C3 Wi-Fi relay
// =====================================================================
//  This board makes its own Wi-Fi network and shows the bin's live
//  readings on a web page. It does NOT control the bin: the Uno does.
//
//  To test:
//   1. Upload this to the ESP32-C3 (board "ESP32C3 Dev Module",
//      USB CDC On Boot: Enabled, Partition Scheme: Huge APP (3MB No OTA)).
//   2. Open the Serial Monitor at 115200: it says "Wi-Fi ready", then every
//      2 seconds whether readings are arriving from the Uno.
//   3. On a phone or laptop, join the Wi-Fi network "BNTS-Bin-Monitor" (no
//      password), stay connected if it warns "no internet", and open
//      http://192.168.4.1 (type it in full: http, not https).
//
//  Wiring: Uno D1/TX -> 2.2k -> GPIO4 here, GPIO4 -> 3.3k -> GND, and
//  Uno GND -> GND here. Nothing else. NEVER connect Uno TX straight to
//  GPIO4: the Uno's 5 V damages this 3.3 V board.
//  Keep relay_protocol.h and dashboard_assets.h in this sketch folder.
// =====================================================================

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
uint32_t framesFromUno = 0;  // checked readings received (for the USB status line)
uint32_t bytesFromUno = 0;   // any bytes at all on GPIO4 (shows the wire works)
uint32_t lastStatusMs = 0;

void receiveUnoBytes() {
  while (Serial1.available() > 0) {
    ++bytesFromUno;
    if (unoReceiver.feed(static_cast<uint8_t>(Serial1.read()), millis())) ++framesFromUno;
  }
}

// Every 2 s on the USB Serial Monitor: is the Uno getting through, and is
// anyone viewing the page? (Optional: the bin works without a computer.)
void printStatus() {
  const uint32_t now = millis();
  if (now - lastStatusMs < 2000) return;
  lastStatusMs = now;
  if (!Serial) return; // no computer listening on USB: skip, never wait
  Serial.printf("%s | Uno link: %s | readings: %lu | bytes on GPIO4: %lu | devices on Wi-Fi: %d",
                serverReady ? "Wi-Fi BNTS-Bin-Monitor, page http://192.168.4.1" : "Wi-Fi FAILED",
                unoReceiver.connected(now) ? "OK" : "NO DATA",
                (unsigned long)framesFromUno, (unsigned long)bytesFromUno,
                WiFi.softAPgetStationNum());
  if (unoReceiver.hasTelemetry()) Serial.printf(" | last: %s", unoReceiver.json());
  Serial.println();
  if (bytesFromUno == 0 && now > 10000) {
    Serial.println("  Nothing on GPIO4: check Uno power, the D1 -> 2.2k -> GPIO4 wire, and the shared GND.");
  } else if (framesFromUno == 0 && now > 10000) {
    Serial.println("  Bytes arrive but no good readings: check the Uno program is uploaded (115200 baud) and the divider.");
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
  printStatus();
  delay(1); // Yield to the radio stack. No bin-control logic runs here.
}
