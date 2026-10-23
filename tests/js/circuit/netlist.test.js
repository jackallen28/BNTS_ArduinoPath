import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNetlist, validateCircuit, legHoles, stripOf, parseEndpoint, defaultResolvePin, pinOverrides,
  rotateOffset, holeAt, activeItems, powerName,
} from "../../../ui/js/circuit/netlist.js";
import { catalogue, boards, projects, supports } from "./helpers.js";

const parts = catalogue();
const allBoards = boards();
const uno = allBoards.find((b) => b.id === "uno");
const esp32 = allBoards.find((b) => b.id === "esp32");
const nodemcu = allBoards.find((b) => b.id === "nodemcu");

test("hole names, strips and endpoints", () => {
  assert.equal(stripOf("A12"), "col:12:a");
  assert.equal(stripOf("E12"), "col:12:a");
  assert.equal(stripOf("F12"), "col:12:f");
  assert.equal(stripOf("TP3"), "rail:TP");
  assert.equal(stripOf("K1"), null);
  assert.equal(stripOf("A31"), null);
  assert.deepEqual(parseEndpoint("pin:LED_RED"), { kind: "pin", name: "LED_RED" });
  assert.deepEqual(parseEndpoint("board:VCC"), { kind: "power", name: "VCC" });
  assert.deepEqual(parseEndpoint("part:servo:signal"), { kind: "part", part: "servo", leg: "signal" });
  assert.deepEqual(parseEndpoint("BN25"), { kind: "hole", hole: "BN25" });
  assert.equal(parseEndpoint("board:12V"), null);
});

test("rotation turns clockwise on screen", () => {
  assert.deepEqual(rotateOffset([4, 0], 90), [-0, 4]);
  assert.deepEqual(rotateOffset([4, 0], 270), [0, -4]);
  assert.deepEqual(rotateOffset([1, 2], 180), [-1, -2]);
});

test("the breadboard has every hole, a 0.1\" pitch and rails in order", () => {
  const h = parts.breadboard.holes;
  assert.equal(Object.keys(h).length, 400);
  assert.equal(Math.round(h.A2.x - h.A1.x), 10);
  assert.ok(h.J1.y < h.F1.y && h.F1.y < h.E1.y && h.E1.y < h.A1.y, "J at the top, A at the bottom");
  assert.ok(h.TN1.y < h.TP1.y && h.TP1.y < h.J1.y && h.A1.y < h.BN1.y && h.BN1.y < h.BP1.y);
  assert.equal(holeAt(parts.breadboard, h.C7.x + 1, h.C7.y - 1), "C7");
  assert.equal(holeAt(parts.breadboard, h.C7.x + 5, h.C7.y), null);
});

test("pins resolve through the pin plan, bus names and overrides", () => {
  const r = defaultResolvePin(uno);
  assert.deepEqual(r("LED_RED"), { code: "12" });
  assert.deepEqual(r("SDA"), { code: "A4" });
  assert.deepEqual(r("LED_BUILTIN"), { code: "13" });
  assert.deepEqual(r("A0"), { code: "A0" });
  assert.equal(r("NOPE"), null);
  const over = pinOverrides({ avr: { SERVO_PIN: "10" }, all: { LED_PIN: "7" } }, uno);
  assert.deepEqual(over, { LED_PIN: "7", SERVO_PIN: "10" });
  assert.deepEqual(defaultResolvePin(uno, over)("SERVO_PIN"), { code: "10" });
  assert.equal(powerName(esp32, "5V"), "VIN");
  assert.equal(powerName(uno, "VCC"), "5V");
  assert.equal(powerName(nodemcu, "VCC"), "3V3");
});

const ledCircuit = {
  breadboard: "half",
  parts: [
    { id: "red", type: "led", color: "red", at: "H5", step: 1 },
    { id: "r1", type: "resistor-220", at: "E5", rotate: 270, step: 1 },
    { id: "b1", type: "button", at: "F14", step: 2 },
  ],
  wires: [
    { from: "board:GND", to: "BN1", step: 1 },
    { from: "pin:LED_RED", to: "J6", step: 1 },
    { from: "A5", to: "BN5", step: 1 },
    { from: "pin:BUTTON_PIN", to: "J14", step: 2 },
    { from: "A16", to: "BN14", step: 2 },
  ],
};

test("legs land in holes from the footprint and rotation", () => {
  assert.deepEqual(legHoles(ledCircuit.parts[0], parts.types.led, parts.breadboard).holes, { cathode: "H5", anode: "H6" });
  assert.deepEqual(legHoles(ledCircuit.parts[1], parts.types["resistor-220"], parts.breadboard).holes, { 1: "E5", 2: "G5" });
  assert.deepEqual(legHoles(ledCircuit.parts[2], parts.types.button, parts.breadboard).holes, { "1a": "F14", "1b": "E14", "2a": "F16", "2b": "E16" });
});

test("the netlist joins strips, rails, wires and legs, but not across resistors or buttons", () => {
  const n = buildNetlist(ledCircuit, uno, parts);
  assert.deepEqual(n.pinsForLeg("red", "anode"), ["12"]);
  assert.ok(n.joined("leg:red:cathode", "leg:r1:2"), "the LED and resistor share column 5 (F–J)");
  assert.ok(!n.joined("leg:r1:1", "leg:r1:2"), "a resistor isn't a wire");
  assert.deepEqual(n.powerForLeg("r1", "1"), ["GND"], "A5 → the − rail → GND");
  assert.ok(n.joined("leg:b1:1a", "leg:b1:1b"), "a button's legs on one side are joined inside it");
  assert.ok(!n.joined("leg:b1:1a", "leg:b1:2a"), "the switch itself is open (the bench closes it)");
  assert.deepEqual(n.pinsForLeg("b1", "1b"), ["2"]);
  assert.deepEqual(n.powerForLeg("b1", "2b"), ["GND"]);
  assert.deepEqual(n.legsOnNet(n.pinNet("12")), [{ part: "red", leg: "anode" }]);
  assert.equal(n.legHoles.red.anode, "H6");
});

test("a good circuit has no problems", () => {
  assert.deepEqual(validateCircuit(ledCircuit, uno, parts), []);
});

test("validation finds mistakes", () => {
  const codes = (c, board = uno) => validateCircuit(c, board, parts).map((p) => p.code);
  const base = (extra) => ({ breadboard: "half", parts: [], wires: [], ...extra });
  assert.ok(codes(base({ parts: [{ id: "x", type: "warp-drive", at: "A1" }] })).includes("unknown-type"));
  assert.ok(codes(base({ parts: [{ id: "x", type: "led", at: "E30" }] })).includes("leg-off-breadboard"));
  assert.ok(codes(base({ parts: [{ id: "x", type: "resistor-220", at: "E28" }] })).includes("leg-off-breadboard"));
  assert.ok(codes(base({ parts: [{ id: "x", type: "led", at: "E5", rotate: 270 }] })).includes("leg-in-gap"));
  assert.ok(codes(base({ parts: [{ id: "a", type: "led", at: "A5" }, { id: "b", type: "led", at: "A6" }] })).includes("shared-hole"));
  assert.ok(codes(base({ parts: [{ id: "s", type: "servo", at: "A5" }] })).includes("not-breadboard-part"));
  assert.ok(codes(base({ parts: [{ id: "s", type: "servo" }] })).includes("no-place"));
  assert.ok(codes(base({ wires: [{ from: "pin:NOT_A_ROLE", to: "A1" }] })).includes("unknown-pin"));
  assert.ok(codes(base({ wires: [{ from: "part:ghost:leg", to: "A1" }] })).includes("unknown-part"));
  assert.ok(codes(base({ parts: [{ id: "a", type: "led", at: "A5" }], wires: [{ from: "part:a:foot", to: "B1" }] })).includes("unknown-leg"));
  assert.ok(codes(base({ wires: [{ from: "board:GND", to: "BN1" }, { from: "board:VCC", to: "BN2" }] })).includes("short-circuit"));
  assert.ok(codes(base({ wires: [{ from: "board:5V", to: "A1" }, { from: "pin:LED_PIN", to: "B1" }] }), esp32).includes("five-volt-on-esp-pin"));
  assert.ok(codes(base({ wires: [{ from: "board:VIN", to: "A1" }] }), allBoards.find((b) => b.id === "d1-mini")).includes("no-power-pin"));
  assert.ok(codes(base({ parts: [{ id: "a", type: "led", at: "A5" }], wires: [{ from: "pin:LED_PIN", to: "A5" }] })).includes("shared-hole"));
  assert.ok(codes({ breadboard: "none", parts: [], wires: [{ from: "A1", to: "pin:LED_PIN" }] }).includes("no-breadboard"));
});

test("when: parts only on 3.3V or 5V boards", () => {
  const c = { breadboard: "half", parts: [{ id: "d", type: "resistor-10k", at: "A1", when: "3v3" }], wires: [{ from: "A1", to: "pin:LED_PIN", when: "5v" }] };
  assert.equal(activeItems(c, uno).parts.length, 0);
  assert.equal(activeItems(c, uno).wires.length, 1);
  assert.equal(activeItems(c, esp32).parts.length, 1);
  assert.equal(activeItems(c, esp32).wires.length, 0);
});

// Every project's circuit, on every board it lists.
for (const project of projects()) {
  test(`project ${project.id}: the circuit is valid on every board`, () => {
    assert.ok(project.circuit, "has a circuit");
    assert.ok(project.wiring_steps?.length, "has wiring steps");
    const maxStep = Math.max(0, ...[...project.circuit.parts, ...project.circuit.wires].map((x) => x.step || 0));
    assert.equal(maxStep, project.circuit.breadboard === "none" ? 0 : project.wiring_steps.length, "one wiring screen per step");
    for (const board of allBoards.filter((b) => supports(project, b))) {
      const resolve = defaultResolvePin(board, pinOverrides(project.pins, board));
      const problems = validateCircuit(project.circuit, board, parts, resolve).filter((p) => p.level === "error");
      assert.deepEqual(problems.map((p) => p.message), [], `${project.id} on ${board.id}`);
      // Every pin wire reaches a part.
      const net = buildNetlist(project.circuit, board, parts, resolve);
      for (const w of activeItems(project.circuit, board).wires) {
        for (const end of [w.from, w.to]) {
          if (!end.startsWith("pin:")) continue;
          assert.ok(net.legsOnNet(net.endpointNet(end)).length > 0, `${project.id} on ${board.id}: ${end} reaches no part`);
        }
      }
    }
  });
}

test("wiring text is filled in for the board", async () => {
  const { fillWiringText } = await import("../../../ui/js/circuit/wiring-text.js");
  const t = "Wire {{pin:LED_RED}} to J6, {{VCC}} to the rail, the servo to {{5V}} on your {{board}}.";
  assert.equal(fillWiringText(t, uno), "Wire pin 12 to J6, 5V to the rail, the servo to 5V on your Uno.");
  assert.equal(fillWiringText(t, esp32), "Wire pin D25 to J6, 3V3 to the rail, the servo to VIN on your ESP32.");
  assert.equal(fillWiringText("{{pin:SDA}}", nodemcu), "pin D2");
  // Every project's wiring text fills in completely on every board it lists.
  for (const project of projects()) {
    for (const board of allBoards.filter((b) => supports(project, b))) {
      for (const step of project.wiring_steps) {
        const out = fillWiringText(step.text, board, pinOverrides(project.pins, board));
        assert.ok(!out.includes("{{"), `${project.id} on ${board.id}: ${out}`);
      }
    }
  }
});
