// =====================================================================
//  BNTS smart bin: fill sensor calibration
// =====================================================================
//  Upload this to the Uno on its own, to measure your bin. It reads the
//  fill sensor (inside the bin, on D6) and shows on the Serial Monitor
//  (9600 baud) the distance it sees and the fill level the bin program
//  would send with BIN_EMPTY_MM and BIN_FULL_MM below.
//
//  How to calibrate:
//   1. Upload this sketch and open the Serial Monitor at 9600.
//   2. Close the lid with the bin EMPTY. Note the distance: that's EMPTY.
//   3. Fill the bin to where you want it to say FULL (or hold a flat
//      piece of card there). Note the distance: that's FULL.
//   4. Put both numbers into BIN_EMPTY_MM and BIN_FULL_MM here, upload
//      again, and check the fill reads 0 % empty and 100 % full.
//   5. Copy the same two numbers into uno_bin_standalone.ino and upload
//      the bin program again.
//
//  The lid servo and the hand sensor are not used: the lid stays still.
// =====================================================================

const uint16_t BIN_EMPTY_MM = 203; // reading with the bin empty = 0 % (measured 203-210)
const uint16_t BIN_FULL_MM = 9;    // reading when it's full = 100 % (measured 5-9)

// Same sensor setting as the bin program: 0 = Grove ultrasonic SIG on D6,
// 1 = four-pin HC-SR04 with TRIG on D5 and ECHO on D6.
#define CAPACITY_USE_HCSR04 0
const uint8_t CAPACITY_GROVE_PIN = 6;
const uint8_t CAPACITY_TRIG = 5;
const uint8_t CAPACITY_ECHO = 6;
const uint32_t ECHO_TIMEOUT_US = 30000;

// The same measurement as the bin program, so the numbers match.
uint16_t measureMm(bool &valid) {
#if CAPACITY_USE_HCSR04
  digitalWrite(CAPACITY_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(CAPACITY_TRIG, HIGH); delayMicroseconds(10); digitalWrite(CAPACITY_TRIG, LOW);
  const unsigned long duration = pulseIn(CAPACITY_ECHO, HIGH, ECHO_TIMEOUT_US);
  const unsigned long mm = duration * 343UL / 2000UL;
#else
  pinMode(CAPACITY_GROVE_PIN, OUTPUT);
  digitalWrite(CAPACITY_GROVE_PIN, LOW); delayMicroseconds(2);
  digitalWrite(CAPACITY_GROVE_PIN, HIGH); delayMicroseconds(5); digitalWrite(CAPACITY_GROVE_PIN, LOW);
  pinMode(CAPACITY_GROVE_PIN, INPUT);
  const unsigned long duration = pulseIn(CAPACITY_GROVE_PIN, HIGH, ECHO_TIMEOUT_US);
  const unsigned long mm = duration * 10UL / 58UL;
#endif
  valid = duration != 0 && mm >= 2 && mm <= 5000;
  return valid ? (uint16_t)mm : 0;
}

// The bin program's fill sum: EMPTY = 0 %, FULL = 100 %, kept within 0-100.
int fillPercent(uint16_t mm) {
  long percent = ((long)BIN_EMPTY_MM - mm) * 100L / ((long)BIN_EMPTY_MM - BIN_FULL_MM);
  if (percent < 0) percent = 0;
  if (percent > 100) percent = 100;
  return (int)percent;
}

uint16_t lowest = 0xFFFF, highest = 0;
uint8_t readingsThisRound = 0;

void setup() {
  Serial.begin(9600);
#if CAPACITY_USE_HCSR04
  pinMode(CAPACITY_TRIG, OUTPUT); digitalWrite(CAPACITY_TRIG, LOW);
  pinMode(CAPACITY_ECHO, INPUT);
#endif
  Serial.println(F("Bin fill sensor calibration"));
  Serial.print(F("EMPTY = ")); Serial.print(BIN_EMPTY_MM);
  Serial.print(F(" mm, FULL = ")); Serial.print(BIN_FULL_MM); Serial.println(F(" mm"));
  if (BIN_EMPTY_MM <= BIN_FULL_MM) {
    Serial.println(F("!! BIN_EMPTY_MM must be bigger than BIN_FULL_MM (the sensor is at the top)."));
  }
}

void loop() {
  // The middle of three quick readings, as the bin program does.
  uint16_t r[3];
  uint8_t good = 0;
  for (uint8_t i = 0; i < 3; ++i) {
    bool valid = false;
    const uint16_t mm = measureMm(valid);
    if (valid) r[good++] = mm;
    delay(70); // let the echo die away
  }
  if (good < 3) {
    Serial.println(F("No echo: check the D6 wiring, and that the sensor faces into the bin."));
    delay(500);
    return;
  }
  if (r[0] > r[1]) { uint16_t t = r[0]; r[0] = r[1]; r[1] = t; }
  if (r[1] > r[2]) { uint16_t t = r[1]; r[1] = r[2]; r[2] = t; }
  if (r[0] > r[1]) { uint16_t t = r[0]; r[0] = r[1]; r[1] = t; }
  const uint16_t mm = r[1];

  if (mm < lowest) lowest = mm;
  if (mm > highest) highest = mm;

  Serial.print(F("Distance: ")); Serial.print(mm); Serial.print(F(" mm  ->  fill "));
  Serial.print(fillPercent(mm)); Serial.println(F(" %"));

  // Every 10 readings (about 3 s), show the spread, to see how steady it is.
  if (++readingsThisRound == 10) {
    Serial.print(F("   last 3 s: from ")); Serial.print(lowest);
    Serial.print(F(" to ")); Serial.print(highest); Serial.println(F(" mm"));
    lowest = 0xFFFF; highest = 0; readingsThisRound = 0;
  }
  delay(100);
}
