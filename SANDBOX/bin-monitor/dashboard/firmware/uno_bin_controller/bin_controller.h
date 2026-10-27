#pragma once
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
  uint16_t openDistanceMm = 300; // Original integer-cm condition: 1..30cm.
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
        // Original order: write(position), dwell15ms, THEN sample the switch.
        if (closedSwitch_) {
          learnedClosedAngle_ = servoAngle_;
          lidFault_ = false;
          enterCloseSettle(now);
        } else if (servoAngle_ < config_.homeMaxAngle) {
          ++servoAngle_;
        } else {
          // Original full unsuccessful 0..180 sweep falls back to90deg.
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
        // cooldown2s followed by the original loop's final200ms delay.
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
  // original Grove duration/29/2 integer centimetres, multiplied by10.
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
      // Preserve original fixed5s cycle even if the hand remains nearby.
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
    servoAngle_ = 0; // Original closeAndRelaxBin always starts its sweep at0.
    lastHomingStepMs_ = phaseStartedMs_ = now;
    invalidateCapacity();
    // The first switch check follows the original15ms dwell at position0.
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
