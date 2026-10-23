import { test } from "node:test";
import assert from "node:assert/strict";
import { testSketch, parseTestLine, KIND, PROMPTS } from "../../ui/js/wiring-test.js";

const uno = { name: "Arduino Uno R3" };

test("a traffic light test", () => {
  const { code, rows } = testSketch([
    { id: "red", type: "led", label: "red LED", pins: { anode: "12" } },
    { id: "r1", type: "resistor-220", pins: {} },
    { id: "btn", type: "button", label: "button", pins: { signal: "2" } },
    { id: "servo", type: "servo", pins: { signal: "9" } },
  ], uno);
  assert.deepEqual(rows.map((r) => [r.id, r.kind]), [["red", "output"], ["btn", "input"], ["servo", "output"]]);
  assert.match(code, /pinMode\(12, OUTPUT\);/);
  assert.match(code, /pinMode\(2, INPUT_PULLUP\);/);
  assert.match(code, /TEST:red:ON/);
  assert.match(code, /READ:btn:/);
  assert.match(code, /#include <Servo.h>/);
  assert.match(code, /case 1:/, "two outputs take turns");
  assert.match(code, /Serial\.begin\(115200\)/);
  // Balanced braces.
  assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length);
});

test("every part type with a test makes valid-looking code", () => {
  const pins = { anode: "D5", red: "D5", green: "D6", blue: "D7", positive: "D8", signal: "D6", wiper: "A0", x: "A0", y: "A0", sw: "D3",
    trig: "D1", echo: "D2", data: "D5", clk: "D5", dio: "D6", cs: "D8", din: "D6", sda: "D8", rst: "D0",
    r1: "9", r2: "8", r3: "7", r4: "6", c1: "5", c2: "4", c3: "3", c4: "2" };
  const parts = Object.keys(KIND).map((type, i) => ({ id: `p${i}`, type, pins }));
  const { code, rows } = testSketch(parts, { name: "NodeMCU" });
  assert.equal(rows.length, parts.length);
  assert.equal((code.match(/\{/g) || []).length, (code.match(/\}/g) || []).length);
  assert.equal((code.match(/\(/g) || []).length, (code.match(/\)/g) || []).length);
  for (const r of rows) if (r.kind === "input") assert.ok(PROMPTS[r.type], `${r.type} has a prompt`);
  assert.equal(code.split("#include <Wire.h>").length, 2, "includes once");
});

test("a part missing its pin is left out", () => {
  const { rows } = testSketch([{ id: "led1", type: "led", pins: {} }], uno);
  assert.equal(rows.length, 0);
});

test("protocol lines", () => {
  assert.deepEqual(parseTestLine("READ:pot:512\r"), { kind: "READ", id: "pot", value: "512" });
  assert.deepEqual(parseTestLine("TEST:red:ON"), { kind: "TEST", id: "red", value: "ON" });
  assert.deepEqual(parseTestLine("HELLO"), { kind: "HELLO" });
  assert.equal(parseTestLine("ets Jan  8 2013,rst cause:2"), null);
});
