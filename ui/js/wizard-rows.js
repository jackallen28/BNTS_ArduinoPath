// The Wiring Wizard's test rows: what each part's test lines mean, and when
// a row counts as working. Pure (tested in Node); wizard.js draws them.
//
// Outputs (LEDs, buzzer, servo, screens...) need the student's "I saw it
// work" tick: only their eyes and ears know. Inputs (button, knob, sensors)
// tick themselves when a reading arrives that shows the student did the thing.

import { parseTestLine } from "./wiring-test.js";
import { activeItems } from "./circuit/netlist.js";

/** Likely causes when a part doesn't work, for the wizard's Fix it screen. */
export const FIXES = {
  led: ["The LED is in backwards: the long leg (+) goes to the pin side.", "A leg is in the wrong row: check the holes in the drawing.", "The resistor isn't joined to the blue (−) rail."],
  "rgb-led": ["The longest leg (−) must go to GND.", "One colour leg is in the wrong hole.", "A resistor is missing for one colour."],
  button: ["The button must sit across the gap in the middle.", "Turn the button a quarter turn: its legs only join one way.", "The wire to GND is missing."],
  buzzer: ["The + leg (red wire) goes to the pin, the other to GND.", "A wire has come loose: push it in firmly."],
  potentiometer: ["The middle leg goes to the analog pin.", "One outside leg needs + and the other needs GND."],
  joystick: ["Check VRx, VRy and SW go to the right pins.", "GND and +5V must both be connected."],
  "keypad-4x4": ["The eight wires must be in order: R1 to R4, then C1 to C4.", "A wire might be in the next pin along."],
  servo: ["Brown goes to GND, red to power, orange to the signal pin.", "On an ESP board the red wire needs 5V (or VIN), not 3V3."],
  ldr: ["The sensor and the 10kΩ resistor must meet in the same column as the wire to the pin.", "One side needs + and the other GND."],
  "hc-sr04": ["Trig and Echo might be swapped.", "The sensor needs 5V (VIN on some ESP boards).", "On an ESP board, check both 10kΩ resistors on Echo."],
  pir: ["The sensor needs about a minute to warm up after you plug it in.", "Check VCC, OUT and GND (the labels are under the white dome)."],
  dht: ["S (data) goes to the pin, + to power and − to GND.", "Readings take a few seconds to arrive."],
  "soil-moisture": ["SIG goes to an analog pin.", "VCC and GND must both be connected."],
  "rfid-rc522": ["3.3V must go to 3V3, never 5V.", "SDA, SCK, MOSI and MISO must go to the right pins.", "Hold the card flat on the reader for a second."],
  oled: ["SDA and SCL might be swapped.", "VCC and GND must both be connected."],
  "lcd-i2c": ["SDA and SCL might be swapped.", "Turn the little blue knob on the back to change the contrast."],
  tm1637: ["CLK and DIO might be swapped.", "VCC and GND must both be connected."],
  "led-matrix": ["Use the pins at the DIN end, not the DOUT end.", "DIN, CS and CLK must go to the right pins."],
  "neopixel-ring": ["The data wire must go to Data Input (DI), not Data Out.", "It needs 5V and GND."],
  "neopixel-strip": ["The data wire must go to DIN, not DOUT.", "It needs 5V and GND."],
};

const ANALOG = new Set(["potentiometer", "ldr", "soil-moisture"]);

/** Tracks the rows from the test sketch's serial lines. */
export class TestRows {
  /**
   * @param {{id, label, type, kind, prompt?}[]} rows  from testSketch()
   * @param {number} [analogMax]
   */
  constructor(rows, analogMax = 1023) {
    this.analogMax = analogMax;
    this.rows = rows.map((r) => ({ ...r, signal: false, seen: false, confirmed: false, ok: false, first: null, value: null, level: null }));
    this.partial = "";
    this.hello = false;
  }

  row(id) { return this.rows.find((r) => r.id === id); }

  /** Feeds serial text; returns the ids of rows that changed. */
  feed(text) {
    this.partial += text;
    const lines = this.partial.split(/\r?\n/);
    this.partial = lines.pop();
    const changed = new Set();
    for (const line of lines) {
      const m = parseTestLine(line);
      if (!m) continue;
      if (m.kind === "HELLO") { this.hello = true; continue; }
      const r = this.row(m.id);
      if (!r) continue;
      changed.add(r.id);
      if (m.kind === "TEST") {
        if (this.current && this.current !== r.id) changed.add(this.current);
        r.signal = true; r.value = m.value; this.current = r.id;
        continue;
      }
      this.reading(r, m.value);
    }
    return [...changed];
  }

  reading(r, value) {
    r.value = value;
    if (ANALOG.has(r.type)) r.level = Math.max(0, Math.min(1, Number(value) / this.analogMax));
    if (r.type === "hc-sr04") r.level = Math.max(0, Math.min(1, Number(value) / 200));
    if (r.first == null) { r.first = value; if (!this.instant(r, value)) return; }
    if (this.changedEnough(r, value)) { r.seen = true; r.ok = true; }
  }

  /** Parts where any reading at all shows it works. */
  instant(r, value) {
    return r.type === "dht" || r.type === "keypad-4x4" || r.type === "rfid-rc522" ? value !== "none" && value !== "" : false;
  }

  changedEnough(r, value) {
    if (this.instant(r, value)) return true;
    if (ANALOG.has(r.type)) return Math.abs(Number(value) - Number(r.first)) > this.analogMax * 0.08;
    if (r.type === "hc-sr04") return Math.abs(Number(value) - Number(r.first)) > 4 && Number(value) > 0;
    return value !== r.first;
  }

  /** The student ticks "I saw it work" (outputs). */
  confirm(id, yes = true) {
    const r = this.row(id);
    if (!r) return;
    r.confirmed = yes;
    if (r.kind === "output") r.ok = yes;
  }

  /** Starts over (Test again), keeping the outputs the student confirmed. */
  restart() {
    this.partial = "";
    this.hello = false;
    this.current = null;
    for (const r of this.rows) {
      Object.assign(r, { signal: false, first: null, value: null, level: null });
      if (r.kind === "input") Object.assign(r, { seen: false, ok: false });
    }
  }

  get allOk() { return this.rows.every((r) => r.ok); }
}

/**
 * The wizard's pages: meet each kind of part, each wiring step, then the test.
 * partsOnly (Free Play's mini wizard) keeps just those parts and their steps.
 * @returns {{kind: "meet"|"wire"|"test", type?, step?, title}[]}
 */
export function wizardPages(project, partsOnly = null, board = null) {
  const circuit = project?.circuit || { parts: [], wires: [] };
  const keep = (p) => !partsOnly || partsOnly.includes(p.id);
  // With a board, only the parts it uses (no 3.3V-only resistors on an Uno).
  const parts = (board ? activeItems(circuit, board).parts : circuit.parts).filter(keep);
  const pages = [];
  const types = [];
  for (const p of parts) if (!types.includes(p.type)) types.push(p.type);
  for (const t of types) pages.push({ kind: "meet", type: t });
  const steps = project?.wiring_steps || [];
  steps.forEach((s, i) => {
    const n = i + 1;
    if (partsOnly && !parts.some((p) => p.step === n)) return;
    pages.push({ kind: "wire", step: n, title: s.title });
  });
  pages.push({ kind: "test" });
  return pages;
}
