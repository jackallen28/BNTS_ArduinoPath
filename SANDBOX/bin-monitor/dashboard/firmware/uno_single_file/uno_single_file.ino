// ONE-FILE VERSION of uno_bin_controller (made by tools/make_uno_single_file.py).
// Paste it into ArduinoPath Free Play (board: Arduino Uno) and press Upload,
// or open it in the Arduino IDE. Edit uno_bin_controller/, then re-run the tool.

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
// ----- bin_controller.h (joined in by tools/make_uno_single_file.py) -----
#include <stdint.h>

// Portable decision logic for the original Grove-ultrasonic Uno bin program.
// The Uno owns the lid, calibration, sensor validity and capacity calculations.
namespace bincontrol {

enum class Phase : uint8_t { Homing, CloseSettle, Closed, OpeningCheck, OpenHold, Cooldown };

struct Config {
  uint8_t openAngle = 0;
  uint8_t homeMaxAngle = 180;
  uint8_t fallbackClosedAngle = 90;
  uint16_t homingStepMs = 15;
  uint16_t closeSettleMs = 300;
  uint16_t openCheckMs = 400;
  uint32_t openHoldMs = 5000;
  uint16_t cooldownMs = 2000;
  uint16_t approachIntervalMs = 200;
  uint16_t openDistanceMm = 300; // Original integer-cm condition: 1..30 cm.
  uint16_t emptyDistanceMm = 400;
  uint16_t fullDistanceMm = 50;
  uint16_t maxCapacityDistanceMm = 600;
  uint16_t capacitySettleMs = 750;
  uint16_t capacityStaleMs = 2500;
  uint16_t approachStaleMs = 1000;
};

inline const Config &defaultConfig() {
  static const Config defaults;
  return defaults;
}

class Controller {
 public:
  explicit Controller(const Config &config = defaultConfig()) : config_(config) {}

  void begin(uint32_t now, bool switchPressed = false) {
    started_ = true;
    closedSwitch_ = switchPressed;
    approachOk_ = capacityOk_ = hasCapacity_ = lidFault_ = false;
    fill_ = 0;
    capacityCount_ = capacityIndex_ = 0;
    lastApproachMs_ = lastCapacityMs_ = now;
    learnedClosedAngle_ = config_.fallbackClosedAngle;
    cycleClosing_ = false;
    startHoming(now);
  }

  void tick(uint32_t now, bool switchPressed) {
    if (!started_) { begin(now, switchPressed); return; }
    closedSwitch_ = switchPressed;
    if (phase_ == Phase::Homing) {
      if (elapsed(now, lastHomingStepMs_) >= config_.homingStepMs) {
        lastHomingStepMs_ = now;
        // Original order: write(position), dwell 15 ms, THEN sample the switch.
        if (closedSwitch_) {
          learnedClosedAngle_ = servoAngle_;
          lidFault_ = false;
          enterCloseSettle(now);
        } else if (servoAngle_ < config_.homeMaxAngle) {
          ++servoAngle_;
        } else {
          // Original full unsuccessful 0..180 sweep falls back to 90 deg.
          learnedClosedAngle_ = config_.fallbackClosedAngle;
          servoAngle_ = learnedClosedAngle_;
          lidFault_ = true;
          enterCloseSettle(now);
        }
      }
    } else if (phase_ == Phase::CloseSettle) {
      if (elapsed(now, phaseStartedMs_) >= config_.closeSettleMs) {
        servoAttached_ = false;
        ledOn_ = false;
        lastClosedMs_ = now;
        phaseStartedMs_ = now;
        phase_ = cycleClosing_ ? Phase::Cooldown : Phase::Closed;
        // First loop after setup samples immediately. Later cycles retain
        // cooldown 2 s followed by the original loop's final 200 ms delay.
        lastApproachMs_ = cycleClosing_ ? now : now - config_.approachIntervalMs;
      }
    } else if (phase_ == Phase::OpeningCheck) {
      if (elapsed(now, openedAtMs_) >= config_.openCheckMs) {
        if (closedSwitch_) lidFault_ = true; // Original release/jam diagnostic.
        if (elapsed(now, openedAtMs_) >= config_.openHoldMs) {
          cycleClosing_ = true;
          startHoming(now);
        } else {
          phase_ = Phase::OpenHold;
        }
      }
    } else if (phase_ == Phase::OpenHold) {
      if (elapsed(now, openedAtMs_) >= config_.openHoldMs) {
        cycleClosing_ = true;
        startHoming(now);
      }
    } else if (phase_ == Phase::Cooldown) {
      if (elapsed(now, phaseStartedMs_) >= config_.cooldownMs) {
        phase_ = Phase::Closed;
        lastApproachMs_ = now;
      }
    }
    if (elapsed(now, lastApproachMs_) > config_.approachStaleMs) approachOk_ = false;
    if (!capacityAllowed(now)) invalidateCapacity();
    if (capacityOk_ && elapsed(now, lastCapacityMs_) > config_.capacityStaleMs) invalidateCapacity();
  }

  // Distance is in integer millimetres. The hardware adapter reproduces the
  // original Grove duration/29/2 integer centimetres, multiplied by 10.
  void approachSample(uint16_t distanceMm, bool valid, uint32_t now) {
    if (!started_) begin(now, false);
    if (!approachDue(now)) return;
    lastApproachMs_ = now;
    approachOk_ = valid && distanceMm >= 10 && distanceMm <= 5000;
    if (approachOk_ && distanceMm <= config_.openDistanceMm) {
      phase_ = Phase::OpeningCheck;
      phaseStartedMs_ = openedAtMs_ = now;
      servoAttached_ = ledOn_ = true;
      servoAngle_ = config_.openAngle;
      commandOpen_ = true;
      // Preserve original fixed 5 s cycle even if the hand remains nearby.
      invalidateCapacity();
    }
  }

  void capacitySample(uint16_t distanceMm, bool valid, uint32_t now) {
    if (!started_) begin(now, false);
    valid = valid && distanceMm >= 20 && distanceMm <= config_.maxCapacityDistanceMm;
    if (!capacityAllowed(now) || !valid || config_.emptyDistanceMm <= config_.fullDistanceMm) {
      invalidateCapacity();
      return;
    }
    if (hasCapacity_ && elapsed(now, lastCapacityMs_) > config_.capacityStaleMs && capacityCount_ == 3) invalidateCapacity();
    capacities_[capacityIndex_] = distanceMm;
    capacityIndex_ = (uint8_t)((capacityIndex_ + 1) % 3);
    if (capacityCount_ < 3) ++capacityCount_;
    if (capacityCount_ < 3) { capacityOk_ = false; return; }
    const uint16_t mm = median3(capacities_[0], capacities_[1], capacities_[2]);
    int32_t percentage = ((int32_t)config_.emptyDistanceMm - mm) * 100L /
                         (config_.emptyDistanceMm - config_.fullDistanceMm);
    if (percentage < 0) percentage = 0;
    if (percentage > 100) percentage = 100;
    fill_ = (uint8_t)percentage;
    capacityOk_ = hasCapacity_ = true;
    lastCapacityMs_ = now;
  }

  Phase phase() const { return phase_; }
  uint8_t servoAngle() const { return servoAngle_; }
  uint8_t learnedClosedAngle() const { return learnedClosedAngle_; }
  bool servoAttached() const { return servoAttached_; }
  bool ledOn() const { return ledOn_; }
  bool lidOpen() const { return commandOpen_; } // Commanded state, not physical feedback.
  bool lidMoving() const { return phase_ == Phase::Homing || phase_ == Phase::CloseSettle || phase_ == Phase::OpeningCheck; }
  bool homing() const { return phase_ == Phase::Homing; }
  bool closedSwitch() const { return closedSwitch_; }
  bool lidFault() const { return lidFault_; }
  bool approachOk() const { return approachOk_; }
  bool sensorOk() const { return capacityOk_; }
  bool hasCapacity() const { return hasCapacity_; }
  uint8_t fill() const { return fill_; }
  uint32_t ageMs(uint32_t now) const { return hasCapacity_ ? elapsed(now, lastCapacityMs_) : UINT32_MAX; }
  uint8_t capacitySampleCount() const { return capacityCount_; }
  bool capacityMeasurementAllowed(uint32_t now) const { return capacityAllowed(now); }
  bool approachDue(uint32_t now) const { return phase_ == Phase::Closed && elapsed(now, lastApproachMs_) >= config_.approachIntervalMs; }
  bool approachDueSoon(uint32_t now, uint16_t horizonMs) const {
    if (phase_ != Phase::Closed) return false;
    const uint32_t wait = config_.approachIntervalMs > horizonMs ? config_.approachIntervalMs - horizonMs : 0;
    return elapsed(now, lastApproachMs_) >= wait;
  }

 private:
  static uint32_t elapsed(uint32_t now, uint32_t then) { return now - then; }
  static uint16_t median3(uint16_t a, uint16_t b, uint16_t c) {
    if (a > b) { const uint16_t t = a; a = b; b = t; }
    if (b > c) { const uint16_t t = b; b = c; c = t; }
    return a > b ? a : b;
  }
  void invalidateCapacity() { capacityOk_ = false; capacityCount_ = capacityIndex_ = 0; }
  bool capacityAllowed(uint32_t now) const {
    return (phase_ == Phase::Closed || phase_ == Phase::Cooldown) && closedSwitch_ && !servoAttached_ &&
           elapsed(now, lastClosedMs_) >= config_.capacitySettleMs;
  }
  void enterCloseSettle(uint32_t now) { phase_ = Phase::CloseSettle; phaseStartedMs_ = now; }
  void startHoming(uint32_t now) {
    phase_ = Phase::Homing;
    commandOpen_ = false;
    servoAttached_ = ledOn_ = true;
    servoAngle_ = 0; // Original closeAndRelaxBin always starts its sweep at 0.
    lastHomingStepMs_ = phaseStartedMs_ = now;
    invalidateCapacity();
    // The first switch check follows the original 15 ms dwell at position 0.
  }

  const Config &config_;
  Phase phase_ = Phase::Homing;
  bool started_ = false, commandOpen_ = false, closedSwitch_ = false;
  bool servoAttached_ = false, ledOn_ = false, lidFault_ = false, cycleClosing_ = false;
  bool approachOk_ = false, capacityOk_ = false, hasCapacity_ = false;
  uint8_t servoAngle_ = 0, learnedClosedAngle_ = 90, fill_ = 0;
  uint8_t capacityCount_ = 0, capacityIndex_ = 0;
  uint16_t capacities_[3] = {0, 0, 0};
  uint32_t phaseStartedMs_ = 0, openedAtMs_ = 0, lastHomingStepMs_ = 0;
  uint32_t lastClosedMs_ = 0, lastApproachMs_ = 0, lastCapacityMs_ = 0;
};

} // namespace bincontrol
// ----- end of bin_controller.h -----
// ----- telemetry_crc.h (joined in by tools/make_uno_single_file.py) -----
#include <stddef.h>
#include <stdint.h>

// CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, refin=false, xorout=0.
// Frame: @<the exact compact JSON bytes>*<four hexadecimal CRC digits>\n
static inline uint16_t telemetryCrc16(const char *data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= (uint16_t)(uint8_t)data[i] << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}
// ----- end of telemetry_crc.h -----

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
