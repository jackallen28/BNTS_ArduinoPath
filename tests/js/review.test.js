import { test } from "node:test";
import assert from "node:assert/strict";
import { review, stripCode } from "../../ui/js/review.js";

const ids = (code) => review(code).map((r) => r.id);

test("tidy code gets no suggestions", () => {
  const code = `#define LED_PIN 13
#define BUTTON_PIN 2
const int BLINK_MS = 500;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
}

void loop() {
  // pinMode(13, OUTPUT) in a comment is fine
  if (digitalRead(BUTTON_PIN) == LOW) {
    digitalWrite(LED_PIN, HIGH);
  }
  for (int i = 0; i < 3; i++) {
    delay(10);
  }
}
`;
  assert.deepEqual(review(code), []);
});

test("each suggestion", () => {
  assert.deepEqual(ids("void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}"), ["magic-pin"]);
  assert.ok(ids("void loop() {\n  delay(500);\n  delay(500);\n  delay(500);\n}").includes("magic-number"));
  const rep = "void loop() {\n" + "  digitalWrite(LED_RED, HIGH);\n".repeat(3) + "}";
  assert.ok(ids(rep).includes("repeated-code"));
  const block = "void loop() {\n  if (digitalRead(BUTTON_PIN) == LOW) {}\n  delay(2000);\n}";
  const r = review(block).find((x) => x.id === "blocking-delay");
  assert.equal(r.line, 3);
  assert.ok(ids("int x = 5;\nvoid setup() {}\nvoid loop() {}").includes("short-name"));
  const globals = Array.from({ length: 7 }, (_, i) => `int value${i} = 0;`).join("\n") + "\nvoid setup() {}\nvoid loop() {}";
  assert.ok(ids(globals).includes("global-state"));
});

test("comments and strings are ignored", () => {
  const s = stripCode('int a = 1; // pinMode(13)\nSerial.println("pinMode(13, OUTPUT)");\n/* x\n y */ b');
  assert.ok(!s.includes("pinMode(13"));
  assert.equal(s.split("\n").length, 4);
});
