// Host tests compile the actual controller, parser and Uno sketch with explicit
// Arduino/Servo fakes. This is NOT AVR/C3 target compilation or hardware proof.
#include "firmware/relay_tests.h"
#include "firmware/uno_tests.h"
#include "firmware/stubs/Arduino.h"
#include "../firmware/uno_bin_controller/uno_bin_controller.ino"
#include <iostream>

namespace firmwaretests {
inline void sketchIntegrationTests() {
  arduinostub::reset();
  controller.begin(0, true); controller.tick(15, true); controller.tick(315, true);
  controller.capacitySample(225, true, 1100); controller.capacitySample(225, true, 1300); controller.capacitySample(225, true, 1500);
  frameLength = frameOffset = 0; sequence = UINT32_MAX;
  publishTelemetry(1500);
  expect(frameLength > 0 && frameLength <= sizeof ::frame, "actual Uno serializer fits its fixed frame storage");
  expect(sequence == 0, "sequence rolls over safely after unsigned max");
  arduinostub::txFree = 0;
  drainTelemetry();
  expect(frameOffset == 0 && arduinostub::serialBytes.empty(), "full UART transmit buffer returns immediately without progress");
  const size_t originalLength = frameLength;
  publishTelemetry(1501);
  expect(frameLength == originalLength && sequence == 0, "queued partial frame is not overwritten by newer telemetry");
  arduinostub::txFree = 3;
  while (frameOffset != frameLength) drainTelemetry();
  for (size_t count : arduinostub::serialWrites) expect(count <= 3, "drain never writes beyond free UART buffer space");
  bntsrelay::Receiver bridge;
  expect(feed(bridge, arduinostub::serialBytes, 1600) == 1, "actual Uno emitted frame is accepted by actual bridge parser");
  const std::string expected = "{\"fill\":50,\"lidOpen\":false,\"sensorOk\":true,\"ageMs\":0,\"seq\":4294967295,\"approachOk\":false,\"lidMoving\":false,\"closedSwitch\":true,\"lidFault\":false,\"homing\":false}";
  expect(std::string(bridge.json(), bridge.jsonLength()) == expected, "cross-board relay preserves all Uno decisions and flags exactly");
  expect(bridge.jsonLength() <= bntsrelay::kMaxJsonLength, "actual worst-sequence frame fits bridge protocol budget");

  bool valid = false;
  arduinostub::echoes[APPROACH_GROVE_PIN] = 1797; // duration/29/2 is30cm.
  expect(measureGroveMm(APPROACH_GROVE_PIN, true, valid) == 300 && valid, "Grove adapter preserves original integer-centimetre conversion");
  arduinostub::echoes[APPROACH_GROVE_PIN] = 0;
  expect(measureGroveMm(APPROACH_GROVE_PIN, true, valid) == 0 && !valid, "missing Grove echo is invalid rather than near-hand detection");

  // Exercise actual setup()/loop() with no connected C3 or writable serial TX.
  arduinostub::reset();
  servoWasAttached = false; previousServoAngle = 255;
  frameLength = frameOffset = 0; sequence = 0;
  arduinostub::inputs[BUTTON_PIN] = HIGH;
  arduinostub::echoes[APPROACH_GROVE_PIN] = 2320; //40cm, no opening.
  arduinostub::echoes[CAPACITY_GROVE_PIN] = 1218; // 210 mm: halfway between BIN_EMPTY_MM 220 and BIN_FULL_MM 200.
  arduinostub::txFree = 0;
  setup();
  expect(arduinostub::modes[BUTTON_PIN] == INPUT, "original active-HIGH external pull-down switch wiring is retained");
  expect(myServo.attached() && myServo.pin_ == SERVO_PIN, "actual setup attaches original servo pin");
  for (uint32_t now = 0; now <= 2200; ++now) {
    arduinostub::now = now;
    loop();
    expect(arduinostub::now == now, "main loop has no seconds-long blocking delay");
  }
  expect(controller.phase() == bincontrol::Phase::Closed && !myServo.attached(), "Uno closes and relaxes independently of Wi-Fi/serial progress");
  expect(controller.sensorOk() && controller.fill() == 50, "Uno continues measuring and calculating capacity with C3 absent");
  expect(arduinostub::serialBytes.empty() && frameOffset == 0 && frameLength > 0, "disconnected/full transmit buffer does not block control loop");
  std::vector<arduinostub::Pulse> sonar;
  for (const auto& pulse : arduinostub::triggers)
    if (pulse.pin == APPROACH_GROVE_PIN || pulse.pin == CAPACITY_GROVE_PIN) sonar.push_back(pulse);
  expect(sonar.size() >= 6, "both sensors actually execute in hardware adapter");
  bool sawCapacity = false;
  for (size_t i = 0; i < sonar.size(); ++i) {
    expect(sonar[i].timeMs >= 315, "sonar does not block initial homing sweep");
    if (sonar[i].pin == CAPACITY_GROVE_PIN) { sawCapacity = true; expect(sonar[i].timeMs >= 1065, "capacity ping waits stable closed geometry"); }
    if (i) expect(sonar[i].timeMs - sonar[i-1].timeMs >= PING_GAP_MS, "any two sonar emissions have a quiet separation");
  }
  expect(sawCapacity, "second ultrasonic sensor is active, not a zero-test path");
}
}

int main() {
  try {
    firmwaretests::relayTests();
    firmwaretests::unoTests();
    firmwaretests::sketchIntegrationTests();
    std::cout << "PASS: original Uno lid cycle, capacity, sonar scheduling, exact Uno-to-C3 framing, nonblocking UART, integrity/fault/freshness recovery (" << firmwaretests::assertions << " assertions). Host logic only; AVR/C3 builds and physical hardware remain unverified.\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << '\n';
    return 1;
  }
}
