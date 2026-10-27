// Host test of firmware/uno_bin_standalone (the one-file Uno program), with
// the same Arduino/Servo fakes. Not an AVR build and not hardware proof.
#include <stdio.h>
#include <algorithm>
#include <iostream>
#include "Arduino.h"
#include "Servo.h"
using std::max; using std::min;
#include "../firmware/uno_bin_standalone/uno_bin_standalone.ino"
#include "../firmware/esp32_c3_wifi_bridge/relay_protocol.h"

static int failures = 0, checks = 0;
static void expect(bool ok, const char *what) { ++checks; if (!ok) { ++failures; std::cerr << "FAIL: " << what << "\n"; } }

static void runUntil(uint32_t end, int &lowestAngle) {
  for (; arduinostub::now <= end; ++arduinostub::now) {
    loop();
    if (lidServo.attached()) lowestAngle = std::min(lowestAngle, lidServo.angle_);
  }
}

int main() {
  arduinostub::reset();
  // The lid shuts (button HIGH) when the sweep reaches 120 degrees.
  arduinostub::echoes[HAND_SENSOR_PIN] = 2320;  // 40 cm: no hand
  arduinostub::echoes[FILL_SENSOR_PIN] = 615;   // 106 mm: half full
  setup();
  int lowest = 999;
  for (; arduinostub::now <= 4000; ++arduinostub::now) {
    arduinostub::inputs[BUTTON_PIN] = lidServo.angle_ >= 120 ? HIGH : LOW;
    loop();
  }
  expect(state == READY && !lidServo.attached(), "power-up sweep finds the button and lets the servo go limp");
  expect(lidServo.angle_ == 120 && !lidFault, "the lid stops where the button pressed");
  expect(fillOk && fillPercent == 50, "106 mm reads 50 % with EMPTY 203 / FULL 9");
  // Empty readings 203-210 mm read 0 %; full readings 5-9 mm read 100 %.
  const struct { unsigned long echo; int percent; const char *what; } cases[] = {
    {1218, 0, "210 mm (empty) reads 0 %"}, {1178, 0, "203 mm (empty) reads 0 %"},
    {53, 100, "9 mm (full) reads 100 %"}, {30, 100, "5 mm (full) reads 100 %"}};
  for (const auto &c : cases) {
    arduinostub::echoes[FILL_SENSOR_PIN] = c.echo;
    for (uint32_t end = arduinostub::now + 1000; arduinostub::now <= end; ++arduinostub::now) loop();
    expect(fillOk && fillPercent == c.percent, c.what);
  }

  // A hand at 20 cm opens it; it stays open 5 s whatever the hand does.
  arduinostub::echoes[HAND_SENSOR_PIN] = 1160;
  runUntil(arduinostub::now + 300, lowest);
  expect(state == OPEN && lidServo.angle_ == OPEN_ANGLE, "a hand opens the lid to OPEN_ANGLE");
  expect(!fillOk, "the fill isn't trusted while the lid is open");
  arduinostub::inputs[BUTTON_PIN] = LOW;
  arduinostub::echoes[HAND_SENSOR_PIN] = 2320;
  runUntil(arduinostub::now + 4000, lowest);
  expect(state == OPEN && !lidFault, "still open before 5 s, button let go");
  for (uint32_t end = arduinostub::now + 6000; arduinostub::now <= end; ++arduinostub::now) {
    arduinostub::inputs[BUTTON_PIN] = lidServo.angle_ >= 120 ? HIGH : LOW;
    loop();
    if (lidServo.attached()) lowest = std::min(lowest, lidServo.angle_);
  }
  expect(lowest >= OPEN_ANGLE, "the servo never goes past OPEN_ANGLE");
  expect((state == RESTING || state == READY) && !lidServo.attached(), "the lid closes and rests");

  // Every line sent is accepted by the C3's real checker.
  bntsrelay::Receiver bridge;
  int frames = 0;
  for (char c : arduinostub::serialBytes) if (bridge.feed((uint8_t)c, 1)) ++frames;
  expect(frames > 20, "the ESP32-C3's checker accepts the Uno's lines");
  size_t lines = (size_t)std::count(arduinostub::serialBytes.begin(), arduinostub::serialBytes.end(), '\n');
  expect((size_t)frames == lines, "every line passes the CRC and JSON checks");

  if (failures) { std::cerr << failures << " of " << checks << " standalone checks failed\n"; return 1; }
  std::cout << "PASS: standalone Uno program (" << checks << " checks, " << frames << " lines to the C3).\n";
  return 0;
}
