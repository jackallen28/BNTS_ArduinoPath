import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutCircuit, apply, wireColor, wirePath, stepState, stepCount, boardPlace, boxOf } from "../../../ui/js/circuit/layout.js";
import { layoutSchematic } from "../../../ui/js/circuit/schematic.js";
import { oledPixel, oledPath, lcdPaths, segmentsOn, matrixDot } from "../../../ui/js/circuit/display.js";
import { glyph } from "../../../ui/js/circuit/font5x7.js";
import { demoCircuit } from "../../../ui/js/circuit/demo-circuit.js";
import { catalogue, boards, projects, supports } from "./helpers.js";

const parts = catalogue();
const allBoards = boards();
const uno = allBoards.find((b) => b.id === "uno");
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.6, `${msg}: ${a} vs ${b}`);

test("parts sit with their legs in the right holes", () => {
  const L = layoutCircuit({ board: uno, circuit: demoCircuit, parts });
  const holes = parts.breadboard.holes;
  for (const { part, def, matrix } of L.parts) {
    if (!part.at) continue;
    const first = def.breadboard.connectors[def.legs[0].id];
    const p = apply(matrix, first.x, first.y);
    near(p.x, holes[part.at].x, `${part.id} x`);
    near(p.y, holes[part.at].y, `${part.id} y`);
  }
  const r1 = L.parts.find((p) => p.part.id === "r1");
  const leg2 = r1.def.breadboard.connectors["2"];
  const p = apply(r1.matrix, leg2.x, leg2.y);
  near(p.x, holes.G5.x, "rotated resistor x");
  near(p.y, holes.G5.y, "rotated resistor y");
  assert.deepEqual(L.problems, []);
  assert.equal(L.wires.length, demoCircuit.wires.length);
  // Everything fits in the drawing.
  for (const w of L.wires) {
    for (const e of [w.a, w.b]) {
      assert.ok(e.x >= L.bounds.x && e.x <= L.bounds.x + L.bounds.w && e.y >= L.bounds.y && e.y <= L.bounds.y + L.bounds.h, "wire end inside");
    }
  }
});

test("wires start at the board pin and end in the hole", () => {
  const L = layoutCircuit({ board: uno, circuit: demoCircuit, parts });
  const w = L.wires.find((x) => x.wire.from === "pin:LED_RED");
  const art = parts.boards.uno.breadboard.pins["12"];
  const p = apply(L.board.matrix, art.x, art.y);
  near(w.a.x, p.x, "pin x"); near(w.a.y, p.y, "pin y");
  near(w.b.x, parts.breadboard.holes.J6.x, "hole x");
  assert.deepEqual(w.a.dir, [0, -1], "the Uno's digital pins are on its top edge");
  assert.ok(w.d.startsWith("M") && w.d.includes("C"));
});

test("tall boards are turned on their side, left of the breadboard", () => {
  for (const id of ["nano", "nodemcu", "esp32", "esp32-c3", "d1-mini"]) {
    const art = parts.boards[id];
    const m = boardPlace(art, parts.breadboard);
    const box = boxOf(m, art.breadboard.width, art.breadboard.height);
    assert.ok(box.w >= box.h, `${id} lies flat`);
    assert.ok(box.x + box.w < 0, `${id} is left of the breadboard`);
  }
});

test("every project lays out on every board it lists", () => {
  for (const project of projects()) {
    for (const board of allBoards.filter((b) => supports(project, b))) {
      const L = layoutCircuit({ board, circuit: project.circuit, parts, pins: (project.pins && project.pins[board.family]) || {} });
      assert.ok(L.bounds.w > 0 && L.bounds.h > 0);
      assert.ok(L.bounds.w < 1400 && L.bounds.h < 1100, `${project.id} on ${board.id} stays a sensible size (${L.bounds.w}×${L.bounds.h})`);
    }
  }
});

test("wire colours", () => {
  assert.equal(wireColor({ from: "board:GND", to: "BN1" }), "black");
  assert.equal(wireColor({ from: "board:VCC", to: "BP1" }), "red");
  assert.equal(wireColor({ from: "A5", to: "BN3" }), "black");
  assert.equal(wireColor({ from: "pin:LED_GREEN", to: "J6" }), "green");
  assert.equal(wireColor({ from: "pin:LED_RED", to: "J6" }), "orange", "red means power");
  assert.equal(wireColor({ from: "pin:X", to: "J6", color: "purple" }), "purple");
  assert.equal(wireColor({ from: "part:servo:gnd", to: "BN3" }), "black");
});

test("wire paths leave in their direction", () => {
  assert.equal(wirePath({ x: 0, y: 0, dir: [0, -1] }, { x: 100, y: 0, dir: [0, -1] }), "M0 0C0 -40 100 -40 100 0");
});

test("steps: current, earlier, later", () => {
  assert.equal(stepState(2, 2, false), "current");
  assert.equal(stepState(1, 2, false), "earlier");
  assert.equal(stepState(3, 2, false), "later");
  assert.equal(stepState(3, 2, true), "normal");
  assert.equal(stepState(undefined, 2, false), "normal");
  assert.equal(stepCount(demoCircuit), 7);
});

test("the schematic chains pin → LED → resistor in one row", () => {
  const L = layoutSchematic({ board: uno, circuit: demoCircuit, parts });
  const red = L.symbols.find((s) => s.id === "red"), r1 = L.symbols.find((s) => s.id === "r-red" ) || L.symbols.find((s) => s.id === "r1");
  assert.ok(red && r1);
  assert.ok(r1.x > red.x, "the resistor is right of the LED");
  near(red.legsAbs.anode.y, r1.legsAbs[r1.enter].y, "level");
  assert.equal(red.legsAbs.anode.dir, "left", "the LED's anode faces the board");
  assert.ok(L.pins.some((p) => p.code === "12"));
  assert.ok(L.power.some((p) => p.part === "r1" && p.kind === "gnd"));
  assert.ok(L.power.some((p) => p.part === "pot" && p.kind === "vcc" && p.name === "5V"));
  // A button's joined legs show once.
  assert.ok(!L.lines.some((ln) => ln.legs.some((l) => l.part === "b1" && l.leg === "1b")));
});

test("OLED buffers in SSD1306 page order and one byte per pixel", () => {
  const page = new Uint8Array(128 * 64 / 8);
  page[5 + 128 * 1] = 0b100; // x=5, y=8+2
  assert.ok(oledPixel(page, 128, 64, 5, 10));
  assert.ok(!oledPixel(page, 128, 64, 5, 9));
  const bytes = new Uint8Array(128 * 64);
  bytes[10 * 128 + 5] = 1;
  assert.ok(oledPixel(bytes, 128, 64, 5, 10));
  const d = oledPath(page, 128, 64, { x: 0, y: 0, w: 128, h: 64 });
  assert.equal(d, "M5 10h1v1h-1z");
  assert.equal(oledPath([], 128, 64, { x: 0, y: 0, w: 1, h: 1 }), "");
});

test("LCD text uses the 5×7 font", () => {
  assert.deepEqual(glyph("A"), [0x7e, 0x11, 0x11, 0x11, 0x7e]);
  assert.deepEqual(glyph("0"), [0x3e, 0x51, 0x49, 0x45, 0x3e]);
  assert.deepEqual(glyph("~").length, 5);
  const blank = lcdPaths(["", ""], 16, 2, { x: 0, y: 0, w: 160, h: 40 });
  assert.equal(blank.on, "");
  const hi = lcdPaths(["Hi"], 16, 2, { x: 0, y: 0, w: 160, h: 40 });
  // H has 7+1+1+1+7 = 17 dots; i (0x00,0x44,0x7d,0x40,0x00) has 2+6+1 = 9
  assert.equal((hi.on.match(/M/g) || []).length, 17 + 9);
});

test("7-segment and matrix bits", () => {
  assert.equal(segmentsOn(0x3f), "abcdef"); // 0
  assert.equal(segmentsOn(0x06), "bc"); // 1
  assert.equal(segmentsOn(0x80), ""); // the colon bit isn't a segment
  assert.ok(matrixDot([0x80], 0, 0));
  assert.ok(matrixDot([0, 0x01], 1, 7));
  assert.ok(!matrixDot([0x01], 0, 0));
});
