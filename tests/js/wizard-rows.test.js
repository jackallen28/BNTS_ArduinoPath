import { test } from "node:test";
import assert from "node:assert/strict";
import { TestRows, wizardPages, FIXES } from "../../ui/js/wizard-rows.js";
import { KIND } from "../../ui/js/wiring-test.js";
import { projects } from "./circuit/helpers.js";

const rows = () => new TestRows([
  { id: "red", label: "red LED", type: "led", kind: "output" },
  { id: "b1", label: "button", type: "button", kind: "input", prompt: "Press the button." },
  { id: "pot", label: "knob", type: "potentiometer", kind: "input" },
  { id: "dht", label: "DHT", type: "dht", kind: "input" },
]);

test("outputs need the student's tick; inputs tick themselves when used", () => {
  const r = rows();
  r.feed("HELLO\r\nTEST:red:ON\r\nREAD:b1:1\r\nREAD:pot:500\r\nREAD:dht:none\r\n");
  assert.ok(r.hello);
  assert.ok(r.row("red").signal && !r.row("red").ok);
  assert.ok(!r.row("b1").ok, "the first reading is just where it starts");
  assert.ok(!r.row("dht").ok, "no reading yet");
  r.feed("READ:b1:0\r\nREAD:pot:530\r\nREA");
  assert.ok(r.row("b1").ok);
  assert.ok(!r.row("pot").ok, "a little jitter isn't a turn");
  r.feed("D:pot:900\nREAD:dht:23.0,45\n");
  assert.ok(r.row("pot").ok);
  assert.equal(r.row("pot").level, 900 / 1023);
  assert.ok(r.row("dht").ok);
  assert.ok(!r.allOk);
  r.confirm("red");
  assert.ok(r.allOk);
  r.restart();
  assert.ok(r.row("red").ok, "confirmed outputs stay confirmed");
  assert.ok(!r.row("b1").ok, "inputs are tested again");
  r.feed("garbage\nets Jan  8 2013\n");
  assert.ok(!r.row("b1").ok);
});

test("pages: meet each kind of part, each wiring step, then the test", () => {
  const p = projects().find((x) => x.id === "blink-traffic-lights");
  assert.deepEqual(wizardPages(p).map((x) => x.kind + (x.type || x.step || "")), ["meetled", "meetresistor-220", "wire1", "wire2", "wire3", "test"]);
  assert.deepEqual(wizardPages(p, ["yellow"]).map((x) => x.kind + (x.type || x.step || "")), ["meetled", "wire2", "test"]);
  const chat = projects().find((x) => x.id === "serial-chatbot");
  assert.deepEqual(wizardPages(chat).map((x) => x.kind), ["wire", "test"]);
});

test("every testable part type has fix-it tips", () => {
  for (const type of Object.keys(KIND)) assert.ok(FIXES[type]?.length, type);
});
