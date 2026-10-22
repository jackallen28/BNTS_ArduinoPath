// The simulated libraries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, err, uno, esp32, nodemcu, boards } from "./helpers.js";
import { parseTZ, zoneOffset } from "../../../ui/js/sim/libraries/timelib.js";

const ev = (r, type) => r.events.filter((e) => e.type === type);

test("Servo: write angles, clamps, microseconds, read()", () => {
  const r = run(`#include <Servo.h>
    Servo s;
    void setup() { Serial.begin(9600); s.attach(9); s.write(90); s.write(200); s.write(-5); s.writeMicroseconds(1500); Serial.println(s.read()); }
    void loop() {}`, { ms: 10 });
  assert.deepEqual(ev(r, "servo").map((e) => [e.pin, e.angle]), [[9, 92], [9, 90], [9, 180], [9, 0], [9, 92]]);
  assert.equal(r.serial, "92\n");
  assert.equal(err("#include <Servo.h>\nServo s;\nvoid setup(){s.atach(3);}\nvoid loop(){}"), "'class Servo' has no member named 'atach'; did you mean 'attach'?");
  assert.equal(err("#include <ESP32Servo.h>\nServo s;\nvoid setup(){s.attach(13);}\nvoid loop(){}", esp32), "");
});

test("NeoPixel: Color, setPixelColor, brightness, fill, ColorHSV, show", () => {
  const r = run(`#include <Adafruit_NeoPixel.h>
    Adafruit_NeoPixel strip(4, 6, NEO_GRB + NEO_KHZ800);
    void setup() {
      Serial.begin(9600);
      strip.begin();
      strip.setPixelColor(0, strip.Color(255, 0, 0));
      strip.setPixelColor(1, 0, 255, 0);
      strip.show();
      strip.setBrightness(128);
      strip.show();
      strip.fill(Adafruit_NeoPixel::Color(0, 0, 10));
      strip.show();
      Serial.println(strip.numPixels());
      Serial.println(Adafruit_NeoPixel::ColorHSV(21845), HEX);
      Serial.println(strip.gamma32(strip.Color(128, 128, 128)), HEX);
    }
    void loop() {}`, { ms: 10 });
  const shows = ev(r, "neopixel");
  assert.deepEqual(shows[0].pixels, [[255, 0, 0], [0, 255, 0], [0, 0, 0], [0, 0, 0]]);
  assert.deepEqual(shows[1].pixels[0], [128, 0, 0]);
  assert.deepEqual(shows[2].pixels[3], [0, 0, 5]);
  assert.equal(r.serial, "4\nFF00\n2A2A2A\n");
});

test("DHT: readings from inputs, NaN without a sensor", () => {
  const src = `#include <DHT.h>
    DHT dht(4, DHT22);
    void setup() { Serial.begin(9600); dht.begin(); }
    void loop() { float t = dht.readTemperature(); float h = dht.readHumidity();
      if (isnan(t)) Serial.println("no sensor"); else { Serial.print(t, 1); Serial.print(" "); Serial.print(h, 0); Serial.print(" "); Serial.println(dht.readTemperature(true), 1); }
      delay(2000); }`;
  assert.equal(run(src, { ms: 100 }).serial, "no sensor\n");
  assert.equal(run(src, { ms: 100, inputs: { dht: { 4: { t: 22.5, h: 40 } } } }).serial, "22.5 40 72.5\n");
});

test("OLED: text, pixels, display_text, I2C scan finds it", () => {
  const r = run(`#include <Wire.h>
    #include <Adafruit_GFX.h>
    #include <Adafruit_SSD1306.h>
    Adafruit_SSD1306 display(128, 64, &Wire, -1);
    void setup() {
      Serial.begin(9600);
      if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("no screen");
      display.clearDisplay();
      display.setTextSize(2);
      display.setTextColor(SSD1306_WHITE);
      display.setCursor(0, 0);
      display.println("Hi!");
      display.print(21.5, 1);
      display.drawLine(0, 63, 127, 63, WHITE);
      display.fillRect(100, 0, 4, 4, WHITE);
      display.drawCircle(64, 40, 5, WHITE);
      display.display();
      Wire.beginTransmission(0x3C); Serial.println(Wire.endTransmission());
      Wire.beginTransmission(0x27); Serial.println(Wire.endTransmission());
    }
    void loop() {}`, { ms: 100 });
  const o = ev(r, "oled")[0];
  assert.equal(o.width, 128);
  assert.equal(o.height, 64);
  assert.equal(o.buffer.length, 1024);
  const px = (x, y) => (o.buffer[x + (y >> 3) * 128] >> (y & 7)) & 1;
  assert.equal(px(5, 63), 1, "the line");
  assert.equal(px(101, 2), 1, "the box");
  assert.equal(px(50, 50), 0);
  assert.equal(ev(r, "display_text")[0].text, "Hi!\n21.5");
  assert.equal(r.serial, "0\n2\n");
});

test("LCD: init, print, setCursor, clear, backlight", () => {
  const r = run(`#include <Wire.h>
    #include <LiquidCrystal_I2C.h>
    LiquidCrystal_I2C lcd(0x27, 16, 2);
    void setup() { lcd.init(); lcd.backlight(); lcd.setCursor(0, 0); lcd.print("Hello!"); lcd.setCursor(3, 1); lcd.print(42); }
    void loop() {}`, { ms: 200 });
  const last = ev(r, "lcd").at(-1);
  assert.deepEqual(last.lines, ["Hello!          ", "   42           "]);
  assert.equal(last.backlight, true);
  assert.equal(ev(r, "display_text").at(-1).text, "Hello!\n   42");
});

test("TM1637: showNumberDec, leading zeros, minus, colon", () => {
  const r = run(`#include <TM1637Display.h>
    TM1637Display d(6, 7);
    void setup() { d.setBrightness(5); d.showNumberDec(42); d.showNumberDec(7, true); d.showNumberDec(-12); d.showNumberDecEx(1234, 0b01000000, true); d.clear(); }
    void loop() {}`, { ms: 50 });
  const t = ev(r, "tm1637");
  assert.deepEqual(t[0].segments, [0, 0, 0x66, 0x5b]);
  assert.equal(t[0].brightness, 5);
  assert.deepEqual(t[1].segments, [0x3f, 0x3f, 0x3f, 0x07]);
  assert.deepEqual(ev(r, "display_text").map((e) => e.text), ["42", "0007", "-12", "12:34", ""]);
});

test("Keypad: getKey from pressed keys, waitForKey", () => {
  const r = run(`#include <Keypad.h>
    char keys[4][3] = {{'1','2','3'},{'4','5','6'},{'7','8','9'},{'*','0','#'}};
    byte rows[4] = {9, 8, 7, 6}; byte cols[3] = {5, 4, 3};
    Keypad keypad = Keypad(makeKeymap(keys), rows, cols, 4, 3);
    void setup() { Serial.begin(9600); char k = keypad.waitForKey(); Serial.print("first "); Serial.println(k); }
    void loop() { char k = keypad.getKey(); if (k != NO_KEY) Serial.println(k); }`, { ms: 1000, events: [{ at_ms: 100, key: "7" }, { at_ms: 200, key: "#" }, { at_ms: 300, key: "0" }] });
  assert.equal(r.serial, "first 7\n#\n0\n");
});

test("MFRC522: a tapped card's UID", () => {
  const r = run(`#include <SPI.h>
    #include <MFRC522.h>
    MFRC522 rfid(10, 9);
    void setup() { Serial.begin(9600); SPI.begin(); rfid.PCD_Init(); }
    void loop() {
      if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
      String id = "";
      for (byte i = 0; i < rfid.uid.size; i++) { if (rfid.uid.uidByte[i] < 0x10) id += "0"; id += String(rfid.uid.uidByte[i], HEX); }
      id.toUpperCase();
      Serial.println(id);
      MFRC522::PICC_Type t = rfid.PICC_GetType(rfid.uid.sak);
      Serial.println(rfid.PICC_GetTypeName(t));
      rfid.PICC_HaltA();
    }`, { ms: 500, events: [{ at_ms: 100, card: [0xde, 0xad, 0x0b, 0xef] }] });
  assert.equal(r.serial, "DEAD0BEF\nMIFARE 1KB\n");
});

test("MD_MAX72XX: points, rows, intensity", () => {
  const r = run(`#include <MD_MAX72xx.h>
    MD_MAX72XX mx = MD_MAX72XX(MD_MAX72XX::FC16_HW, 10, 1);
    void setup() { mx.begin(); mx.control(MD_MAX72XX::INTENSITY, 3); mx.clear(); mx.setPoint(0, 0, true); mx.setPoint(7, 7, true); mx.setRow(3, 0b10100000); }
    void loop() {}`, { ms: 50 });
  const m = ev(r, "matrix").at(-1);
  assert.equal(m.cs, 10);
  assert.equal(m.intensity, 3);
  assert.equal(m.rows[0], 1);
  assert.equal(m.rows[7], 128);
  assert.equal(m.rows[3], 0b10100000);
});

test("WiFi: connects after a moment, IP, MAC, scan, AP", () => {
  const src = `#include <WiFi.h>
    void setup() {
      Serial.begin(115200);
      WiFi.mode(WIFI_STA);
      WiFi.begin("BNTS-Lab", "secret");
      int tries = 0;
      while (WiFi.status() != WL_CONNECTED) { delay(250); tries++; }
      Serial.print("ip "); Serial.println(WiFi.localIP());
      Serial.println(WiFi.macAddress());
      int n = WiFi.scanNetworks();
      Serial.println(n);
      Serial.println(WiFi.SSID(0) + " " + WiFi.RSSI(0));
      WiFi.disconnect();
      WiFi.softAP("Lamp", "12345678");
      Serial.println(WiFi.softAPIP().toString());
    }
    void loop() {}`;
  for (const b of [esp32, nodemcu]) {
    const r = run(src, { board: b, ms: 4000 });
    const lines = r.serial.trim().split("\n");
    assert.equal(lines[0], "ip 192.168.1.42");
    assert.match(lines[1], /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    assert.equal(lines[2], "6");
    assert.match(lines[3], /^BNTS-Lab -4\d$/);
    assert.equal(lines[4], "192.168.4.1");
    assert.deepEqual(ev(r, "wifi").map((e) => e.status), ["connecting", "connected", "disconnected", "ap"]);
  }
  assert.equal(err("#include <WiFi.h>\nvoid setup(){}\nvoid loop(){}", uno), "fatal error: WiFi.h: No such file or directory");
  assert.equal(err("#include <ESP8266WiFi.h>\nvoid setup(){}\nvoid loop(){}", esp32), "fatal error: ESP8266WiFi.h: No such file or directory");
});

test("WebServer: routes, args, 404, onNotFound (headless http events)", () => {
  const src = `#include <WiFi.h>
    #include <WebServer.h>
    WebServer server(80);
    int level = 0;
    void handleSet() { level = server.arg("level").toInt(); server.send(200, "text/plain", "level=" + String(level)); }
    void setup() {
      Serial.begin(9600);
      WiFi.softAP("Lamp");
      server.on("/set", handleSet);
      server.on("/post", HTTP_POST, []() { server.send(201, "text/plain", "posted"); });
      server.begin();
    }
    void loop() { server.handleClient(); }`;
  const r = run(src, { board: boards["d1-mini"], ms: 500, events: [
    { at_ms: 100, http: { path: "/set", query: { level: "42" } } },
    { at_ms: 150, http: { path: "/set?level=7" } },
    { at_ms: 200, http: { method: "GET", path: "/post" } },
    { at_ms: 250, http: { method: "POST", path: "/post" } },
  ] });
  assert.deepEqual(r.http.map((h) => [h.response.status, h.response.body]), [[200, "level=42"], [200, "level=7"], [404, "Not found: /post"], [201, "posted"]]);
});

test("time and NTP: Melbourne time from the laptop clock", () => {
  const src = `#include <WiFi.h>
    #include <time.h>
    void setup() {
      Serial.begin(115200);
      WiFi.begin("x", "y");
      while (WiFi.status() != WL_CONNECTED) delay(100);
      configTime(0, 0, "pool.ntp.org");
      setenv("TZ", "AEST-10AEDT,M10.1.0,M4.1.0/3", 1);
      tzset();
    }
    void loop() {
      time_t now = time(nullptr);
      struct tm t;
      localtime_r(&now, &t);
      char buf[32];
      strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M", &t);
      Serial.printf("%d %s dst=%d\\n", t.tm_year, buf, t.tm_isdst);
      delay(1000);
    }`;
  const clock = Date.UTC(2026, 9, 22, 3, 4, 5); // 22 Oct 2026, 2:04 pm in Melbourne (AEDT)
  const lines = run(src, { board: esp32, ms: 4000, clock }).serial.trim().split("\n");
  assert.match(lines[0], /^70 1970-01-01 /, "before the time arrives");
  assert.equal(lines.at(-1), "126 2026-10-22 14:04 dst=1");
  // getLocalTime waits for the time
  const r2 = run(`#include <WiFi.h>
    void setup() { Serial.begin(115200); WiFi.begin("x"); while (WiFi.status() != WL_CONNECTED) delay(100);
      configTime(10 * 3600, 0, "pool.ntp.org"); struct tm info;
      if (getLocalTime(&info)) Serial.println(&info, "%H:%M:%S"); }
    void loop() {}`, { board: esp32, ms: 5000, clock });
  assert.match(r2.serial, /^13:04:0[5-8]\n$/);
});

test("POSIX time zones", () => {
  const mel = parseTZ("AEST-10AEDT,M10.1.0,M4.1.0/3");
  assert.equal(mel.std, 36000);
  assert.equal(mel.dst, 39600);
  assert.equal(zoneOffset(mel, Date.UTC(2026, 6, 1) / 1000).offset, 36000, "winter");
  assert.equal(zoneOffset(mel, Date.UTC(2026, 0, 1) / 1000).offset, 39600, "summer");
  assert.equal(zoneOffset(mel, Date.UTC(2026, 9, 3, 15, 59) / 1000).offset, 36000, "just before 2 am, 4 Oct");
  assert.equal(zoneOffset(mel, Date.UTC(2026, 9, 3, 16, 0) / 1000).offset, 39600, "2 am, 4 Oct");
  assert.equal(parseTZ("UTC0").std, 0);
  assert.equal(parseTZ("EST5EDT,M3.2.0,M11.1.0").std, -18000);
});

test("ESP-NOW: send emits an event; received messages run the callback", () => {
  const src = `#include <WiFi.h>
    #include <esp_now.h>
    uint8_t ALL[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    volatile bool got = false;
    char text[32];
    void received(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
      memcpy(text, data, len); text[len] = 0; got = true;
    }
    void setup() {
      Serial.begin(115200);
      WiFi.mode(WIFI_STA);
      if (esp_now_init() != ESP_OK) return;
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, ALL, 6);
      esp_now_add_peer(&peer);
      esp_now_register_recv_cb(received);
      const char msg[] = "buzz";
      Serial.println(esp_now_send(ALL, (const uint8_t*)msg, sizeof(msg)) == ESP_OK ? "sent" : "fail");
    }
    void loop() { if (got) { got = false; Serial.println(text); } delay(10); }`;
  const r = run(src, { board: esp32, ms: 500, events: [{ at_ms: 200, espnow: { from: "24:6F:28:00:00:02", text: "hello" } }] });
  assert.equal(r.serial, "sent\nhello\n");
  const e = ev(r, "espnow")[0];
  assert.equal(e.to, "FF:FF:FF:FF:FF:FF");
  assert.equal(e.text, "buzz");
});

test("raw string literals", () => {
  const r = run(`const char PAGE[] = R"(<p class="x">Hi\\n</p>)";
    void setup() { Serial.begin(9600); Serial.println(PAGE); Serial.println(strlen(PAGE)); }
    void loop() {}`, { ms: 10 });
  assert.equal(r.serial, '<p class="x">Hi\\n</p>\n21\n');
});
