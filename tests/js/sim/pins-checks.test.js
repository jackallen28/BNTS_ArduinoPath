// Pin roles, the {{pins}} header (the same as internal/content/pins.go), and checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { uno, esp32, nodemcu, boards, run } from "./helpers.js";
import { resolvePin, pinPlan, pinHeader, expandPins, boardConstants, rolesIn, projectSuits } from "../../../ui/js/sim/pins.js";
import { evaluate, stripComments } from "../../../ui/js/sim/checks.js";

const project = { pins: { all: { LED_PIN: "12" }, avr: { SERVO_PIN: "10" }, uno: { SERVO_PIN: "11" }, esp8266: { LED_GREEN: "D0" } } };

test("resolvePin: roles, codes, numbers, LED_BUILTIN, bus pins", () => {
  assert.deepEqual(resolvePin("LED_RED", uno), { code: "12", number: 12, label: "12" });
  assert.deepEqual(resolvePin("POT_PIN", uno), { code: "A0", number: 14, label: "A0" });
  assert.equal(resolvePin("A0", nodemcu).number, 17);
  assert.equal(resolvePin("D5", nodemcu).number, 14);
  assert.equal(resolvePin("LED_BUILTIN", nodemcu).number, 2);
  assert.equal(resolvePin("SDA", uno).number, 18);
  assert.equal(resolvePin(13, uno).number, 13);
  assert.equal(resolvePin("NOPE", uno), null);
});

test("project overrides: all, then family, then board id", () => {
  assert.equal(pinPlan(project, uno).LED_PIN, "12");
  assert.equal(pinPlan(project, uno).SERVO_PIN, "11");
  assert.equal(pinPlan(project, boards.nano).SERVO_PIN, "10");
  assert.equal(pinPlan(project, nodemcu).LED_GREEN, "D0");
  assert.equal(resolvePin("SERVO_PIN", boards.mega, project).number, 10);
});

test("pinHeader: roles in order of use, ANALOG_MAX when used (like the Go code)", () => {
  const code = "{{pins}}\n// uses BUZZER_PIN\nvoid setup() { pinMode(LED_PIN, OUTPUT); pinMode(BUZZER_PIN, OUTPUT); int v = analogRead(POT_PIN) * 180 / ANALOG_MAX; }";
  assert.equal(pinHeader(project, uno, code), "// Pins for your Arduino Uno R3 (from the Wiring Wizard)\n#define BUZZER_PIN 8\n#define LED_PIN 12\n#define POT_PIN A0\n#define ANALOG_MAX 1023\n");
  assert.match(pinHeader(project, esp32, code), /#define ANALOG_MAX 4095\n$/);
  assert.match(pinHeader(project, nodemcu, code), /#define LED_PIN 12\n/);
  const expanded = expandPins(code, project, nodemcu);
  assert.ok(expanded.startsWith("// Pins for your NodeMCU 1.0 (ESP8266) (from the Wiring Wizard)\n#define BUZZER_PIN D8\n"));
  assert.equal(expandPins("no pins here", project, uno), "no pins here");
  assert.deepEqual(rolesIn("LED_RED LED_RED HIGH POT_PIN", uno.pin_plan), ["LED_RED", "POT_PIN"]);
});

test("boardConstants and projectSuits", () => {
  assert.deepEqual(boardConstants(uno), { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, LED_BUILTIN: 13, SDA: 18, SCL: 19, MOSI: 11, MISO: 12, SCK: 13, SS: 10 });
  assert.equal(boardConstants(nodemcu).D8, 15);
  assert.ok(projectSuits({ boards: ["esp"] }, esp32));
  assert.ok(!projectSuits({ boards: ["esp"] }, uno));
  assert.ok(projectSuits({ boards: ["avr"] }, boards.mega));
  assert.ok(projectSuits({ boards: ["uno", "mega"] }, uno));
});

test("checks: code checks ignore comments", () => {
  const code = "// digitalWrite(13, HIGH)\nvoid setup() { pinMode(13,OUTPUT); blink(); }\nvoid blink() {}\n/* tone(8, 440) */";
  assert.equal(stripComments('a // b\n"// c" /* d */ e'), 'a \n"// c"         e');
  const res = evaluate([
    { type: "code_contains", text: "pinMode(13, OUTPUT)", label: "a" },
    { type: "code_contains", text: "digitalWrite", label: "b" },
    { type: "code_regex", pattern: "(?i)PINMODE", label: "c" },
    { type: "uses_function", name: "blink", label: "d" },
    { type: "uses_function", name: "tone", label: "e" },
    { type: "uses_function", name: "setup", label: "f" },
  ], { code, board: uno });
  assert.deepEqual(res.map((r) => r.ok), [true, false, true, true, false, false]);
});

test("checks: results of a run", () => {
  const code = `#include <Servo.h>
    #include <Adafruit_NeoPixel.h>
    Servo s; Adafruit_NeoPixel px(3, 6);
    void setup() { Serial.begin(9600); pinMode(LED_PIN, OUTPUT); s.attach(9); px.begin(); }
    void loop() { digitalWrite(LED_PIN, HIGH); delay(100); digitalWrite(LED_PIN, LOW); delay(100);
      analogWrite(5, 128); tone(8, 523); s.write(45); px.setPixelColor(0, 255, 0, 0); px.setPixelColor(2, 0, 0, 9); px.show(); Serial.println("Hi 42"); }`;
  const src = "#define LED_PIN 12\n" + code;
  const result = run(src, { ms: 1000 });
  const checks = [
    { type: "compiles" }, { type: "runs", ms: 900 },
    { type: "serial_contains", text: "Hi 42" }, { type: "serial_regex", pattern: "Hi \\d+\\n" },
    { type: "pin_seen", pin: "LED_PIN", value: "HIGH", times: 4 }, { type: "pin_seen", pin: "12", value: "LOW", times: 99 },
    { type: "pwm_seen", pin: "5", min: 100, max: 150 }, { type: "tone_seen", pin: "BUZZER_PIN", min_hz: 500, max_hz: 600 },
    { type: "servo_angle", pin: "SERVO_PIN", angle: 46, tolerance: 2 }, { type: "neopixel_lit", pin: "NEOPIXEL_PIN", count: 2 },
    { type: "neopixel_lit", count: 3 }, { type: "display_text", text: "Hi" },
    { type: "run_count", min: 2 }, { type: "confirm", label: "I saw it" }, { type: "mystery" },
  ];
  const res = evaluate(checks, { code: src, board: uno, project: { pins: { avr: { LED_PIN: "12" } } }, result, runs: 2, confirmed: ["I saw it"] });
  assert.deepEqual(res.map((r) => r.ok), [true, true, true, true, true, false, true, true, true, true, false, false, true, true, false]);
  const failed = evaluate([{ type: "compiles" }, { type: "runs" }], { code: "", board: uno, result: { ok: false, errors: [{ line: 1, col: 1, message: "x" }], events: [] } });
  assert.deepEqual(failed.map((r) => r.ok), [false, false]);
});
