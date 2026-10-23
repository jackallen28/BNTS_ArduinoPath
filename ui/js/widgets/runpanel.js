// The run panel: the on-screen board the workspace drops in. It draws the
// circuit (breadboard or schematic), runs sketches in the simulator, lights
// the parts through the bench, plays the buzzer, feeds the Serial Monitor,
// shows a phone for sketches that serve web pages, and the students' controls.
//
//   const rp = createRunPanel({ board, project, circuit, onRuntimeError, onEvents });
//   host.append(rp.el, rp.console.el);
//   const compiled = await rp.run(code, { events: step.sim_events, label: "Watching the goal" });
//   checks.evaluate(step.checks, { result: rp.result() });

import { h } from "../dom.js";
import { Simulation } from "../sim/simulation.js";
import { Bench } from "../bench.js";
import { serialConsole } from "./console.js";
import { drawBreadboard, drawSchematic, loadCircuitParts } from "../circuit/render.js";
import { defaultResolvePin, pinOverrides } from "../circuit/netlist.js";

const EMPTY_CIRCUIT = { breadboard: "none", parts: [], wires: [] };

/** The parts' "all off" state, for the start of a run. */
export function blankState(circuit, parts) {
  const s = { led: {}, rgb: {}, buzzer: {}, neopixel: {}, oled: {}, lcd: {}, tm1637: {}, matrix: {}, servo: {} };
  for (const p of circuit?.parts || []) {
    const b = parts?.types?.[p.type]?.behaviour;
    if (b === "led") s.led[p.id] = 0;
    if (b === "rgb-led") s.rgb[p.id] = [0, 0, 0];
    if (b === "buzzer") s.buzzer[p.id] = 0;
    if (b === "neopixel") s.neopixel[p.id] = [];
    if (b === "oled") s.oled[p.id] = [];
    if (b === "lcd") s.lcd[p.id] = { lines: ["", ""], backlight: true };
    if (b === "tm1637") s.tm1637[p.id] = [0, 0, 0, 0];
    if (b === "led-matrix") s.matrix[p.id] = [0, 0, 0, 0, 0, 0, 0, 0];
    if (b === "servo") s.servo[p.id] = 90;
  }
  return s;
}

/** Web Audio tones for the buzzers. Starts only after a click (browsers insist). */
class Sound {
  constructor() { this.ctx = null; this.oscs = new Map(); this.muted = false; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.06;
      this.gain.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  set(id, freq) {
    if (!this.ctx) return;
    const old = this.oscs.get(id);
    if (!freq || this.muted) {
      if (old) { try { old.stop(); } catch { /* already stopped */ } this.oscs.delete(id); }
      return;
    }
    if (old) { old.frequency.setValueAtTime(freq, this.ctx.currentTime); return; }
    const o = this.ctx.createOscillator();
    o.type = "square";
    o.frequency.value = freq;
    o.connect(this.gain);
    o.start();
    this.oscs.set(id, o);
  }
  stopAll() { for (const id of [...this.oscs.keys()]) this.set(id, 0); }
  close() { this.stopAll(); this.ctx?.close?.().catch(() => {}); this.ctx = null; }
}

/**
 * @param {object} o
 * @param {object} o.board            content/boards/<id>.json
 * @param {object|null} o.project     the full project JSON (null for Free Play)
 * @param {object|null} o.circuit     project.circuit, or a Free Play circuit
 * @param {(err: {kind, line, message}) => void} [o.onRuntimeError]
 * @param {(batch: object[]) => void} [o.onEvents]
 * @param {Worker|URL|string} [o.workerUrl]
 */
export function createRunPanel({ board, project = null, circuit = null, onRuntimeError = () => {}, onEvents = () => {}, workerUrl } = {}) {
  let curBoard = board, curProject = project, curCircuit = circuit || project?.circuit || EMPTY_CIRCUIT;
  let parts = null, bench = null, view = null, viewKind = "breadboard";
  let sim = null, runResult = null, timers = [], loadToken = 0;
  const sound = new Sound();
  const serialListeners = new Set();

  // ----- the DOM -----
  const status = h("span", { class: "rp-status", role: "status", text: "Ready" });
  const banner = h("div", { class: "rp-banner", hidden: true, role: "status" });
  const tabBb = h("button", { class: "tab", type: "button", role: "tab", "aria-selected": "true", onclick: () => setView("breadboard") }, "Breadboard");
  const tabSch = h("button", { class: "tab", type: "button", role: "tab", "aria-selected": "false", onclick: () => setView("schematic") }, "Schematic");
  const mute = h("button", { class: "btn small rp-mute", type: "button", "aria-pressed": "false", title: "Turn the buzzer's sound off or on",
    onclick: () => {
      sound.muted = !sound.muted;
      mute.setAttribute("aria-pressed", String(sound.muted));
      mute.textContent = sound.muted ? "🔇 Sound off" : "🔊 Sound on";
      if (sound.muted) sound.stopAll();
    } }, "🔊 Sound on");
  const stage = h("div", { class: "rp-stage" });
  const tip = h("div", { class: "balloon rp-tip", hidden: true, role: "status" });
  const phoneScreen = h("iframe", { class: "rp-phone-screen", title: "The phone's web page", sandbox: "allow-same-origin" });
  const phoneAddress = h("input", { class: "input rp-phone-address", "aria-label": "Web address on the phone", value: "/" });
  const phoneGo = h("button", { class: "btn small", type: "button", onclick: () => phoneOpen(phoneAddress.value) }, "Go");
  const phoneNote = h("p", { class: "rp-phone-note", text: "Start your web server, then press Go." });
  const phone = h("aside", { class: "rp-phone", hidden: true, "aria-label": "Phone" },
    h("div", { class: "rp-phone-top" }, h("span", { class: "rp-phone-wifi", text: "📶 WiFi" }), h("span", { class: "rp-phone-ip", text: "" })),
    h("div", { class: "rp-phone-bar" }, phoneAddress, phoneGo),
    phoneScreen, phoneNote);
  const el = h("section", { class: "run-panel", "aria-label": "Simulator" },
    h("div", { class: "rp-head" },
      h("div", { class: "tabs", role: "tablist", "aria-label": "Drawing" }, tabBb, tabSch),
      status, mute),
    banner,
    h("div", { class: "rp-body" }, stage, phone),
    tip);
  // Sound may only start after a click or key press on the page.
  for (const ev of ["pointerdown", "keydown"]) el.addEventListener(ev, () => sound.unlock(), { passive: true });

  const con = serialConsole({ onSend: (text) => api.serialWrite(text) });

  // ----- the circuit -----
  const pinsFn = () => defaultResolvePin(curBoard, pinOverrides(curProject?.pins, curBoard));
  let ready = Promise.resolve();
  function load() {
    const token = ++loadToken;
    ready = loadCircuitParts(curCircuit, curBoard).then((p) => {
      if (token !== loadToken) return;
      parts = p;
      bench = new Bench({ board: curBoard, circuit: curCircuit, parts, pins: pinsFn() });
      draw();
    }).catch((e) => {
      stage.replaceChildren(h("p", { class: "rp-error", text: "The circuit drawing couldn't load. Your code can still run." }));
      console.error(e);
    });
    return ready;
  }
  function draw() {
    view?.destroy();
    view = null;
    stage.replaceChildren();
    if (!parts) return;
    const opts = { board: curBoard, circuit: curCircuit, parts, pins: pinsFn(), showAll: true };
    view = viewKind === "schematic" ? drawSchematic(stage, opts) : drawBreadboard(stage, opts);
    view.onControl?.((id, control, value) => {
      sound.unlock();
      const send = bench.control(id, control, value);
      if (!sim?.running) return;
      if (send.inputs) sim.setInputs(send.inputs);
      if (send.key) sim.pressKey(send.key);
      if (send.card) sim.tapCard(send.card);
    });
    if (lastState) view.setState?.(lastState);
  }
  function setView(kind) {
    viewKind = kind;
    tabBb.setAttribute("aria-selected", String(kind === "breadboard"));
    tabSch.setAttribute("aria-selected", String(kind === "schematic"));
    draw();
  }
  // The latest state of every part, so a redraw (or the schematic toggle) keeps it.
  let lastState = null;
  function setState(update) {
    lastState ||= {};
    for (const [k, m] of Object.entries(update)) lastState[k] = { ...(lastState[k] || {}), ...m };
    view?.setState?.(update);
  }

  // ----- the phone -----
  async function phoneOpen(address, req = {}) {
    if (!sim?.running) { phoneNote.textContent = "Press Run first: the phone talks to your running code."; return; }
    const u = new URL(address || "/", "http://board.local/");
    const query = Object.fromEntries(u.searchParams);
    const request = { method: "GET", path: u.pathname, query, ...req };
    phoneAddress.value = u.pathname + u.search;
    phoneNote.textContent = "Loading…";
    const res = await sim.http(request);
    runResult?.http.push({ request, response: res });
    if (!res.status) {
      phoneNote.textContent = res.error === "no-wifi" ? "Your board isn't on the WiFi yet." :
        res.error === "no-server" ? "Your code hasn't started a web server yet." : "The board didn't answer. Is your code still running?";
      return;
    }
    phoneNote.textContent = `Page ${res.status === 200 ? "loaded" : `answered ${res.status}`}`;
    const html = /html/.test(res.type || "") ? res.body : `<pre>${String(res.body).replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`;
    phoneScreen.srcdoc = html;
  }
  // Links and forms on the phone's page become requests to the sketch.
  phoneScreen.addEventListener("load", () => {
    const doc = phoneScreen.contentDocument;
    if (!doc) return;
    doc.addEventListener("click", (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a) return;
      e.preventDefault();
      phoneOpen(a.getAttribute("href"));
    });
    doc.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));
      const method = (form.getAttribute("method") || "GET").toUpperCase();
      const action = form.getAttribute("action") || "/";
      if (method === "GET") phoneOpen(`${action}?${new URLSearchParams(data)}`);
      else phoneOpen(action, { method, form: data });
    });
  });

  function showPhone(ip) {
    phone.hidden = false;
    if (ip) phone.querySelector(".rp-phone-ip").textContent = ip;
  }

  // ----- running -----
  function clearTimers() { for (const t of timers) clearTimeout(t); timers = []; }

  function handleEvents(batch) {
    if (!runResult) return;
    runResult.events.push(...batch);
    let serial = "";
    for (const ev of batch) {
      if (ev.t != null) runResult.stopped_at_ms = Math.max(runResult.stopped_at_ms, ev.t);
      switch (ev.type) {
        case "serial": serial += ev.text; break;
        case "warning":
          if (ev.kind === "busy-loop") showTip("Your code is very busy", api.busyLoopText ||
            "Your loop is running without a break, so the board can't do anything else. Try adding delay(10); inside it.");
          else if (ev.message) showTip("A clue from the simulator", ev.message);
          break;
        case "wifi": if (ev.status === "connected" || ev.status === "ap") showPhone(ev.ip); break;
        case "http_route": showPhone(); break;
        case "error":
          runResult.ok = false;
          runResult.errors.push({ line: ev.line, col: 0, message: ev.message, kind: ev.kind });
          break;
      }
    }
    if (serial) {
      runResult.serial += serial.replace(/\r\n/g, "\n");
      con.append(serial);
      for (const fn of serialListeners) { try { fn(serial); } catch (e) { console.error(e); } }
    }
    if (bench) {
      const { state, tones } = bench.apply(batch);
      if (Object.keys(state).length) setState(state);
      for (const [id, f] of Object.entries(tones)) sound.set(id, f);
    }
    if (runResult.limitMs != null && runResult.stopped_at_ms >= runResult.limitMs && sim?.running) stop("time");
    try { onEvents(batch); } catch (e) { console.error(e); }
  }

  function showTip(title, text) {
    tip.replaceChildren(h("div", { class: "balloon-title", text: title }), h("p", { text }),
      h("button", { class: "btn small", type: "button", onclick: () => { tip.hidden = true; } }, "OK"));
    tip.hidden = false;
  }

  /** Applies one sim_event during a demo run (in real time). */
  function applySimEvent(ev) {
    if (!sim?.running) return;
    if (ev.set) sim.setInputs(ev.set);
    if (ev.serial != null) sim.serialWrite(String(ev.serial));
    if (ev.key != null) sim.pressKey(String(ev.key));
    if (ev.card != null) sim.tapCard(ev.card);
    if (ev.espnow != null) {
      const m = typeof ev.espnow === "object" && !Array.isArray(ev.espnow) ? ev.espnow : { data: ev.espnow };
      sim.espNowReceive(m.from, m.text ?? m.data ?? "");
    }
    if (ev.http) {
      const req = { method: "GET", path: "/", query: {}, ...ev.http };
      showPhone();
      phoneOpen(req.path + (Object.keys(req.query || {}).length ? `?${new URLSearchParams(req.query)}` : ""), { method: req.method, form: req.form });
    }
  }

  function stop(reason = "stopped") {
    clearTimers();
    if (sim) {
      const s = sim;
      sim = null;
      s.stop();
    }
    sound.stopAll();
    if (runResult && reason) runResult.stopReason = reason;
    el.classList.remove("rp-running");
    status.textContent = "Stopped";
  }

  const api = {
    el,
    console: con,
    get running() { return !!sim?.running; },
    /** Text for the busy-loop tip (the Coach's words). */
    busyLoopText: "",

    /**
     * Runs a sketch. Resolves with the compile result {ok, errors, unsupported, message}.
     * @param {string} source
     * @param {{events?: object[], ms?: number, label?: string}} [opts]
     */
    async run(source, { events = [], ms, label = "Running your code" } = {}) {
      stop(null);
      sound.unlock();
      await ready;
      clearTimers();
      tip.hidden = true;
      const goal = /goal/i.test(label);
      banner.hidden = !goal;
      banner.textContent = goal ? "👀 Watching the goal: this is what your code should do." : "";
      el.classList.toggle("rp-goal", goal);
      bench?.reset();
      lastState = null;
      setState(blankState(curCircuit, parts));
      runResult = { ok: true, errors: [], events: [], serial: "", http: [], stopped_at_ms: 0, limitMs: ms ?? null };
      con.append("");
      const s = (sim = new Simulation({
        board: curBoard, project: curProject, workerUrl,
        onEvents: (batch) => { if (sim === s) handleEvents(batch); },
        onError: (err) => {
          if (sim !== s) return;
          if (err.kind === "runtime" || err.kind === "unsupported") {
            if (runResult) runResult.ok = false;
            try { onRuntimeError(err); } catch (e) { console.error(e); }
          }
        },
        onStop: ({ reason }) => {
          if (sim !== s) return;
          sound.stopAll();
          status.textContent = reason === "ended" ? "Finished" : "Stopped";
          el.classList.remove("rp-running");
        },
      }));
      status.textContent = "Starting…";
      const compiled = await s.start(source, { inputs: bench?.allInputs() });
      if (sim !== s) return compiled;
      if (!compiled.ok) {
        runResult.ok = false;
        runResult.errors = compiled.errors || [];
        if (compiled.unsupported) runResult.unsupported = true;
        runResult.message = compiled.message;
        status.textContent = "Not running";
        sim = null;
        return compiled;
      }
      status.textContent = label;
      el.classList.add("rp-running");
      for (const ev of events || []) {
        timers.push(setTimeout(() => applySimEvent(ev), Math.max(0, Number(ev.at_ms) || 0)));
      }
      if (ms != null) timers.push(setTimeout(() => { if (sim === s) stop("time"); }, ms + 2000));
      return compiled;
    },

    stop() { stop("stopped"); },

    /** What this run produced, in runHeadless's shape (for checks.evaluate). */
    result() {
      if (!runResult) return { ok: false, errors: [], events: [], serial: "", http: [], stopped_at_ms: 0 };
      const { limitMs, stopReason, ...r } = runResult;
      return { ...r, events: [...r.events], http: [...r.http], errors: [...r.errors] };
    },

    serialWrite(text) { sim?.serialWrite(text); },

    /** Calls fn(text) with the simulator's serial output as it arrives. Returns an unsubscribe function. */
    onSerial(fn) { serialListeners.add(fn); return () => serialListeners.delete(fn); },

    setBoard(b) { curBoard = b; stop(null); return load(); },
    setCircuit(c) { curCircuit = c || EMPTY_CIRCUIT; stop(null); return load(); },
    setProject(p) { curProject = p; curCircuit = p?.circuit || curCircuit; stop(null); return load(); },
    /** The bench (for the wizard and tests). */
    get bench() { return bench; },
    get view() { return view; },
    /** Resolves when the circuit has been drawn. */
    get ready() { return ready; },

    destroy() {
      stop(null);
      sound.close();
      view?.destroy();
      con.destroy?.();
      el.remove();
    },
  };
  load();
  return api;
}
