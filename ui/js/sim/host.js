// The simulation host: what runs inside the Web Worker. It compiles the
// sketch, then runs it in slices paced to the real clock (setSpeed), and
// posts events back in batches. Kept apart from sim-worker.js so it can be
// tested in Node with fake timers.
//
// Messages in:  { cmd: "start", source, board, project, speed, inputs, clock, mac }
//               { cmd: "stop" } { cmd: "speed", speed } { cmd: "inputs", inputs }
//               { cmd: "serial", text } { cmd: "key", key } { cmd: "card", uid }
//               { cmd: "http", id, req } { cmd: "espnow", from, data }
// Messages out: { type: "compiled", result } { type: "events", events }
//               { type: "http", id, res } { type: "done", reason }

import { compile } from "./compiler.js";
import { Machine } from "./runtime.js";
import { resolveInputs } from "./headless.js";
import { fromText } from "./values.js";

const FRAME_MS = 16;
const SLICE_MS = 10; // real time the sketch may use per frame
const MAX_LAG_US = 250_000; // if the sketch falls further behind, stop trying to catch up

export class SimHost {
  /**
   * @param {(msg: object) => void} post sends a message to the page
   * @param {object} [timers] { setTimeout, clearTimeout, now } (fakes in tests)
   */
  constructor(post, timers = globalThis) {
    this.post = post;
    this.setTimeout = (fn, ms) => timers.setTimeout(fn, ms);
    this.clearTimeout = (t) => timers.clearTimeout(t);
    this.now = timers.now ? () => timers.now() : () => performance.now();
    this.R = null;
    this.speed = 1;
    this.timer = null;
  }

  handle(msg) {
    const R = this.R;
    switch (msg.cmd) {
      case "start": return this.start(msg);
      case "stop": return this.stop("stopped");
      case "speed": return this.setSpeed(msg.speed);
      case "inputs": if (R) R.setInputs(resolveInputs(msg.inputs, R.board, this.project)); return;
      case "serial": if (R?.serial) R.serial.input(fromText(msg.text ?? "")); return;
      case "key": R?.pressKey(String(msg.key)); return;
      case "card": R?.tapCard(msg.uid); return;
      case "espnow": R?.espNowReceive?.(msg.from, msg.data ?? ""); return;
      case "http":
        if (!R || R.done) { this.post({ type: "http", id: msg.id, res: { status: 0, type: "text/plain", body: "", headers: {}, error: "not-running" } }); return; }
        R.httpRequest(msg.req || {}, (res) => this.post({ type: "http", id: msg.id, res }));
        return;
    }
  }

  start({ source, board, project = null, speed = 1, inputs = null, clock, mac }) {
    this.stop(null);
    const result = compile(source, board);
    this.post({ type: "compiled", result: { ok: result.ok, errors: result.errors ?? [], unsupported: !!result.unsupported, message: result.message, line: result.line } });
    if (!result.ok) return;
    this.project = project;
    const R = (this.R = new Machine(board, { clock, mac }));
    if (inputs) R.setInputs(resolveInputs(inputs, board, project));
    R.load(result.program);
    this.speed = speed;
    this.baseReal = this.now();
    this.baseUs = 0;
    this.stuckMs = 0;
    this.lastProgress = 0;
    this.tick();
  }

  setSpeed(speed) {
    if (!this.R) { this.speed = speed; return; }
    // Keep simulated time continuous when the speed changes.
    this.baseUs = this.R.us;
    this.baseReal = this.now();
    this.speed = speed;
  }

  tick() {
    this.timer = null;
    const R = this.R;
    if (!R) return;
    const start = this.now();
    if (this.speed > 0) {
      let target = this.speed === Infinity ? R.us + 1e12 : this.baseUs + (start - this.baseReal) * 1000 * this.speed;
      if (target - R.us > MAX_LAG_US) {
        // The sketch can't keep up (busy code): don't race to catch up.
        this.baseUs = R.us;
        this.baseReal = start;
        target = R.us + FRAME_MS * 1000 * Math.min(this.speed, 50);
      }
      R.run(target, { maxMs: SLICE_MS });
    }
    // The busy-loop warning: no sign of life for 2 s of real time.
    if (R.progressUs !== this.lastProgress) { this.lastProgress = R.progressUs; this.stuckMs = 0; }
    else if (this.speed > 0) { this.stuckMs += this.now() - start + FRAME_MS; R.checkBusy(this.stuckMs); }
    const events = R.drain();
    if (events.length) this.post({ type: "events", events });
    if (R.done) {
      this.post({ type: "done", reason: R.error ? "error" : "ended" });
      this.R = null;
      return;
    }
    this.timer = this.setTimeout(() => this.tick(), FRAME_MS);
  }

  stop(reason = "stopped") {
    if (this.timer) this.clearTimeout(this.timer);
    this.timer = null;
    const R = this.R;
    this.R = null;
    if (R && reason) {
      const events = R.drain();
      events.push({ type: "stopped", t: R.us / 1000, reason });
      this.post({ type: "events", events });
      this.post({ type: "done", reason });
    }
  }
}
