#pragma once
#include "relay_tests.h"
#include "../../firmware/uno_bin_controller/bin_controller.h"
#include "../../firmware/uno_bin_controller/telemetry_crc.h"
namespace firmwaretests {
inline void unoTests() {
  using bincontrol::Controller;
  using bincontrol::Phase;
  expect(telemetryCrc16("123456789", 9) == 0x29B1, "Uno uses same published CRC check vector");
  Controller home;
  home.begin(0, false);
  expect(home.phase() == Phase::Homing && home.servoAngle() == 0, "startup homes from original zero-degree position");
  expect(home.servoAttached() && home.ledOn(), "homing attaches servo and lights original indicator");
  expect(!home.hasCapacity() && !home.sensorOk() && home.ageMs(0) == UINT32_MAX, "startup does not invent a capacity reading");
  expect(!home.capacityMeasurementAllowed(1000), "homing never permits capacity pulse waits");
  home.tick(14, false); expect(home.servoAngle() == 0, "homing waits the original15ms before stepping");
  home.tick(15, false); expect(home.servoAngle() == 1, "homing advances one degree");
  home.tick(30, true);
  expect(home.phase() == Phase::CloseSettle && home.learnedClosedAngle() == 1, "closed switch learns the actual homing position");
  expect(!home.lidFault() && home.closedSwitch(), "successful switch homing reports no fault");
  home.tick(329, true); expect(home.servoAttached(), "servo remains attached through300ms close settling");
  home.tick(330, true);
  expect(home.phase() == Phase::Closed && !home.servoAttached() && !home.ledOn(), "closed settling releases servo and LED");
  expect(home.approachDue(330), "startup first approach poll is immediate after original homing");
  home.approachSample(0, true, 330);
  expect(!home.approachDue(529) && home.approachDue(530), "later approach polls retain original200ms interval");
  expect(!home.lidOpen() && !home.approachOk(), "zero-distance echo cannot trigger opening");
  home.approachSample(310, true, 530);
  expect(!home.lidOpen() && home.approachOk(), "31cm is beyond the original opening threshold");
  home.approachSample(300, true, 730);
  expect(home.phase() == Phase::OpeningCheck && home.lidOpen() && home.servoAngle() == 0, "30cm opens immediately to original zero-degree angle");
  expect(home.servoAttached() && home.ledOn() && !home.sensorOk(), "opening drives the original outputs and invalidates capacity");
  home.tick(1129, false); expect(home.phase() == Phase::OpeningCheck, "opening release check waits400ms");
  home.tick(1130, false); expect(home.phase() == Phase::OpenHold && !home.lidFault(), "released switch passes the original jam diagnostic");
  // A hand remaining close must NOT extend this user's original fixed5s cycle.
  home.approachSample(100, true, 5000);
  home.tick(5729, false); expect(home.phase() == Phase::OpenHold, "lid remains open until five seconds from opening");
  home.tick(5730, false);
  expect(home.phase() == Phase::Homing && home.servoAngle() == 0 && !home.lidOpen(), "five-second cycle re-homes even if a hand remains nearby");
  home.tick(5745, true); home.tick(6045, true);
  expect(home.phase() == Phase::Cooldown && !home.servoAttached(), "cycle closes, settles and detaches before cooldown");
  home.tick(8044, true); expect(home.phase() == Phase::Cooldown, "original cooldown lasts2seconds");
  home.tick(8045, true); expect(home.phase() == Phase::Closed, "cooldown returns to closed state");
  expect(!home.approachDue(8244) && home.approachDue(8245), "new cycle retains the200ms approach interval");

  Controller jam;
  jam.begin(0, true); jam.tick(14, true);
  expect(jam.phase() == Phase::Homing && jam.servoAngle() == 0, "even a HIGH startup switch waits original15ms at angle zero");
  jam.tick(15, true); jam.tick(315, true); jam.approachSample(100, true, 315); jam.tick(715, true);
  expect(jam.phase() == Phase::OpenHold && jam.lidFault(), "switch still HIGH400ms after opening reports jam");
  Controller missing;
  missing.begin(0, false);
  for (uint32_t now = 15; now <= 2700; now += 15) missing.tick(now, false);
  expect(missing.phase() == Phase::Homing && missing.servoAngle() == 180, "unsuccessful sweep still reaches original180degrees");
  missing.tick(2715, false);
  expect(missing.phase() == Phase::CloseSettle && missing.servoAngle() == 90 && missing.lidFault(), "no switch hit falls back to original90degrees and reports fault");
  missing.tick(3015, false);
  expect(!missing.servoAttached() && !missing.capacityMeasurementAllowed(5000), "failed close cannot manufacture trustworthy capacity");

  Controller capacity;
  capacity.begin(0, true); capacity.tick(15, true); capacity.tick(315, true);
  expect(!capacity.capacityMeasurementAllowed(1064) && capacity.capacityMeasurementAllowed(1065), "capacity waits for confirmed closed lid and750ms settling");
  capacity.capacitySample(225, true, 1065);
  capacity.capacitySample(30, true, 1250);
  expect(!capacity.sensorOk() && !capacity.hasCapacity(), "two samples cannot produce the three-sample median");
  capacity.capacitySample(230, true, 1450);
  expect(capacity.sensorOk() && capacity.fill() == 50, "median rejects one near-wall echo and calculates50percent");
  expect(capacity.ageMs(1500) == 50, "Uno owns capacity sample age");
  capacity.capacitySample(0, false, 1600);
  expect(!capacity.sensorOk() && capacity.hasCapacity() && capacity.fill() == 50, "failed sensor keeps last known fill but marks it invalid");
  capacity.capacitySample(400, true, 1800); capacity.capacitySample(400, true, 2000); capacity.capacitySample(400, true, 2200);
  expect(capacity.fill() == 0 && capacity.sensorOk(), "calibrated empty distance maps to zero");
  capacity.capacitySample(20, true, 2400); capacity.capacitySample(20, true, 2600); capacity.capacitySample(20, true, 2800);
  expect(capacity.fill() == 100, "nearer than full calibration clamps at100percent");
  capacity.capacitySample(500, true, 3000); capacity.capacitySample(500, true, 3200); capacity.capacitySample(500, true, 3400);
  expect(capacity.fill() == 0, "farther than empty calibration clamps at zero");
  capacity.tick(5901, true);
  expect(!capacity.sensorOk() && capacity.hasCapacity() && capacity.capacitySampleCount() == 0, "stale median values are discarded while last displayed fill is retained");
  capacity.capacitySample(225, true, 6000); capacity.capacitySample(225, true, 6200);
  expect(!capacity.sensorOk(), "stale sensor recovery requires three new samples");
  capacity.capacitySample(225, true, 6400);
  expect(capacity.sensorOk() && capacity.fill() == 50, "third fresh sample restores valid capacity");
  capacity.approachSample(100, true, 6600);
  expect(!capacity.sensorOk() && capacity.fill() == 50 && !capacity.capacityMeasurementAllowed(6600), "opening preserves last fill but forbids capacity sampling");
  capacity.capacitySample(50, true, 6800);
  expect(!capacity.sensorOk() && capacity.fill() == 50, "open lid echo cannot become a false full-bin reading");

  bincontrol::Config badCalibration;
  badCalibration.emptyDistanceMm = badCalibration.fullDistanceMm;
  Controller invalid(badCalibration);
  invalid.begin(0, true); invalid.tick(15, true); invalid.tick(315, true);
  invalid.capacitySample(50, true, 1100); invalid.capacitySample(50, true, 1300); invalid.capacitySample(50, true, 1500);
  expect(!invalid.sensorOk() && !invalid.hasCapacity(), "invalid calibration cannot divide by zero or manufacture fill");

  Controller wrap;
  const uint32_t beginning = UINT32_MAX - 100;
  wrap.begin(beginning, true); wrap.tick(beginning + 15U, true); wrap.tick(beginning + 315U, true);
  expect(wrap.phase() == Phase::Closed, "close settling survives millis wrap");
  wrap.approachSample(100, true, beginning + 500U); wrap.tick(beginning + 900U, false);
  wrap.tick(beginning + 5499U, false); expect(wrap.phase() == Phase::OpenHold, "wrapped clock preserves exact fixed hold interval");
  wrap.tick(beginning + 5500U, false); expect(wrap.phase() == Phase::Homing, "wrapped clock closes at correct elapsed interval");
}
}
