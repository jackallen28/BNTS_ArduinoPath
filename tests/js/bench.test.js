import { test } from "node:test";
import assert from "node:assert/strict";
import { Bench } from "../../ui/js/bench.js";
import { pinOverrides, defaultResolvePin } from "../../ui/js/circuit/netlist.js";
import { testSketch } from "../../ui/js/wiring-test.js";
import { runHeadless } from "../../ui/js/sim/headless.js";
import { expandPins } from "../../ui/js/sim/pins.js";
import { catalogue, boards, projects, supports } from "./circuit/helpers.js";

const parts = catalogue();
const allBoards = boards();
const board = (id) => allBoards.find((b) => b.id === id);
const project = (id) => projects().find((p) => p.id === id);
const benchFor = (pid, bid) => {
  const p = project(pid), b = board(bid);
  return new Bench({ board: b, circuit: p.circuit, parts, pins: defaultResolvePin(b, pinOverrides(p.pins, b)) });
};

test("an LED lights when its pin is HIGH and its − leg reaches GND through the resistor", () => {
  const bench = benchFor("blink-traffic-lights", "uno");
  let { state } = bench.apply([{ type: "pinMode", pin: 12, mode: "OUTPUT" }, { type: "digital", pin: 12, value: 1 }]);
  assert.deepEqual(state.led, { red: 1, yellow: 0, green: 0 });
  ({ state } = bench.apply([{ type: "pwm", pin: 11, value: 51 }]));
  assert.equal(state.led.yellow, 0.2);
  ({ state } = bench.apply([{ type: "digital", pin: 12, value: 0 }]));
  assert.equal(state.led.red, 0);
  // Other events don't touch the LEDs.
  assert.equal(bench.apply([{ type: "serial", text: "hi" }]).state.led, undefined);
});

test("the same circuit on an ESP32 follows its own pins", () => {
  const bench = benchFor("blink-traffic-lights", "esp32");
  const red = bench.testParts().find((p) => p.id === "red");
  const n = board("esp32").pins.find((p) => p.code === red.pins.anode).number;
  assert.equal(bench.apply([{ type: "digital", pin: n, value: 1 }]).state.led.red, 1);
});

test("a button joins its pin to GND while pressed", () => {
  const bench = benchFor("button-night-light", "uno");
  assert.deepEqual(bench.allInputs().digital, { 2: null });
  assert.deepEqual(bench.control("b1", "press", true).inputs.digital, { 2: 0 });
  assert.deepEqual(bench.control("b1", "press", false).inputs.digital, { 2: null });
});

test("pots, light sensors, distance, weather and motion become inputs", () => {
  let bench = benchFor("servo-dial", "uno");
  assert.deepEqual(bench.control("pot", "position", 1).inputs, { analog: { 14: 1023 } });
  assert.deepEqual(bench.control("pot", "position", 0.25).inputs, { analog: { 14: 256 } });
  const servo = bench.apply([{ type: "servo", pin: 9, angle: 45 }]).state.servo;
  assert.deepEqual(servo, { servo: 45 });

  bench = benchFor("light-theremin", "uno");
  const dark = bench.control("ldr", "light", 0).inputs.analog[15];
  const bright = bench.control("ldr", "light", 1).inputs.analog[15];
  assert.ok(bright > dark, "brighter light reads higher");
  const { state, tones } = bench.apply([{ type: "tone", pin: 8, freq: 440 }]);
  assert.deepEqual(state.buzzer, { bz: 440 });
  assert.deepEqual(tones, { bz: 440 });
  assert.deepEqual(bench.apply([{ type: "stopped" }]).tones, { bz: 0 });

  bench = benchFor("parking-sensor", "esp32");
  const echo = bench.testParts().find((p) => p.id === "sonar").pins.echo;
  const echoN = board("esp32").pins.find((p) => p.code === echo).number;
  assert.deepEqual(bench.control("sonar", "distance", 20).inputs, { pulse: { [echoN]: 1160 } }, "through the divider");

  bench = benchFor("weather-station", "uno");
  assert.deepEqual(bench.control("dht", "t", 30).inputs, { dht: { 4: { t: 30, h: 45 } } });
  bench = benchFor("motion-alarm", "uno");
  assert.deepEqual(bench.control("pir", "motion", true).inputs, { digital: { 7: 1 } });
  bench = benchFor("keypad-safe", "uno");
  assert.deepEqual(bench.control("keys", "key", "5"), { key: "5" });
  bench = benchFor("rfid-door", "uno");
  assert.deepEqual(bench.control("rfid", "card", [1, 2, 3, 4]), { card: [1, 2, 3, 4] });
});

test("displays and pixels", () => {
  let bench = benchFor("digital-dice", "uno");
  assert.deepEqual(bench.apply([{ type: "tm1637", clk: 6, dio: 7, segments: [6, 91, 79, 102] }]).state.tm1637, { disp: [6, 91, 79, 102] });
  bench = benchFor("joystick-snake", "uno");
  assert.deepEqual(bench.apply([{ type: "matrix", cs: 10, rows: [1, 0x80] }]).state.matrix, { matrix: [0x80, 1] });
  bench = benchFor("keypad-safe", "uno");
  assert.deepEqual(bench.apply([{ type: "lcd", lines: ["Hi", ""], backlight: true }]).state.lcd, { lcd: { lines: ["Hi", ""], backlight: true } });
  bench = benchFor("neopixel-mood-lamp", "uno");
  assert.deepEqual(bench.apply([{ type: "neopixel", pin: 6, pixels: [[1, 2, 3]] }]).state.neopixel, { ring: [[1, 2, 3]] });
});

test("every project's parts get their pins for the wiring test", () => {
  for (const p of projects()) {
    for (const b of allBoards.filter((x) => supports(p, x))) {
      const bench = new Bench({ board: b, circuit: p.circuit, parts, pins: defaultResolvePin(b, pinOverrides(p.pins, b)) });
      const { rows } = testSketch(bench.testParts(), b);
      const testable = p.circuit.parts.filter((x) => !x.type.startsWith("resistor") && (!x.when || x.when === (b.power.vcc === "3V3" ? "3v3" : "5v")));
      assert.equal(rows.length, testable.length, `${p.id} on ${b.id}: ${rows.map((r) => r.id)}`);
    }
  }
});

test("the blink demo, run headless, lights the red LED on the drawing", () => {
  const p = project("blink-traffic-lights"), b = board("uno");
  const bench = new Bench({ board: b, circuit: p.circuit, parts, pins: pinOverrides(p.pins, b) });
  const src = expandPins(p.steps[0].demo, p, b);
  const r = runHeadless(src, { board: b, ms: 1500, project: p });
  assert.ok(r.ok);
  let max = 0;
  for (const ev of r.events) max = Math.max(max, bench.apply([ev]).state.led?.red ?? 0);
  assert.equal(max, 1);
});

test("soil sensors read higher when the soil is drier", () => {
  const bench = benchFor("plant-buddy", "uno");
  const dry = bench.control("soil", "moisture", 0).inputs.analog[16];
  const wet = bench.control("soil", "moisture", 1).inputs.analog[16];
  assert.ok(dry > 850 && wet < 320, `${dry} ${wet}`);
});
