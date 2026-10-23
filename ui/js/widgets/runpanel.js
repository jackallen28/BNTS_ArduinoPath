// The run panel: runs a sketch in the simulator and shows its Serial Monitor.
// (A small version: the bench, with the live breadboard and controls,
// replaces it with the same API.)
//
//   const rp = createRunPanel({ board, project, circuit, onRuntimeError, onEvents });
//   await rp.run(source, { events, ms, label });  // → the compile result
//   rp.result();  // { ok, errors, events, serial, http, stopped_at_ms }, for checks.evaluate

import { h } from "../dom.js";
import { Simulation } from "../sim/simulation.js";
import { serialConsole } from "./console.js";

export function createRunPanel({ board, project = null, circuit = null, onRuntimeError = () => {}, onEvents = () => {} } = {}) {
  let sim = null;
  let timers = [];
  let trace = blank();
  const rp = { running: false };

  const con = serialConsole({ onSend: (text) => sim?.serialWrite(text) });
  con.setBaudVisible(false);
  const banner = h("div", { class: "run-banner", hidden: true });
  const view = h("div", { class: "run-view" }, h("p", { class: "muted", text: "Press Run to try your code in the simulator." }));
  const el = h("section", { class: "run-panel", "aria-label": "Simulator" }, banner, view, con.el);

  function blank() {
    return { ok: true, errors: [], events: [], serial: "", http: [], stopped_at_ms: 0 };
  }

  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    if (sim) sim.stop();
    sim = null;
    rp.running = false;
    banner.hidden = true;
    idle();
  }

  function idle() {
    view.replaceChildren(h("p", { class: "muted", text: "Stopped. Press Run to try your code in the simulator." }));
  }

  async function run(source, { events = [], ms = 0, label = "Running your code" } = {}) {
    stop();
    trace = blank();
    con.clear();
    banner.textContent = label;
    banner.className = `run-banner ${label === "Watching the goal" ? "goal" : ""}`;
    banner.hidden = false;
    const me = (sim = new Simulation({
      board, project,
      onEvents: (batch) => {
        if (me !== sim) return;
        for (const e of batch) {
          trace.events.push(e);
          if (e.t != null) trace.stopped_at_ms = Math.max(trace.stopped_at_ms, e.t);
          if (e.type === "serial" && !e.port) {
            trace.serial += String(e.text).replace(/\r\n/g, "\n");
            con.append(e.text);
          }
          if (e.type === "error") {
            trace.ok = false;
            onRuntimeError(e);
          }
        }
        onEvents(batch);
      },
      onError: (err) => {
        if (me !== sim) return;
        if (err.kind === "runtime") {
          trace.ok = false;
          onRuntimeError(err);
        }
      },
      onStop: () => {
        if (me !== sim) return;
        rp.running = false;
        banner.hidden = true;
        idle();
      },
    }));
    const compiled = await me.start(source);
    if (me !== sim) return compiled;
    if (!compiled.ok) {
      trace.ok = false;
      trace.errors = compiled.errors ?? [];
      trace.unsupported = !!compiled.unsupported;
      sim = null;
      banner.hidden = true;
      return compiled;
    }
    rp.running = true;
    view.replaceChildren(h("p", { class: "muted", text: `${label}...` }));
    for (const ev of events ?? []) {
      timers.push(setTimeout(() => apply(me, ev), ev.at_ms ?? 0));
    }
    if (ms) timers.push(setTimeout(() => { if (me === sim) stop(); }, ms + 200));
    return compiled;
  }

  function apply(s, ev) {
    if (s !== sim) return;
    if (ev.set) s.setInputs(ev.set);
    if (ev.serial != null) s.serialWrite(ev.serial);
    if (ev.key != null) s.pressKey(ev.key);
    if (ev.card) s.tapCard(ev.card);
    if (ev.http) s.http(ev.http).then((res) => trace.http.push({ request: ev.http, response: res })).catch(() => {});
    if (ev.espnow) s.espNowReceive(ev.espnow.from, ev.espnow.text ?? ev.espnow.data);
  }

  return Object.assign(rp, {
    el,
    console: con,
    run,
    stop,
    result: () => trace,
    serialWrite: (text) => sim?.serialWrite(text),
    setBoard(b) { board = b; },
    setCircuit(c) { circuit = c; },
    destroy() { stop(); con.destroy(); },
  });
}
