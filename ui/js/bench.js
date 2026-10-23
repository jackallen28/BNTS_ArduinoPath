// The bench joins a running simulation to the circuit drawing (docs/design.md §7).
// It follows the real wires through the netlist: an LED lights when its +
// leg is driven HIGH (or PWM) and its − leg reaches GND (straight, or
// through a resistor); a pressed button joins its pin to whatever is on the
// button's other side; a pot's wiper reads analog_max × its position.
//
//   const bench = new Bench({ board, circuit, parts, pins, project });
//   view.setState(bench.apply(events));                 // engine events → part states
//   const send = bench.control(partId, control, value); // a control → engine inputs
//   sim.setInputs(send.inputs); send.key && sim.pressKey(send.key); ...
//
// No DOM: tested in Node. The sound and the drawing are the run panel's job.

import { buildNetlist, defaultResolvePin, activeItems } from "./circuit/netlist.js";

const SUPPLY = new Set(["5V", "3V3", "VIN"]);

/** Bit-reverse a byte (the engine's matrix rows have column 0 in bit 0; the drawing wants it in bit 7). */
const reverseBits = (b) => {
  let r = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) r |= 0x80 >> i;
  return r;
};

export class Bench {
  /**
   * @param {object} o
   * @param {object} o.board     content/boards/<id>.json
   * @param {object} o.circuit   the project's (or Free Play's) circuit
   * @param {object} o.parts     the part catalogue (loadParts) — part.json data is enough
   * @param {Function|object} [o.pins] resolvePin(roleOrCode) → {code}, or role → code overrides
   */
  constructor({ board, circuit, parts, pins }) {
    this.board = board;
    this.circuit = circuit || { breadboard: "none", parts: [], wires: [] };
    this.parts = parts;
    this.resolve = typeof pins === "function" ? pins : defaultResolvePin(board, pins || {});
    this.net = buildNetlist(this.circuit, board, parts, this.resolve);
    this.active = activeItems(this.circuit, board).parts.filter((p) => parts.types?.[p.type]);
    this.numberOf = new Map((board.pins || []).map((p) => [p.code, p.number]));
    this.codeOf = new Map((board.pins || []).map((p) => [p.number, p.code]));
    this.analogMax = board.analog_max ?? 1023;
    this.pwmMax = board.pwm_max ?? 255;
    this.reset();
  }

  /** Forgets every pin level and part state (a new run). */
  reset() {
    this.levels = new Map(); // pin number → 0..1
    this.values = {};        // control values per part
    for (const p of this.active) {
      const b = this.behaviour(p);
      if (b === "potentiometer") this.values[p.id] = { position: 0.5 };
      if (b === "ldr") this.values[p.id] = { light: 0.5 };
      if (b === "soil-moisture") this.values[p.id] = { moisture: 0.5 };
      if (b === "hc-sr04") this.values[p.id] = { distance: 100 };
      if (b === "dht") this.values[p.id] = { t: 22, h: 45 };
      if (b === "joystick") this.values[p.id] = { x: 0.5, y: 0.5, press: false };
      if (b === "button") this.values[p.id] = { press: false };
      if (b === "pir") this.values[p.id] = { motion: false };
    }
  }

  behaviour(part) { return this.parts.types[part.type]?.behaviour; }

  /**
   * Everything a leg reaches: straight along wires and strips, and through
   * resistors (not through other parts). {pins: [codes], power: [names], viaResistor: bool}
   */
  reach(partId, leg, { throughResistors = true } = {}) {
    const start = this.net.legNet(partId, leg);
    const pins = [], power = [];
    if (!start) return { pins, power };
    const seen = new Set([start.id]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      for (const c of this.net.pinsOnNet(n)) if (!pins.includes(c)) pins.push(c);
      for (const p of this.net.powerOnNet(n)) if (!power.includes(p)) power.push(p);
      if (!throughResistors) continue;
      for (const l of this.net.legsOnNet(n)) {
        if (l.part === partId) continue;
        const part = this.active.find((p) => p.id === l.part);
        if (!part || this.behaviour(part) !== "resistor") continue;
        const other = this.parts.types[part.type].legs.find((x) => x.id !== l.leg)?.id;
        const on = this.net.legNet(part.id, other);
        if (on && !seen.has(on.id)) { seen.add(on.id); queue.push(on); }
      }
    }
    return { pins, power };
  }

  /** The pin number a leg is wired to (through resistors), or null. */
  pinOf(partId, leg) {
    const code = this.reach(partId, leg).pins[0];
    return code == null ? null : this.numberOf.get(code) ?? null;
  }

  /**
   * Each part with its pins, as wiring-test.js's testSketch wants them:
   * [{ id, type, label, options, pins: { anode: "12", ... } }]
   */
  testParts() {
    const keys = {
      led: { anode: "anode" }, "rgb-led": { red: "red", green: "green", blue: "blue" }, buzzer: { positive: "positive" },
      servo: { signal: "signal" }, pir: { signal: "out" }, potentiometer: { wiper: "wiper" }, "soil-moisture": { signal: "sig" },
      joystick: { x: "vrx", y: "vry", sw: "sw" }, "hc-sr04": { trig: "trig", echo: "echo" }, dht: { data: "data" },
      tm1637: { clk: "clk", dio: "dio" }, "led-matrix": { cs: "cs", din: "din", clk: "clk" },
      "neopixel-ring": { din: "din" }, "neopixel-strip": { din: "din" },
      "keypad-4x4": Object.fromEntries(["r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"].map((k) => [k, k])),
      "rfid-rc522": { sda: "sda", rst: "rst" },
    };
    return this.active.map((p) => {
      const pins = {};
      const map = keys[p.type];
      if (map) {
        for (const [key, leg] of Object.entries(map)) {
          const code = this.reach(p.id, leg).pins[0];
          if (code != null) pins[key] = code;
        }
      }
      if (p.type === "button" || p.type === "ldr") {
        const legs = this.parts.types[p.type].legs.map((l) => l.id);
        for (const leg of legs) {
          const code = this.reach(p.id, leg, { throughResistors: false }).pins[0];
          if (code != null) { pins.signal = code; break; }
        }
      }
      return { id: p.id, type: p.type, label: p.label || this.parts.types[p.type].title || p.type, options: p.options, pins };
    });
  }

  /** The level (0..1) a reach is driven to, or null when nothing drives it. */
  source(r) {
    if (r.power.some((p) => SUPPLY.has(p))) return 1;
    let best = null;
    for (const c of r.pins) {
      const v = this.levels.get(this.numberOf.get(c));
      if (v != null) best = Math.max(best ?? 0, v);
    }
    return best;
  }

  /** How well a reach sinks current: 1 for GND or a LOW pin, else 0. */
  sink(r) {
    if (r.power.includes("GND")) return 1;
    for (const c of r.pins) {
      const v = this.levels.get(this.numberOf.get(c));
      if (v != null) return 1 - v;
    }
    return 0;
  }

  ledLevel(id, plusLeg, minusLeg) {
    const src = this.source(this.reach(id, plusLeg)) ?? 0;
    return Math.max(0, Math.min(1, src * this.sink(this.reach(id, minusLeg))));
  }

  /** The LEDs' state from the pin levels. */
  lights() {
    const led = {}, rgb = {};
    for (const p of this.active) {
      const b = this.behaviour(p);
      if (b === "led") led[p.id] = this.ledLevel(p.id, "anode", "cathode");
      if (b === "rgb-led") rgb[p.id] = ["red", "green", "blue"].map((c) => Math.round(255 * this.ledLevel(p.id, c, "cathode")));
    }
    return { led, rgb };
  }

  /** Parts of a behaviour whose leg reaches a pin number. */
  partsOnPin(behaviours, leg, pin) {
    const code = this.codeOf.get(pin);
    return this.active.filter((p) => behaviours.includes(this.behaviour(p)) && (pin == null || this.reach(p.id, leg).pins.includes(code)));
  }

  /**
   * Turns a batch of engine events into a view.setState() update, plus the
   * buzzers' tones: { state, tones: { partId: freq | 0 } }.
   * @param {object[]} events
   */
  apply(events) {
    const state = {};
    const tones = {};
    const put = (key, id, v) => { (state[key] ||= {})[id] = v; };
    let pinsChanged = false;
    for (const ev of events) {
      switch (ev.type) {
        case "digital": this.levels.set(ev.pin, ev.value ? 1 : 0); pinsChanged = true; break;
        case "pwm": this.levels.set(ev.pin, Math.max(0, Math.min(1, ev.value / this.pwmMax))); pinsChanged = true; break;
        case "pinMode": if (ev.mode !== "OUTPUT" && this.levels.has(ev.pin)) { this.levels.delete(ev.pin); pinsChanged = true; } break;
        case "servo": for (const p of this.partsOnPin(["servo"], "signal", ev.pin)) put("servo", p.id, ev.angle); break;
        case "tone": for (const p of this.partsOnPin(["buzzer"], "positive", ev.pin)) { put("buzzer", p.id, ev.freq); tones[p.id] = ev.freq; } break;
        case "noTone": for (const p of this.partsOnPin(["buzzer"], "positive", ev.pin)) { put("buzzer", p.id, 0); tones[p.id] = 0; } break;
        case "neopixel": for (const p of this.partsOnPin(["neopixel"], "din", ev.pin)) put("neopixel", p.id, ev.pixels); break;
        case "oled": for (const p of this.partsOnPin(["oled"], null, null)) put("oled", p.id, { width: ev.width, height: ev.height, buffer: ev.buffer }); break;
        case "lcd": for (const p of this.partsOnPin(["lcd"], null, null)) put("lcd", p.id, { lines: ev.lines, backlight: ev.backlight }); break;
        case "tm1637": {
          let list = this.partsOnPin(["tm1637"], "clk", ev.clk);
          if (!list.length) list = this.partsOnPin(["tm1637"], null, null);
          for (const p of list) put("tm1637", p.id, ev.on === false ? [0, 0, 0, 0] : ev.segments);
          break;
        }
        case "matrix": {
          let list = this.partsOnPin(["led-matrix"], "cs", ev.cs);
          if (!list.length) list = this.partsOnPin(["led-matrix"], null, null);
          for (const p of list) put("matrix", p.id, (ev.rows || []).map(reverseBits));
          break;
        }
        case "stopped":
          for (const p of this.partsOnPin(["buzzer"], null, null)) { put("buzzer", p.id, 0); tones[p.id] = 0; }
          break;
      }
    }
    if (pinsChanged) {
      const { led, rgb } = this.lights();
      if (Object.keys(led).length) state.led = led;
      if (Object.keys(rgb).length) state.rgb = rgb;
    }
    return { state, tones };
  }

  /**
   * What a control change sends to the simulation:
   * { inputs?: {digital, analog, pulse, dht}, key?, card? } (pins by number).
   */
  control(partId, control, value) {
    const part = this.active.find((p) => p.id === partId);
    if (!part) return {};
    this.values[partId] = { ...this.values[partId], [control]: value };
    if (control === "key") return { key: String(value) };
    if (control === "card") return { card: value };
    return { inputs: this.inputsFor(part) };
  }

  /** The inputs every input part gives right now (for the start of a run). */
  allInputs() {
    const out = {};
    for (const p of this.active) {
      const inp = this.inputsFor(p);
      for (const [k, m] of Object.entries(inp || {})) Object.assign((out[k] ||= {}), m);
    }
    return out;
  }

  inputsFor(part) {
    const v = this.values[part.id] || {};
    const b = this.behaviour(part);
    const id = part.id;
    const analog = (leg, frac) => {
      const n = this.pinOf(id, leg);
      return n == null ? {} : { analog: { [n]: Math.round(Math.max(0, Math.min(1, frac)) * this.analogMax) } };
    };
    const supplyFrac = (leg) => {
      const r = this.reach(id, leg);
      if (r.power.some((p) => SUPPLY.has(p))) return 1;
      if (r.power.includes("GND")) return 0;
      return null;
    };
    switch (b) {
      case "button": {
        // The side with a pin gets whatever the other side has while pressed.
        const sw = this.parts.types[part.type].switch?.[0] || ["1a", "2a"];
        const out = { digital: {} };
        for (const [a, z] of [[sw[0], sw[1]], [sw[1], sw[0]]]) {
          for (const code of this.reach(id, a, { throughResistors: false }).pins) {
            const n = this.numberOf.get(code);
            if (!v.press) { out.digital[n] = null; continue; }
            const other = supplyFrac(z);
            out.digital[n] = other == null ? null : other;
          }
        }
        return out;
      }
      case "potentiometer": {
        const top = supplyFrac("end2");
        return analog("wiper", top === 0 ? 1 - (v.position ?? 0.5) : v.position ?? 0.5);
      }
      case "ldr": {
        // A divider: brighter light pulls the node towards the LDR's other leg.
        const legs = ["1", "2"];
        for (const leg of legs) {
          const n = this.reach(id, leg, { throughResistors: false }).pins[0];
          if (n == null) continue;
          const other = legs.find((l) => l !== leg);
          const towards = supplyFrac(other);
          const light = 0.05 + 0.9 * (v.light ?? 0.5);
          return analog(leg, towards === 0 ? 1 - light : light);
        }
        return {};
      }
      // Soil sensors read higher when the soil is drier (about 900 dry, 300 in water on a 10-bit pin).
      case "soil-moisture": return analog("sig", 0.88 - 0.6 * (v.moisture ?? 0.5));
      case "joystick": {
        const out = { ...analog("vrx", v.x ?? 0.5) };
        const y = analog("vry", v.y ?? 0.5).analog || {};
        out.analog = { ...(out.analog || {}), ...y };
        const sw = this.pinOf(id, "sw");
        if (sw != null) out.digital = { [sw]: v.press ? 0 : null };
        return out;
      }
      case "hc-sr04": {
        const n = this.pinOf(id, "echo");
        return n == null ? {} : { pulse: { [n]: Math.round((v.distance ?? 100) * 58) } };
      }
      case "dht": {
        const n = this.pinOf(id, "data");
        return n == null ? {} : { dht: { [n]: { t: v.t ?? 22, h: v.h ?? 45 } } };
      }
      case "pir": {
        const n = this.pinOf(id, "out");
        return n == null ? {} : { digital: { [n]: v.motion ? 1 : 0 } };
      }
    }
    return {};
  }
}
