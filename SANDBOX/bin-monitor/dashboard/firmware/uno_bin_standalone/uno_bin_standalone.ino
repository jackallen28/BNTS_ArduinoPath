// =====================================================================
//  BNTS smart bin: Arduino Uno program (one file, nothing else needed)
// =====================================================================
//  The Uno runs the whole bin. The ESP32-C3 only shows its readings on a
//  web page, so the bin keeps working with or without Wi-Fi.
//
//  What it does:
//   - A hand within 30 cm of the hand sensor opens the lid for 5 s.
//   - Then the servo sweeps the lid shut until the closed button presses.
//   - A sensor inside the bin measures how full it is (0-100 %).
//   - Every half second it sends the readings to the ESP32-C3 on TX (D1).
//
//  Wiring (Uno pin -> part):
//   D2  closed button (HIGH when the lid is shut: button to 5 V, 10k to GND)
//   D3  servo signal (servo power from a separate 5 V supply, GND shared)
//   D6  Grove ultrasonic SIG, inside the bin (fill level)
//   D7  Grove ultrasonic SIG, facing out (hand detection)
//   D8  LED, through a 220 ohm resistor (on while the lid moves)
//   D1/TX -> 2.2k -> ESP32-C3 GPIO4, and GPIO4 -> 3.3k -> GND.
//         NEVER connect Uno TX straight to the C3: 5 V damages it.
//   GND -> ESP32-C3 GND (the boards must share ground)
//
//  Upload with board "Arduino Uno". Unplug the wire on D1 if an upload
//  fails, then plug it back in afterwards. The Serial Monitor (115200)
//  shows the readings sent to the ESP32-C3: @{...}*1A2B
// =====================================================================

#include <Servo.h>
#include <stdio.h>

// ---------------- Settings to change ----------------

// The lid. OPEN_ANGLE is where the servo goes to open the lid. To close,
// it sweeps from OPEN_ANGLE towards 180 until the closed button presses.
// If the lid opens too far, make OPEN_ANGLE bigger (closer to the closed angle).
const int OPEN_ANGLE = 0;
const int FALLBACK_CLOSED_ANGLE = 90;  // used if the button never presses
const unsigned long OPEN_TIME_MS = 5000;   // how long the lid stays open
const unsigned long REST_TIME_MS = 2000;   // pause after closing
const int HAND_DISTANCE_CM = 30;           // a hand closer than this opens it

// The fill level: distance from the sensor inside the bin, in mm.
// Measure them with bin_calibration.ino. EMPTY must be bigger than FULL.
// Measured on the bin: 203-210 mm when empty, 5-9 mm when full. Anything
// at or beyond BIN_EMPTY_MM reads 0 %, anything at or under BIN_FULL_MM 100 %.
const int BIN_EMPTY_MM = 203;  // the bin is empty (0 %)
const int BIN_FULL_MM = 9;     // the bin is full (100 %)
const int FILL_MIN_MM = 2;     // closer than this is a bad reading

// ---------------- Pins ----------------
const int BUTTON_PIN = 2;
const int SERVO_PIN = 3;
const int FILL_SENSOR_PIN = 6;
const int HAND_SENSOR_PIN = 7;
const int LED_PIN = 8;

// ---------------- The lid's states ----------------
enum LidState { CLOSING, SETTLING, RESTING, READY, OPEN };
LidState state = CLOSING;
unsigned long stateStartedMs = 0;  // when the current state started
unsigned long lastSweepStepMs = 0;
int servoAngle = OPEN_ANGLE;
bool lidFault = false;      // the button didn't press, or didn't let go
bool restAfterClose = false; // false only for the first close at power-up
bool releaseChecked = false; // the button's let-go check after opening

Servo lidServo;

// ---------------- Sensors ----------------
unsigned long lastPingMs = 0;
bool pingHandNext = true;
bool handSensorOk = false;
unsigned long lastHandReadingMs = 0;

int fillReadings[3];
int fillReadingCount = 0;
int fillPercent = 0;
bool fillOk = false;
bool haveFill = false;
unsigned long lastFillMs = 0;
unsigned long closedAtMs = 0;

// ---------------- Readings for the ESP32-C3 ----------------
unsigned long lastSendMs = 0;
unsigned long sequence = 0;

// Grove ultrasonic: one pin sends the ping and hears the echo.
// Returns the echo time in microseconds (0 = no echo).
unsigned long pingGrove(int pin) {
  pinMode(pin, OUTPUT);
  digitalWrite(pin, LOW);
  delayMicroseconds(2);
  digitalWrite(pin, HIGH);
  delayMicroseconds(5);
  digitalWrite(pin, LOW);
  pinMode(pin, INPUT);
  return pulseIn(pin, HIGH, 30000);  // wait at most 30 ms
}

// The fill can't be measured while the lid is open or moving.
void forgetFill() {
  fillOk = false;
  fillReadingCount = 0;
}

void startClosing() {
  state = CLOSING;
  stateStartedMs = lastSweepStepMs = millis();
  servoAngle = OPEN_ANGLE;
  if (!lidServo.attached()) lidServo.attach(SERVO_PIN);
  lidServo.write(servoAngle);
  digitalWrite(LED_PIN, HIGH);
  forgetFill();
}

void openLid() {
  state = OPEN;
  stateStartedMs = millis();
  releaseChecked = false;
  servoAngle = OPEN_ANGLE;
  lidServo.attach(SERVO_PIN);
  lidServo.write(servoAngle);
  digitalWrite(LED_PIN, HIGH);
  forgetFill();
}

void updateLid() {
  const unsigned long now = millis();
  const unsigned long inState = now - stateStartedMs;
  const bool closedButton = digitalRead(BUTTON_PIN) == HIGH;

  switch (state) {
    case CLOSING:
      // One degree every 15 ms, checking the button after each step.
      if (now - lastSweepStepMs >= 15) {
        lastSweepStepMs = now;
        if (closedButton) {
          lidFault = false;
          state = SETTLING;
          stateStartedMs = now;
        } else if (servoAngle < 180) {
          servoAngle++;
          lidServo.write(servoAngle);
        } else {
          // Swept all the way without the button pressing.
          servoAngle = FALLBACK_CLOSED_ANGLE;
          lidServo.write(servoAngle);
          lidFault = true;
          state = SETTLING;
          stateStartedMs = now;
        }
      }
      break;

    case SETTLING:
      // Hold the closed position for 300 ms, then let the servo go limp.
      if (inState >= 300) {
        lidServo.detach();
        digitalWrite(LED_PIN, LOW);
        closedAtMs = now;
        state = restAfterClose ? RESTING : READY;
        restAfterClose = true;
        stateStartedMs = now;
      }
      break;

    case RESTING:
      if (inState >= REST_TIME_MS) {
        state = READY;
        stateStartedMs = now;
      }
      break;

    case READY:
      break;  // the hand sensor opens the lid (in readSensors)

    case OPEN:
      // After 400 ms the button should have let go: if not, the lid is stuck.
      if (inState >= 400 && !releaseChecked) {
        releaseChecked = true;
        if (closedButton) lidFault = true;
      }
      if (inState >= OPEN_TIME_MS) startClosing();
      break;
  }
}

void readHandSensor() {
  const unsigned long duration = pingGrove(HAND_SENSOR_PIN);
  const long cm = duration / 29 / 2;
  handSensorOk = duration != 0 && cm >= 1;
  lastHandReadingMs = millis();
  if (handSensorOk && cm <= HAND_DISTANCE_CM) openLid();
}

void readFillSensor() {
  const unsigned long duration = pingGrove(FILL_SENSOR_PIN);
  const long mm = duration * 10 / 58;
  if (duration == 0 || mm < FILL_MIN_MM || mm > 600) {
    forgetFill();  // no echo, or a silly distance: keep the last good fill
    return;
  }
  // Use the middle of the last three readings, to ignore odd ones.
  fillReadings[fillReadingCount % 3] = (int)mm;
  fillReadingCount++;
  if (fillReadingCount < 3) return;
  if (fillReadingCount >= 6) fillReadingCount = 3;
  int a = fillReadings[0], b = fillReadings[1], c = fillReadings[2];
  const int middle = max(min(a, b), min(max(a, b), c));

  long percent = (long)(BIN_EMPTY_MM - middle) * 100 / (BIN_EMPTY_MM - BIN_FULL_MM);
  fillPercent = constrain(percent, 0L, 100L);
  fillOk = haveFill = true;
  lastFillMs = millis();
}

void readSensors() {
  const unsigned long now = millis();
  // The two sensors take turns, 100 ms apart, so they don't hear each other.
  if (now - lastPingMs < 100) return;
  const bool lidShut = (state == READY || state == RESTING) &&
                       digitalRead(BUTTON_PIN) == HIGH && now - closedAtMs >= 750;
  if (pingHandNext && state == READY) {
    lastPingMs = now;
    readHandSensor();
  } else if (!pingHandNext && lidShut) {
    lastPingMs = now;
    readFillSensor();
  } else if (!lidShut) {
    forgetFill();
  }
  pingHandNext = !pingHandNext;
}

// Sends one line to the ESP32-C3:  @{"fill":50,...}*1A2B
// The 4 hex digits are a CRC-16 check, so the C3 ignores damaged lines.
void sendReadings() {
  const unsigned long now = millis();
  if (now - lastSendMs < 500) return;
  lastSendMs = now;
  if (fillOk && now - lastFillMs > 2500) forgetFill();  // too old to trust

  const bool lidOpen = state == OPEN;
  const bool lidMoving = state == CLOSING || state == SETTLING || (state == OPEN && now - stateStartedMs < 400);
  const bool handOk = handSensorOk && now - lastHandReadingMs <= 1000;
  const unsigned long ageMs = haveFill ? now - lastFillMs : 4294967295UL;

  char json[200];
  const int length = snprintf(json, sizeof json,
      "{\"fill\":%d,\"lidOpen\":%s,\"sensorOk\":%s,\"ageMs\":%lu,\"seq\":%lu,"
      "\"approachOk\":%s,\"lidMoving\":%s,\"closedSwitch\":%s,\"lidFault\":%s,\"homing\":%s}",
      fillPercent, lidOpen ? "true" : "false", fillOk ? "true" : "false", ageMs, sequence++,
      handOk ? "true" : "false", lidMoving ? "true" : "false",
      digitalRead(BUTTON_PIN) == HIGH ? "true" : "false", lidFault ? "true" : "false",
      state == CLOSING ? "true" : "false");
  if (length <= 0 || length >= (int)sizeof json) return;

  // CRC-16/CCITT-FALSE of the JSON text.
  unsigned int crc = 0xFFFF;
  for (int i = 0; i < length; i++) {
    crc ^= (unsigned int)(unsigned char)json[i] << 8;
    for (int bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  char ending[8];
  snprintf(ending, sizeof ending, "*%04X\n", crc);
  Serial.print("@");
  Serial.print(json);
  Serial.print(ending);
}

void setup() {
  pinMode(BUTTON_PIN, INPUT);  // the 10k resistor to GND holds it LOW
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
  startClosing();  // find the closed position at power-up
}

void loop() {
  updateLid();
  readSensors();
  sendReadings();
}
