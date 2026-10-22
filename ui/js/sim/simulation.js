// The page's handle on a running simulation (docs/design.md §4). The sketch
// runs in a Web Worker (sim-worker.js); events come back in batches, one per
// animation frame. stop() ends the worker at once, even in a while(1) loop.
//
//   const sim = new Simulation({ board, project, onEvents, onError, onStop });
//   const compiled = await sim.start(source);   // { ok, errors, unsupported, message }
//   sim.setInputs({ digital: { 2: 0 } }); sim.serialWrite("hi\n"); sim.stop();

export class Simulation {
  /**
   * @param {object} opts
   * @param {object} opts.board a board file
   * @param {object} [opts.project] for pin roles in setInputs
   * @param {(events: object[]) => void} [opts.onEvents] a batch of events (about once per frame)
   * @param {(error: {kind, line, message, errors?}) => void} [opts.onError] compile, unsupported or runtime problems
   * @param {(info: {reason: string}) => void} [opts.onStop] the sketch stopped (stopped, error, ended)
   * @param {URL|string} [opts.workerUrl]
   */
  constructor({ board, project = null, onEvents = () => {}, onError = () => {}, onStop = () => {}, workerUrl } = {}) {
    Object.assign(this, { board, project, onEvents, onError, onStop });
    this.workerUrl = workerUrl ?? new URL("./sim-worker.js", import.meta.url);
    this.worker = null;
    this.speed = 1;
    this.pending = [];
    this.frame = 0;
    this.httpWaiting = new Map();
    this.nextId = 1;
    this.running = false;
  }

  /**
   * Compiles and runs a sketch. Resolves with the compile result.
   * @param {string} source
   * @param {object} [opts] { inputs, clock, mac }
   */
  start(source, opts = {}) {
    this.stop(false);
    const w = (this.worker = new Worker(this.workerUrl, { type: "module" }));
    return new Promise((resolve) => {
      w.onmessage = (e) => this.message(e.data, resolve);
      w.onerror = (e) => {
        this.onError({ kind: "runtime", line: 0, message: "The simulator stopped unexpectedly. Press Run to try again.", detail: e.message });
        this.finish("error");
        resolve({ ok: false, errors: [] });
      };
      w.postMessage({ cmd: "start", source, board: this.board, project: this.project, speed: this.speed, ...opts });
    });
  }

  message(msg, resolveStart) {
    switch (msg.type) {
      case "compiled": {
        const r = msg.result;
        if (r.ok) this.running = true;
        else if (r.unsupported) this.onError({ kind: "unsupported", line: r.line ?? 0, message: r.message });
        else this.onError({ kind: "compile", errors: r.errors, line: r.errors[0]?.line ?? 0, message: r.errors[0]?.message ?? "" });
        if (!r.ok) this.finish(null);
        resolveStart(r);
        return;
      }
      case "events":
        for (const ev of msg.events) {
          if (ev.type === "error") this.onError({ kind: ev.kind, line: ev.line, message: ev.message });
        }
        this.pending.push(...msg.events);
        this.schedule();
        return;
      case "http": {
        const done = this.httpWaiting.get(msg.id);
        this.httpWaiting.delete(msg.id);
        done?.(msg.res);
        return;
      }
      case "done":
        this.flush();
        this.finish(msg.reason);
        return;
    }
  }

  schedule() {
    if (this.frame) return;
    const raf = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 16));
    this.frame = raf(() => { this.frame = 0; this.flush(); });
  }

  flush() {
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.onEvents(batch);
  }

  finish(reason) {
    const wasRunning = this.running;
    this.running = false;
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    for (const done of this.httpWaiting.values()) done({ status: 0, type: "text/plain", body: "", headers: {}, error: "stopped" });
    this.httpWaiting.clear();
    if (reason && (wasRunning || reason === "error")) this.onStop({ reason });
  }

  /** Stops the sketch straight away (the worker is ended, so even while(1) stops). */
  stop(notify = true) {
    if (!this.worker) return;
    const wasRunning = this.running;
    this.flush();
    this.worker.terminate();
    this.worker = null;
    this.running = false;
    if (notify && wasRunning) {
      this.onEvents([{ type: "stopped", t: null, reason: "stopped" }]);
      this.onStop({ reason: "stopped" });
    }
    this.finish(null);
  }

  /** 1 = real time, 0.5 = half speed, 0 = paused, Infinity = as fast as possible. */
  setSpeed(speed) {
    this.speed = speed;
    this.worker?.postMessage({ cmd: "speed", speed });
  }

  /** { digital, analog, pulse, dht }: pins by number (or role / code with a project). */
  setInputs(inputs) { this.worker?.postMessage({ cmd: "inputs", inputs }); }
  /** Text typed into the Serial Monitor. */
  serialWrite(text) { this.worker?.postMessage({ cmd: "serial", text }); }
  /** A keypad key ("5", "#"). */
  pressKey(key) { this.worker?.postMessage({ cmd: "key", key }); }
  /** An RFID card's UID bytes. */
  tapCard(uid) { this.worker?.postMessage({ cmd: "card", uid: Array.from(uid) }); }
  /** An ESP-NOW message from another board: from = "AA:BB:CC:DD:EE:FF", data = text or bytes. */
  espNowReceive(from, data) { this.worker?.postMessage({ cmd: "espnow", from, data }); }

  /**
   * A request from the phone panel to the sketch's web server.
   * @param {{method?: string, path?: string, query?: object, form?: object, body?: string}} req
   * @returns {Promise<{status, type, body, headers, error?}>} status 0 when nothing answers
   */
  http(req) {
    if (!this.worker) return Promise.resolve({ status: 0, type: "text/plain", body: "", headers: {}, error: "not-running" });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.httpWaiting.set(id, resolve);
      this.worker.postMessage({ cmd: "http", id, req });
    });
  }
}
