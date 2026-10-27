// =====================================================================
//  BNTS smart bin: Arduino Uno controller
// =====================================================================
//  The Uno runs the whole bin. The ESP32-C3 only shows its readings on a
//  web page, so the bin keeps working with or without Wi-Fi.
//
//  What it does:
//   - A hand within 30 cm of the approach sensor opens the lid for 5 s.
//   - Then the servo closes the lid until the closed button is pressed.
//   - A second sensor inside the bin measures how full it is (0-100 %).
//   - Every half second it sends the readings to the ESP32-C3 on TX (D1).
//
//  Wiring (Uno pin -> part):
//   D2  closed button (active HIGH, with a 10k pull-down to GND)
//   D3  servo signal (servo power from a separate 5 V supply, GND shared)
//   D6  Grove ultrasonic SIG, inside the bin (fill level)
//   D7  Grove ultrasonic SIG, facing out (hand detection)
//   D8  LED, through a 220 ohm resistor
//   D1/TX -> 2.2k -> ESP32-C3 GPIO4, and GPIO4 -> 3.3k -> GND.
//         NEVER connect Uno TX straight to the C3: 5 V damages it.
//   GND -> ESP32-C3 GND (the boards must share ground)
//
//  Upload with board "Arduino Uno". Unplug the wire on D1 if an upload
//  fails, then plug it back in afterwards.
//  Settings to check: CAPACITY_USE_HCSR04 below, and the empty/full
//  distances (emptyDistanceMm, fullDistanceMm) in bin_controller.h.
// =====================================================================

#include <Servo.h>
#include <stdio.h>
#include "bin_controller.h"
#include "telemetry_crc.h"

const uint8_t BUTTON_PIN = 2;  // Original external pull-down: HIGH=physically closed.
const uint8_t SERVO_PIN = 3;
const uint8_t APPROACH_GROVE_PIN = 7;
const uint8_t LED_PIN = 8;

// Default second sensor is a Grove SINGLE SIGNAL ultrasonic on D6.
// Set to 1 only when the capacity sensor is a four-pin HC-SR04: TRIG D5, ECHO D6.
#define CAPACITY_USE_HCSR04 0
const uint8_t CAPACITY_GROVE_PIN = 6;
const uint8_t CAPACITY_TRIG = 5;
const uint8_t CAPACITY_ECHO = 6;
const uint32_t ECHO_TIMEOUT_US = 30000;
const uint32_t PING_GAP_MS = 70; // Quiet separation between ANY two transmissions.
const uint32_t CAPACITY_INTERVAL_MS = 200;
const uint32_t TELEMETRY_INTERVAL_MS = 500;
const unsigned long TELEMETRY_BAUD = 115200;

// Original lid defaults: open at 0 deg; close by sweeping 0..180 deg in 15 ms
// steps until the button is hit (fallback 90 deg); settle 300 ms then detach;
// release check at 400 ms; hold open 5 s; cool down 2 s.
// Capacity defaults: empty 400 mm, full 50 mm. Calibrate to your actual bin.
bincontrol::Config settings;
bincontrol::Controller controller(settings);
Servo myServo;
uint32_t lastPingMs = 0;
uint32_t lastCapacityPingMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t sequence = 0;
bool servoWasAttached = false;
uint8_t previousServoAngle = 255;
const size_t MAX_JSON_BYTES = 192;
char frame[MAX_JSON_BYTES + 8]; // Fixed memory; no String heap allocation.
size_t frameLength = 0;
size_t frameOffset = 0;

uint16_t measureGroveMm(uint8_t pin, bool integerCentimetres, bool &valid) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW); delayMicroseconds(2);
  digitalWrite(pin, HIGH); delayMicroseconds(5); digitalWrite(pin, LOW);
  pinMode(pin, INPUT);
  const unsigned long duration = pulseIn(pin, HIGH, ECHO_TIMEOUT_US);
  const unsigned long mm = integerCentimetres
      ? (duration / 29UL / 2UL) * 10UL  // Exact original integer-cm conversion.
      : duration * 10UL / 58UL;
  valid = duration != 0 && mm >= 10 && mm <= 5000;
  return valid ? (uint16_t)mm : 0;
}

uint16_t measureCapacityMm(bool &valid) {
#if CAPACITY_USE_HCSR04
  digitalWrite(CAPACITY_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(CAPACITY_TRIG, HIGH); delayMicroseconds(10); digitalWrite(CAPACITY_TRIG, LOW);
  const unsigned long duration = pulseIn(CAPACITY_ECHO, HIGH, ECHO_TIMEOUT_US);
  const unsigned long mm = duration * 343UL / 2000UL;
  valid = duration != 0 && mm >= 20 && mm <= 5000;
  return valid ? (uint16_t)mm : 0;
#else
  return measureGroveMm(CAPACITY_GROVE_PIN, false, valid);
#endif
}

void publishTelemetry(uint32_t now) {
  if (frameOffset != frameLength) return; // Finish an old frame before replacing it.
  const int length = snprintf(frame + 1, MAX_JSON_BYTES + 1,
      "{\"fill\":%u,\"lidOpen\":%s,\"sensorOk\":%s,\"ageMs\":%lu,\"seq\":%lu,\"approachOk\":%s,\"lidMoving\":%s,\"closedSwitch\":%s,\"lidFault\":%s,\"homing\":%s}",
      (unsigned int)controller.fill(), controller.lidOpen() ? "true" : "false",
      controller.sensorOk() ? "true" : "false", (unsigned long)controller.ageMs(now),
      (unsigned long)sequence++, controller.approachOk() ? "true" : "false",
      controller.lidMoving() ? "true" : "false", controller.closedSwitch() ? "true" : "false",
      controller.lidFault() ? "true" : "false", controller.homing() ? "true" : "false");
  if (length <= 0 || (size_t)length > MAX_JSON_BYTES) return;
  const uint16_t crc = telemetryCrc16(frame + 1, (size_t)length);
  const char hex[] = "0123456789ABCDEF";
  frame[0] = '@';
  frame[length + 1] = '*';
  for (uint8_t i = 0; i < 4; ++i) frame[length + 2 + i] = hex[(crc >> (12 - 4 * i)) & 0x0F];
  frame[length + 6] = '\n';
  frameLength = (size_t)length + 7;
  frameOffset = 0;
}

void drainTelemetry() {
  // Use only free hardware-UART buffer space, so a 171-byte frame does not
  // block the original 15 ms servo sweep while waiting for serial transmission.
  const int available = Serial.availableForWrite();
  if (available <= 0 || frameOffset == frameLength) return;
  const size_t remaining = frameLength - frameOffset;
  const size_t count = remaining < (size_t)available ? remaining : (size_t)available;
  frameOffset += Serial.write((const uint8_t *)frame + frameOffset, count);
}

void applyOutputs() {
  if (controller.servoAttached()) {
    if (!servoWasAttached) {
      myServo.attach(SERVO_PIN);
      servoWasAttached = true;
      previousServoAngle = 255;
    }
    if (controller.servoAngle() != previousServoAngle) {
      previousServoAngle = controller.servoAngle();
      myServo.write(previousServoAngle);
    }
  } else if (servoWasAttached) {
    myServo.detach();
    servoWasAttached = false;
  }
  digitalWrite(LED_PIN, controller.ledOn() ? HIGH : LOW);
}

void setup() {
  pinMode(BUTTON_PIN, INPUT); // Preserve external pull-down, NOT INPUT_PULLUP.
  pinMode(LED_PIN, OUTPUT);
#if CAPACITY_USE_HCSR04
  pinMode(CAPACITY_TRIG, OUTPUT); digitalWrite(CAPACITY_TRIG, LOW);
  pinMode(CAPACITY_ECHO, INPUT);
#endif
  // Edit settings above or assign calibration fields here BEFORE begin().
  Serial.begin(TELEMETRY_BAUD); // Changed from the original 9600 for the C3 bridge.
  const uint32_t now = millis();
  controller.begin(now, digitalRead(BUTTON_PIN) == HIGH);
  applyOutputs();
  lastPingMs = lastCapacityPingMs = lastTelemetryMs = now;
}

void loop() {
  uint32_t now = millis();
  controller.tick(now, digitalRead(BUTTON_PIN) == HIGH);
  applyOutputs();
  if ((uint32_t)(now - lastPingMs) >= PING_GAP_MS) {
    bool valid = false;
    if (controller.approachDue(now)) {
      lastPingMs = now;
      const uint16_t mm = measureGroveMm(APPROACH_GROVE_PIN, true, valid);
      now = millis();
      controller.approachSample(mm, valid, now);
    } else if (controller.capacityMeasurementAllowed(now) &&
               (uint32_t)(now - lastCapacityPingMs) >= CAPACITY_INTERVAL_MS &&
               !controller.approachDueSoon(now, PING_GAP_MS)) {
      // Prioritise the original 200 ms proximity poll and leave 70 ms quiet time.
      lastPingMs = lastCapacityPingMs = now;
      const uint16_t mm = measureCapacityMm(valid);
      now = millis();
      controller.capacitySample(mm, valid, now);
    }
    controller.tick(now, digitalRead(BUTTON_PIN) == HIGH);
    applyOutputs();
  }
  if ((uint32_t)(now - lastTelemetryMs) >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    publishTelemetry(now);
  }
  drainTelemetry();
  // No seconds-long delays and no dependency on an ESP32 acknowledgement.
}
