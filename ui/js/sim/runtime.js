// The runtime: one simulated board. It keeps simulated time, the pins and
// their inputs, timers, and the list of events for the bench; and it drives
// the compiled sketch (setup, then loop forever) in slices.
//
// Time: `us` is simulated microseconds. Each statement adds `cost` µs, so a
// loop waiting on millis() finishes; delay() puts the sketch to sleep and
// the driver jumps time forward (headless) or waits for the real clock.

import { makeTypes } from "./types.js";
import { instantiate } from "./codegen.js";
import { SimError, fromText, toText } from "./values.js";

export const MODES = { 0: "INPUT", 1: "OUTPUT", 2: "INPUT_PULLUP", 4: "INPUT_PULLDOWN", 9: "INPUT_PULLDOWN" };
const FUEL = 20000; // loop iterations between checks with the driver
const MAX_EVENTS = 200000;
const BUSY_US = 2_000_000;

/** One simulated board running one sketch. */
export class Machine {
  /**
   * @param {object} board a board file (content/boards/*.json)
   * @param {object} [opts]
   * @param {number} [opts.clock] the wall-clock time (ms since 1970) when the sketch starts
   * @param {boolean} [opts.keepEvents] keep every event (headless) instead of handing them out
   */
  constructor(board, opts = {}) {
    this.board = board;
    this.T = makeTypes(board);
    this.family = board.family;
    this.avr = board.family === "avr";
    this.cost = this.avr ? 1 : 0.5;
    this.us = 0;
    this.ln = 0;
    this.loopLine = 0;
    this.fuel = FUEL;
    this.depth = 0;
    this.maxDepth = board.id === "mega" ? 600 : this.avr ? 200 : 500;
    this.rv = 0;
    this.events = [];
    this.eventCount = 0;
    this.truncated = false;
    this.inputs = { digital: {}, analog: {}, pulse: {}, dht: {} };
    this.pins = new Map(); // pin number → { mode, value }
    this.pinNumbers = new Set((board.pins || []).map((p) => p.number));
    this.timers = []; // { at, fn } sorted by at
    this.wakeAt = 0; // sleeping until this time (µs)
    this.wakeOn = null; // () => true to wake early (data arrived)
    this.clock0 = opts.clock ?? Date.now();
    this.rng = 1;
    this.interruptsOn = true;
    this.isrs = new Map(); // pin → { fn, mode }
    this.warned = new Set();
    this.progressUs = 0; // simulated time of the last sign of life
    this.progressReal = 0;
    this.done = false;
    this.error = null;
    this.devices = []; // library objects (displays...) for reset
    this.listeners = { keys: [], cards: [], http: [] };
    this.keyQueue = [];
    this.card = null;
    this.httpQueue = [];
    this.servers = [];
    this.wifi = { status: "idle", ip: "0.0.0.0" };
    this.time = { synced: false, offset: 0 };
  }

  // ------------------------------------------------------------ events

  /** Records an event for the bench / checks: { type, t (ms), ...data }. */
  emit(type, data) {
    this.progress();
    this.eventCount++;
    if (this.events.length >= MAX_EVENTS) {
      this.truncated = true;
      return;
    }
    this.events.push({ type, t: this.us / 1000, ...data });
  }

  /** Takes the events recorded so far. */
  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** The sketch did something visible, read an input or waited: not stuck. */
  progress() {
    this.progressUs = this.us;
    this.progressReal = 0;
  }

  /** A warning once per kind and key. */
  warn(kind, key, data) {
    const id = kind + ":" + key;
    if (this.warned.has(id)) return;
    this.warned.add(id);
    this.events.push({ type: "warning", t: this.us / 1000, kind, ...data });
  }

  // ------------------------------------------------------------ time

  /** Calls fn when simulated time reaches `at` µs. */
  at(at, fn) {
    const t = { at, fn };
    let i = this.timers.length;
    while (i > 0 && this.timers[i - 1].at > at) i--;
    this.timers.splice(i, 0, t);
    return t;
  }

  cancel(t) {
    const i = this.timers.indexOf(t);
    if (i >= 0) this.timers.splice(i, 1);
  }

  /** Runs timers that are due. */
  fireTimers() {
    while (this.timers.length && this.timers[0].at <= this.us) {
      const t = this.timers.shift();
      const save = this.us;
      if (t.at > this.us) this.us = t.at;
      t.fn();
      this.us = Math.max(save, this.us);
    }
  }

  nextTimer() {
    return this.timers.length ? this.timers[0].at : Infinity;
  }

  millis() {
    return Math.floor(this.us / 1000) >>> 0;
  }

  /** The wall clock (ms since 1970) for NTP / time(). */
  now() {
    return this.clock0 + this.us / 1000;
  }

  // ------------------------------------------------------------ pins

  pinState(pin) {
    let s = this.pins.get(pin);
    if (!s) { s = { mode: 0, value: 0, out: false }; this.pins.set(pin, s); }
    return s;
  }

  checkPin(pin, what) {
    if (this.pinNumbers.has(pin) || pin === 255) return true;
    this.warn("pin", pin, { pin, line: this.ln, message: `Pin ${pin} isn't a pin on the ${this.board.name}, so ${what} does nothing.` });
    return false;
  }

  /** The level a pin reads: its output, or its input (floating reads HIGH with INPUT_PULLUP). */
  readPin(pin) {
    const s = this.pins.get(pin);
    if (s && s.out) return s.value;
    const v = this.inputs.digital[pin];
    if (v == null) return s && s.mode === 2 ? 1 : 0;
    return v ? 1 : 0;
  }

  /**
   * Merges new inputs: { digital, analog, pulse, dht }. Runs interrupt
   * functions when a watched pin changes.
   */
  setInputs(inputs = {}) {
    const before = new Map();
    for (const pin of this.isrs.keys()) before.set(pin, this.readPin(pin));
    for (const k of ["digital", "analog", "pulse", "dht"]) {
      if (!inputs[k]) continue;
      for (const [pin, v] of Object.entries(inputs[k])) {
        const n = Number(pin);
        if (k === "digital") this.inputs.digital[n] = v == null ? null : normLevel(v);
        else this.inputs[k][n] = v;
      }
    }
    for (const [pin, isr] of this.isrs) {
      const a = before.get(pin), b = this.readPin(pin);
      if (a === b) continue;
      const fire = isr.mode === 1 || (isr.mode === 2 && b === 0) || (isr.mode === 3 && b === 1) || (isr.mode === 0 && b === 0);
      if (fire) this.interrupt(isr.fn);
    }
  }

  /** Runs an interrupt function straight away (it must not wait). */
  interrupt(fn) {
    if (!this.interruptsOn) { (this.pendingIsr ||= []).push(fn); return; }
    const saveLn = this.ln, saveRv = this.rv;
    this.runToEnd(fn.call(), "interrupt");
    this.ln = saveLn;
    this.rv = saveRv;
  }

  /** Drives a generator to its end without pausing (with a safety limit). */
  runToEnd(gen, what = "function") {
    let n = 0;
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
      if (++n > 200) throw new SimError(`Your ${what} took too long. Interrupt functions must be short and can't use delay().`);
      this.fuel = FUEL;
    }
  }

  // ------------------------------------------------------------ running

  /**
   * Prepares a compiled program. The sketch starts at the first run().
   * @param {object} program from compile()
   */
  load(program) {
    this.program = program;
    this.code = instantiate(program, this, program.natives);
    this.gen = this.main();
  }

  *main() {
    const code = this.code;
    yield* code.init.f(null);
    this.ln = code.setup ? 0 : 0;
    if (code.setup.g) yield* code.setup.call(); else code.setup.call();
    const loop = code.loop, se = code.serialEvent;
    for (;;) {
      if (loop.g) yield* loop.call(); else loop.call();
      this.us += this.cost;
      this.progress();
      if (se && this.serial?.rx.length) { if (se.g) yield* se.call(); else se.call(); }
      if (--this.fuel < 0) { this.loopLine = 0; yield 0; }
    }
  }

  /** Is the sketch asleep (in delay or waiting for input)? */
  sleeping() {
    if (this.wakeAt <= this.us) return false;
    if (this.wakeOn && this.wakeOn()) return false;
    return true;
  }

  /**
   * Runs the sketch until simulated time reaches `untilUs`, or the work
   * limit runs out (returns early so the page stays smooth).
   * @param {number} untilUs
   * @param {object} [opts]
   * @param {number} [opts.maxMs] real time allowed for this slice
   * @returns {boolean} true while the sketch can keep running
   */
  run(untilUs, { maxMs = Infinity } = {}) {
    const start = maxMs === Infinity ? 0 : performance.now();
    while (!this.done && this.us < untilUs) {
      if (this.sleeping()) {
        // Jump time forward to the next thing that can happen.
        const t = Math.min(this.wakeAt, untilUs, this.nextTimer());
        if (t > this.us) this.us = t;
        this.fireTimers();
        if (this.sleeping() && this.us < untilUs) continue;
        if (this.us >= untilUs && this.sleeping()) break;
      }
      const deadline = Math.min(untilUs, this.nextTimer());
      this.fuel = Math.max(1, Math.min(FUEL, Math.ceil((deadline - this.us) / this.cost)));
      try {
        const r = this.gen.next();
        if (r.done) { this.stop("ended"); break; }
      } catch (e) {
        this.fail(e);
        break;
      }
      this.fireTimers();
      this.checkBusy();
      if (maxMs !== Infinity && performance.now() - start > maxMs) break;
    }
    return !this.done;
  }

  /** Busy-loop warning (headless: 2 s of simulated time with no sign of life). */
  checkBusy(realMs) {
    const stuck = realMs !== undefined ? realMs > 2000 : this.us - this.progressUs > BUSY_US;
    if (stuck && this.loopLine) {
      this.warn("busy-loop", this.loopLine, { line: this.loopLine });
    }
  }

  fail(e) {
    if (e && e.sim) {
      const kind = e.kind === "unsupported" ? "unsupported" : "runtime";
      let message = e.message;
      if (kind === "unsupported" && !/press Upload/.test(message)) message = `The simulator can't run this part of your code (${message}), but the real board can: press Upload.`;
      this.error = { kind, line: this.ln, message };
    } else {
      this.error = { kind: "runtime", line: this.ln, message: "Something went wrong inside the simulator. Try Upload on the real board.", detail: String(e && e.stack || e) };
    }
    this.events.push({ type: "error", t: this.us / 1000, ...this.error });
    this.stop("error");
  }

  stop(reason) {
    if (this.done) return;
    this.done = true;
    this.events.push({ type: "stopped", t: this.us / 1000, reason });
  }

  // ------------------------------------------------------------ outside inputs

  /** A key pressed on the keypad. */
  pressKey(key) {
    this.keyQueue.push(String(key)[0]);
  }

  /** An RFID card tapped on the reader: its UID bytes. */
  tapCard(uid) {
    this.card = Array.from(uid || [], (b) => b & 255);
  }

  /**
   * A request from the phone panel to the sketch's web server.
   * Resolves with { status, type, body, headers }; status 0 when no server answers.
   */
  httpRequest(req) {
    return new Promise((resolve) => {
      const server = this.servers.find((s) => s.running);
      if (!server || (this.wifi.status !== "connected" && this.wifi.status !== "ap")) {
        resolve({ status: 0, type: "text/plain", body: "", headers: {}, error: server ? "no-wifi" : "no-server" });
        return;
      }
      const item = { req: { method: "GET", path: "/", query: {}, body: "", ...req }, resolve, done: false };
      server.queue.push(item);
      item.timer = this.at(this.us + 5_000_000, () => {
        const i = server.queue.indexOf(item);
        if (i >= 0) server.queue.splice(i, 1);
        if (!item.done) { item.done = true; resolve({ status: 0, type: "text/plain", body: "", headers: {}, error: "timeout" }); }
      });
    });
  }

  // ------------------------------------------------------------ random (avr-libc's generator)

  random() {
    let x = this.rng;
    if (x === 0) x = 123459876;
    const hi = Math.trunc(x / 127773), lo = x % 127773;
    x = 16807 * lo - 2836 * hi;
    if (x < 0) x += 0x7fffffff;
    this.rng = x;
    return x % 0x80000000;
  }

  // ------------------------------------------------------------ text helpers

  /** Byte string → display text (UTF-8). */
  text(s) { return toText(s); }
  bytes(text) { return fromText(text); }

  /** C strftime for struct tm objects. */
  strftime(fmt, tm) {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const p2 = (n) => String(n).padStart(2, "0");
    return fmt.replace(/%([a-zA-Z%])/g, (_, c) => {
      switch (c) {
        case "Y": return String(tm.tm_year + 1900);
        case "y": return p2((tm.tm_year + 1900) % 100);
        case "m": return p2(tm.tm_mon + 1);
        case "d": return p2(tm.tm_mday);
        case "e": return String(tm.tm_mday).padStart(2);
        case "H": return p2(tm.tm_hour);
        case "I": return p2(tm.tm_hour % 12 || 12);
        case "M": return p2(tm.tm_min);
        case "S": return p2(tm.tm_sec);
        case "p": return tm.tm_hour < 12 ? "AM" : "PM";
        case "A": return DAYS[tm.tm_wday] ?? "";
        case "a": return (DAYS[tm.tm_wday] ?? "").slice(0, 3);
        case "B": return MONTHS[tm.tm_mon] ?? "";
        case "b": case "h": return (MONTHS[tm.tm_mon] ?? "").slice(0, 3);
        case "j": return String(tm.tm_yday + 1).padStart(3, "0");
        case "w": return String(tm.tm_wday);
        case "c": return `${DAYS[tm.tm_wday]?.slice(0, 3)} ${MONTHS[tm.tm_mon]?.slice(0, 3)} ${String(tm.tm_mday).padStart(2)} ${p2(tm.tm_hour)}:${p2(tm.tm_min)}:${p2(tm.tm_sec)} ${tm.tm_year + 1900}`;
        case "x": return `${p2(tm.tm_mon + 1)}/${p2(tm.tm_mday)}/${p2((tm.tm_year + 1900) % 100)}`;
        case "X": case "T": return `${p2(tm.tm_hour)}:${p2(tm.tm_min)}:${p2(tm.tm_sec)}`;
        case "R": return `${p2(tm.tm_hour)}:${p2(tm.tm_min)}`;
        case "D": return `${p2(tm.tm_mon + 1)}/${p2(tm.tm_mday)}/${p2((tm.tm_year + 1900) % 100)}`;
        case "F": return `${tm.tm_year + 1900}-${p2(tm.tm_mon + 1)}-${p2(tm.tm_mday)}`;
        case "%": return "%";
        default: return "%" + c;
      }
    });
  }
}

function normLevel(v) {
  if (v === "HIGH" || v === true) return 1;
  if (v === "LOW" || v === false) return 0;
  return Number(v) ? 1 : 0;
}

export { normLevel };
