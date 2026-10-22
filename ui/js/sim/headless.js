// Runs a sketch with no page, as fast as possible (Node, tests, CI).
// See docs/design.md §4 and §5 (sim_events).

import { compile } from "./compiler.js";
import { Machine } from "./runtime.js";
import { resolvePin } from "./pins.js";
import { fromText } from "./values.js";

/**
 * Runs a sketch for `ms` of simulated time.
 * @param {string} source
 * @param {object} opts
 * @param {object} opts.board a board file
 * @param {number} [opts.ms] simulated milliseconds (default 5000)
 * @param {object[]} [opts.events] sim_events: [{ at_ms, set | serial | key | card | http }]
 * @param {object} [opts.inputs] inputs from the start (pins by number, role or code)
 * @param {object} [opts.project] for role names in events and inputs
 * @param {number} [opts.clock] wall-clock ms for time() / NTP (default: now)
 * @returns {{ ok, errors, events, serial, stopped_at_ms, http, unsupported?, message?, truncated? }}
 */
export function runHeadless(source, { board, ms = 5000, events = [], inputs = null, project = null, clock } = {}) {
  const c = compile(source, board);
  if (!c.ok) {
    return { ok: false, errors: c.errors || [], unsupported: !!c.unsupported, message: c.message, events: [], serial: "", stopped_at_ms: 0, http: [] };
  }
  const R = new Machine(board, { clock });
  const http = [];
  if (inputs) R.setInputs(resolveInputs(inputs, board, project));
  for (const ev of events || []) {
    const at = Math.max(0, Number(ev.at_ms) || 0) * 1000;
    const apply = () => applyEvent(R, ev, board, project, http);
    if (at === 0) apply();
    else R.at(at, apply);
  }
  R.load(c.program);
  const end = ms * 1000;
  R.run(end);
  if (!R.done) R.events.push({ type: "stopped", t: R.us / 1000, reason: "time" });
  const error = R.error;
  return {
    ok: !error,
    errors: error ? [{ line: error.line, col: 0, message: error.message, kind: error.kind }] : [],
    events: R.events,
    serial: (R.serialText ?? "").replace(/\r\n/g, "\n"),
    stopped_at_ms: Math.min(R.us, end) / 1000,
    http,
    truncated: R.truncated || undefined,
  };
}

/** Turns role names and "ANALOG_MAX" in inputs into pin numbers and values. */
export function resolveInputs(inputs, board, project) {
  const out = {};
  for (const [kind, map] of Object.entries(inputs || {})) {
    out[kind] = {};
    for (const [pin, v] of Object.entries(map || {})) {
      const n = resolvePin(pin, board, project)?.number ?? (/^\d+$/.test(pin) ? Number(pin) : null);
      if (n == null) continue;
      out[kind][n] = v === "ANALOG_MAX" ? board.analog_max ?? 1023 : v;
    }
  }
  return out;
}

/** Applies one sim_event to a running machine. */
export function applyEvent(R, ev, board, project, httpLog) {
  if (ev.set) R.setInputs(resolveInputs(ev.set, board, project));
  if (ev.serial != null && R.serial) R.serial.input(fromText(ev.serial));
  if (ev.key != null) R.pressKey(String(ev.key));
  if (ev.card != null) R.tapCard(ev.card);
  if (ev.http) {
    const req = { method: "GET", path: "/", query: {}, ...ev.http };
    const entry = { request: req, response: null };
    httpLog?.push(entry);
    R.httpRequest(req).then((res) => { entry.response = res; });
  }
}
