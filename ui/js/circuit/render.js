// The circuit renderer: draws a project's circuit on Fritzing's half+
// breadboard next to the student's board, step by step for the Wiring
// Wizard, with the simulator's state drawn on the same parts (LEDs glow,
// the servo turns...) and controls students can use (press a button, turn
// a knob, slide the light level...).
//
//   const view = drawBreadboard(container, { board, circuit, parts, pins, step, showAll });
//   view.setStep(2); view.setState({ led: { red: 1 } }); view.onControl((id, control, value) => {});
//   view.destroy();
//
// `parts` comes from loadParts() / loadCircuitParts() (./parts.js).
// All art is inline SVG (styles as attributes, as the page's CSP needs).

import { layoutCircuit, stepState, apply, boxOf, mul, T, WIRE_COLORS } from "./layout.js";
import { activeItems } from "./netlist.js";
import { oledPath, lcdPaths, segmentsOn, matrixDot } from "./display.js";
import { svgEl, artContent } from "./svg.js";

export { drawSchematic } from "./schematic.js";
export { svgEl, artContent } from "./svg.js";
export { loadParts, loadCircuitParts, addParts } from "./parts.js";

let viewCount = 0;
const matrixAttr = (m) => `matrix(${m.map((v) => Math.round(v * 10000) / 10000).join(" ")})`;

// ---------- descriptions ----------

function describe(board, circuit, names) {
  const { parts } = activeItems(circuit, board);
  const counts = new Map();
  for (const p of parts) counts.set(p.type, (counts.get(p.type) || 0) + 1);
  const items = [...counts].map(([type, n]) => {
    const nm = names?.[type];
    if (!nm) return n > 1 ? `${n} ${type}s` : `a ${type}`;
    return n > 1 ? `${n} ${nm.plural}` : `${/^[aeiou]/i.test(nm.name) ? "an" : "a"} ${nm.name}`;
  });
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
  return `${board.name || board.id}${list ? ` wired to ${list}` : ""} on a breadboard`;
}

// ---------- simulated behaviour drawn on the parts ----------

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const rgbCss = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;

function glowGradient(defs, id) {
  const grad = svgEl("radialGradient", { id },
    svgEl("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": "1" }),
    svgEl("stop", { offset: "0.3", "stop-color": "#f00", "stop-opacity": "0.85" }),
    svgEl("stop", { offset: "1", "stop-color": "#f00", "stop-opacity": "0" }));
  defs.append(grad);
  return {
    set(color) {
      grad.children[1].setAttribute("stop-color", color);
      grad.children[2].setAttribute("stop-color", color);
    },
  };
}

/** Adds the overlays for one part and returns its state setter. */
function behaviourFor(item, g, defs, uid) {
  const { part, def } = item;
  const sim = def.sim || {};
  const local = (sel) => g.querySelector(sel);
  switch (def.behaviour) {
    case "led":
    case "rgb-led": {
      const color = def.colors?.[part.color] || def.colors?.red || "#e8e8e8";
      if (def.behaviour === "led") g.setAttribute("color", color);
      else g.setAttribute("color", "#e6e6e6");
      const gid = `${uid}-glow-${part.id}`;
      const grad = glowGradient(defs, gid);
      grad.set(color);
      const glow = sim.glow || { x: def.breadboard.width / 2, y: 10, r: 20 };
      const c = svgEl("circle", { cx: glow.x, cy: glow.y, r: glow.r, fill: `url(#${gid})`, opacity: 0, class: "cp-glow", "pointer-events": "none" });
      g.append(c);
      return (v) => {
        if (def.behaviour === "led") {
          c.setAttribute("opacity", clamp01(v === true ? 1 : v));
        } else {
          const rgb = Array.isArray(v) ? v : [0, 0, 0];
          const max = Math.max(...rgb, 0);
          if (max > 0) {
            const k = 255 / max;
            const css = rgbCss(rgb.map((x) => x * k));
            grad.set(css);
            g.setAttribute("color", css);
          } else g.setAttribute("color", "#e6e6e6");
          c.setAttribute("opacity", clamp01(max / 255));
        }
      };
    }
    case "servo": {
      const horn = local('[data-cp="horn"]');
      if (!horn) return null;
      const cx = +horn.dataset.cx, cy = +horn.dataset.cy;
      const sq = +horn.dataset.squash || 1, off = +horn.dataset.offset || 0;
      const set = (angle) => {
        const a = Math.max(0, Math.min(180, Number(angle) || 0));
        const rot = off + (90 - a);
        horn.setAttribute("transform", `translate(${cx} ${cy}) scale(1 ${sq}) rotate(${rot}) scale(1 ${1 / sq}) translate(${-cx} ${-cy})`);
      };
      set(90);
      return set;
    }
    case "buzzer": {
      const w = sim.waves || { x: def.breadboard.width / 2, y: def.breadboard.height / 2, r: 20 };
      const waves = svgEl("g", { class: "cp-waves", "pointer-events": "none" });
      for (let i = 0; i < 3; i++) {
        const r = w.r * (0.75 + i * 0.28);
        const arc = (sx) => `M${w.x + sx * r * 0.82} ${w.y - r * 0.57}A${r} ${r} 0 0 ${sx > 0 ? 1 : 0} ${w.x + sx * r * 0.82} ${w.y + r * 0.57}`;
        waves.append(svgEl("path", { d: arc(1) + arc(-1), fill: "none", stroke: "#19c1ca", "stroke-width": 3, "stroke-linecap": "round", class: `cp-wave cp-wave-${i}` }));
      }
      waves.setAttribute("display", "none");
      g.append(waves);
      return (v) => {
        const on = !!v && v !== 0;
        waves.setAttribute("display", on ? "inline" : "none");
        if (on && typeof v === "number") waves.style.setProperty("--cp-wave-speed", `${Math.max(0.25, Math.min(1.2, 300 / v))}s`);
      };
    }
    case "neopixel": {
      const pts = sim.pixels || [];
      const r = sim.pixel_r || 6;
      const leds = pts.map((p) => {
        const halo = svgEl("circle", { cx: p.x, cy: p.y, r: r * 2, opacity: 0, class: "cp-pixel-halo" });
        const core = svgEl("circle", { cx: p.x, cy: p.y, r, opacity: 0 });
        g.append(halo, core);
        return { halo, core };
      });
      return (pixels) => {
        leds.forEach(({ halo, core }, i) => {
          const px = pixels?.[i] || [0, 0, 0];
          const max = Math.max(...px);
          if (max <= 0) { core.setAttribute("opacity", 0); halo.setAttribute("opacity", 0); return; }
          const css = rgbCss(px.map((x) => (x * 255) / max));
          core.setAttribute("fill", css); halo.setAttribute("fill", css);
          core.setAttribute("opacity", 0.55 + 0.45 * (max / 255));
          halo.setAttribute("opacity", 0.45 * (max / 255));
        });
      };
    }
    case "oled": {
      const box = sim.screen;
      if (!box) return null;
      const W = def.options?.width || 128, H = def.options?.height || 64;
      const path = svgEl("path", { d: "", fill: "#bfefff", class: "cp-oled-pixels" });
      g.append(path);
      return (v) => {
        // A buffer (array or Uint8Array), or the engine's event {width, height, buffer}.
        const raw = Array.isArray(v) || ArrayBuffer.isView(v);
        const buf = raw ? v : v?.buffer;
        path.setAttribute("d", oledPath(buf || [], (!raw && v?.width) || W, (!raw && v?.height) || H, box));
      };
    }
    case "lcd": {
      const box = sim.screen;
      if (!box) return null;
      const cols = def.options?.cols || 16, rows = def.options?.rows || 2;
      const back = svgEl("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: "#2a64e8", rx: 2 });
      const grid = svgEl("path", { d: lcdPaths([], cols, rows, box).off, fill: "#ffffff", opacity: 0.1 });
      const on = svgEl("path", { d: "", fill: "#f4f8ff" });
      g.append(back, grid, on);
      return (v) => {
        const lines = Array.isArray(v) ? v : v?.lines || [];
        const light = v?.backlight !== false;
        back.setAttribute("fill", light ? "#2a64e8" : "#16306e");
        on.setAttribute("fill", light ? "#f4f8ff" : "#8da2d6");
        on.setAttribute("d", lcdPaths(lines, cols, rows, box).on);
      };
    }
    case "tm1637": {
      const segs = [...g.querySelectorAll('[data-cp="seg"]')];
      const colon = [...g.querySelectorAll('[data-cp="colon"]')];
      return (v) => {
        const bytes = v || [];
        for (const s of segs) {
          const on = segmentsOn(bytes[+s.dataset.d] || 0).includes(s.dataset.s);
          s.setAttribute("fill", on ? "#ff3b24" : "#3a1616");
        }
        const col = !!((bytes[1] || 0) & 0x80);
        for (const c of colon) c.setAttribute("fill", col ? "#ff3b24" : "#3a1616");
      };
    }
    case "led-matrix": {
      const dots = [...g.querySelectorAll('[data-cp="dot"]')];
      return (rows) => {
        for (const d of dots) d.setAttribute("fill", matrixDot(rows, +d.dataset.r, +d.dataset.c) ? "#ff3a22" : "#3a1414");
      };
    }
    case "button": {
      const cap = local('[data-cp="cap"]');
      if (!cap) return null;
      const cx = +cap.dataset.cx, cy = +cap.dataset.cy;
      return (pressed) => {
        cap.setAttribute("transform", pressed ? `translate(${cx} ${cy}) scale(0.86) translate(${-cx} ${-cy})` : "");
        cap.setAttribute("opacity", pressed ? "0.8" : "1");
      };
    }
    case "potentiometer": {
      const knob = local('[data-cp="knob"]');
      if (!knob) return null;
      const cx = +knob.dataset.cx, cy = +knob.dataset.cy;
      return (pos) => knob.setAttribute("transform", `rotate(${(clamp01(pos) - 0.5) * 270} ${cx} ${cy})`);
    }
    case "joystick": {
      const knob = local('[data-cp="knob"]');
      if (!knob) return null;
      const travel = sim.travel || 12;
      return (v) => {
        const x = (clamp01(v?.x ?? 0.5) - 0.5) * 2 * travel, y = (clamp01(v?.y ?? 0.5) - 0.5) * 2 * travel;
        knob.setAttribute("transform", `translate(${x} ${y})${v?.press ? ` translate(${+knob.dataset.cx} ${+knob.dataset.cy}) scale(0.92) translate(${-knob.dataset.cx} ${-knob.dataset.cy})` : ""}`);
      };
    }
    case "keypad": {
      const keys = new Map([...g.querySelectorAll('[data-cp="key"]')].map((k) => [k.dataset.key, k]));
      const timers = new Map();
      return (key) => {
        const k = keys.get(String(key));
        if (!k) return;
        k.setAttribute("transform", "translate(0 1.5)");
        k.setAttribute("opacity", "0.75");
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => { k.removeAttribute("transform"); k.setAttribute("opacity", "1"); }, 160));
      };
    }
  }
  return null;
}

// Which setState key feeds which behaviour.
const STATE_KEYS = {
  led: "led", rgb: "rgb-led", servo: "servo", buzzer: "buzzer", neopixel: "neopixel", oled: "oled",
  lcd: "lcd", tm1637: "tm1637", matrix: "led-matrix", button: "button", pot: "potentiometer",
  joystick: "joystick", keypad: "keypad",
};

// ---------- controls ----------

const CONTROL_DEFAULTS = {
  ldr: { light: 0.5 }, "hc-sr04": { distance: 100 }, dht: { t: 22, h: 45 }, "soil-moisture": { moisture: 0.5 },
  potentiometer: { position: 0.5 }, joystick: { x: 0.5, y: 0.5, press: false }, button: { press: false },
  pir: { motion: false },
};

function html(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c != null) el.append(c);
  return el;
}

function slider({ label, min, max, step, value, unit, format, onInput }) {
  const out = html("output", { class: "cp-chip-value" });
  const show = (v) => { out.textContent = format ? format(v) : `${v}${unit || ""}`; };
  const input = html("input", { type: "range", min, max, step, value, class: "cp-range", "aria-label": label });
  input.addEventListener("input", () => { show(+input.value); onInput(+input.value); });
  show(value);
  return { el: html("label", { class: "cp-chip-row" }, html("span", { class: "cp-chip-label", text: label }), input, out), input, show };
}

/**
 * Draws a circuit on the breadboard.
 * @param {HTMLElement} container
 * @param {{board: object, circuit: object, parts: object, pins?: Function|Record<string,string>,
 *   step?: number|null, showAll?: boolean, names?: Record<string,{name:string,plural:string}>,
 *   controls?: boolean, label?: string}} opts
 *   board: content/boards/<id>.json; circuit: the project's circuit; parts: from loadParts();
 *   pins: resolvePin(roleOrCode) → {code} (or role → code overrides); names: content/parts/index.json
 *   parts (for the description); controls: false to draw no controls.
 * @returns {{svg: SVGSVGElement, element: HTMLElement, layout: object, setStep(n: number|null): void,
 *   setShowAll(on: boolean): void, setState(state: object): void,
 *   onControl(fn: (partId: string, control: string, value: any) => void): () => void,
 *   controlValues(): Record<string, object>, destroy(): void}}
 */
export function drawBreadboard(container, opts) {
  const { board, circuit, parts, step = null, showAll = false, names, controls = true } = opts;
  const uid = `cp${++viewCount}`;
  const layout = layoutCircuit(opts);
  const { bounds } = layout;
  const label = opts.label || describe(board, circuit, names);

  const root = html("div", { class: "cp-circuit" });
  const svg = svgEl("svg", {
    class: "cp-svg", viewBox: `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`,
    role: "img", "aria-label": label, preserveAspectRatio: "xMidYMid meet",
  });
  svg.append(svgEl("title", {}, label));
  const defs = svgEl("defs");
  defs.append(svgEl("filter", { id: `${uid}-hl`, x: "-30%", y: "-30%", width: "160%", height: "160%", "color-interpolation-filters": "sRGB" },
    svgEl("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 3.2, result: "b" }),
    svgEl("feFlood", { "flood-color": "#19c1ca", "flood-opacity": "0.95" }),
    svgEl("feComposite", { in2: "b", operator: "in", result: "glow" }),
    svgEl("feMerge", {}, svgEl("feMergeNode", { in: "glow" }), svgEl("feMergeNode", { in: "glow" }), svgEl("feMergeNode", { in: "SourceGraphic" }))));
  svg.append(defs);

  const bbLayer = svgEl("g", { class: "cp-layer-breadboard" });
  const partLayer = svgEl("g", { class: "cp-layer-parts" });
  const wireLayer = svgEl("g", { class: "cp-layer-wires" });
  const topLayer = svgEl("g", { class: "cp-layer-onboard" });
  svg.append(bbLayer, partLayer, wireLayer, topLayer);

  if (layout.breadboard) {
    bbLayer.append(svgEl("g", { class: "cp-breadboard" }, artContent("breadboard", parts.breadboard.svg?.breadboard)));
  }
  const boardArt = parts.boards?.[board.id];
  if (layout.board && boardArt) {
    bbLayer.append(svgEl("g", { class: "cp-board", transform: matrixAttr(layout.board.matrix) },
      artContent(`board:${board.id}`, boardArt.svg?.breadboard)));
  }

  const items = []; // {step, el, kind, id}
  const setters = new Map(); // partId → fn(value)
  for (const item of layout.parts) {
    const { part, def, matrix } = item;
    const g = svgEl("g", { class: `cp-part cp-${def.behaviour}`, "data-part": part.id, transform: matrixAttr(matrix) });
    g.append(artContent(`part:${part.type}`, def.svg?.breadboard));
    const set = behaviourFor(item, g, defs, uid);
    if (set) setters.set(part.id, { set, behaviour: def.behaviour });
    (part.at ? topLayer : partLayer).append(g);
    items.push({ step: part.step, el: g, kind: "part", id: part.id });
  }
  for (const w of layout.wires) {
    const col = WIRE_COLORS[w.color];
    const g = svgEl("g", { class: "cp-wire", "data-wire": w.index, "data-color": w.color });
    g.append(
      svgEl("path", { d: w.d, fill: "none", stroke: shade(col, 0.55), "stroke-width": 3.6, "stroke-linecap": "round" }),
      svgEl("path", { d: w.d, fill: "none", stroke: col, "stroke-width": 2.4, "stroke-linecap": "round" }),
      svgEl("path", { d: w.d, fill: "none", stroke: "#fff", "stroke-opacity": 0.35, "stroke-width": 0.7, "stroke-linecap": "round", transform: "translate(-0.5 -0.5)" }),
      svgEl("circle", { cx: w.a.x, cy: w.a.y, r: 1.9, fill: shade(col, 0.6) }),
      svgEl("circle", { cx: w.b.x, cy: w.b.y, r: 1.9, fill: shade(col, 0.6) }),
    );
    wireLayer.append(g);
    items.push({ step: w.wire.step, el: g, kind: "wire", id: w.index });
  }

  root.append(svg);
  const overlay = html("div", { class: "cp-controls" });
  root.append(overlay);
  container.append(root);

  // ----- steps -----
  let curStep = step, all = showAll;
  function applyStep() {
    for (const it of items) {
      const st = stepState(it.step, curStep, all);
      it.el.setAttribute("display", st === "later" ? "none" : "inline");
      it.el.setAttribute("opacity", st === "earlier" ? "0.4" : "1");
      if (st === "current") it.el.setAttribute("filter", `url(#${uid}-hl)`);
      else it.el.removeAttribute("filter");
      it.el.classList.toggle("cp-current", st === "current");
      it.state = st;
    }
    placeControls();
  }

  // ----- controls -----
  const listeners = new Set();
  const values = {};
  const ctrls = []; // {id, el, box (drawing units), kind: "hot"|"chip"}
  const timers = new Set();
  const emit = (id, control, value) => {
    values[id] = { ...values[id], [control]: value };
    const s = setters.get(id);
    if (s) {
      if (s.behaviour === "button" && control === "press") s.set(value);
      if (s.behaviour === "potentiometer" && control === "position") s.set(value);
      if (s.behaviour === "joystick") s.set(values[id]);
      if (s.behaviour === "keypad" && control === "key") s.set(value);
    }
    for (const fn of listeners) {
      try { fn(id, control, value); } catch (e) { console.error(e); }
    }
  };
  const circleBox = (item, c) => {
    const b = boxOf(mul(item.matrix, T(c.x - c.r, c.y - c.r)), 2 * c.r, 2 * c.r);
    return b;
  };
  const nameOf = (part, def) => part.label || names?.[part.type]?.name || def.title || part.type;

  if (controls) {
    for (const item of layout.parts) {
      const { part, def } = item;
      const sim = def.sim || {};
      const nm = nameOf(part, def);
      const def0 = CONTROL_DEFAULTS[def.behaviour];
      if (def0) values[part.id] = { ...def0 };
      const addChip = (title, ...rows) => {
        const chip = html("div", { class: "cp-chip", role: "group", "aria-label": `${title}: ${nm}` },
          html("div", { class: "cp-chip-title", text: title }), ...rows);
        overlay.append(chip);
        ctrls.push({ id: part.id, el: chip, box: item.box, kind: "chip" });
      };
      switch (def.behaviour) {
        case "button": {
          const hot = html("button", { type: "button", class: "cp-hot cp-hot-round", "aria-label": `Press ${nm}`, "aria-pressed": "false", title: `Press ${nm}` });
          let down = false;
          const press = (on) => {
            if (down === on) return;
            down = on;
            hot.setAttribute("aria-pressed", String(on));
            emit(part.id, "press", on);
          };
          hot.addEventListener("pointerdown", (e) => { e.preventDefault(); hot.setPointerCapture?.(e.pointerId); hot.focus(); press(true); });
          for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) hot.addEventListener(ev, () => press(false));
          hot.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); press(true); } });
          hot.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") press(false); });
          hot.addEventListener("blur", () => press(false));
          overlay.append(hot);
          ctrls.push({ id: part.id, el: hot, box: sim.cap ? circleBox(item, { ...sim.cap, r: sim.cap.r * 1.5 }) : item.box, kind: "hot" });
          break;
        }
        case "potentiometer": {
          const hot = html("div", { class: "cp-hot cp-hot-round cp-knob", role: "slider", tabindex: 0, "aria-label": `Turn ${nm}`,
            "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 50, "aria-valuetext": "50%", title: `Drag to turn ${nm}` });
          const setPos = (v) => {
            v = clamp01(v);
            hot.setAttribute("aria-valuenow", Math.round(v * 100));
            hot.setAttribute("aria-valuetext", `${Math.round(v * 100)}%`);
            emit(part.id, "position", v);
          };
          dragValue(hot, () => values[part.id].position, setPos);
          hot.addEventListener("keydown", (e) => {
            const v = values[part.id].position;
            const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key];
            if (step != null) { e.preventDefault(); setPos(v + step); }
            if (e.key === "Home") { e.preventDefault(); setPos(0); }
            if (e.key === "End") { e.preventDefault(); setPos(1); }
          });
          overlay.append(hot);
          ctrls.push({ id: part.id, el: hot, box: sim.knob ? circleBox(item, { ...sim.knob, r: sim.knob.r * 1.6 }) : item.box, kind: "hot" });
          break;
        }
        case "joystick": {
          const hot = html("div", { class: "cp-hot cp-hot-round cp-stick", role: "application", tabindex: 0,
            "aria-label": `Joystick ${nm}: drag it, or use the arrow keys; Space presses it`, title: "Drag the stick" });
          const send = (x, y) => {
            values[part.id].x = x; values[part.id].y = y;
            emit(part.id, "x", x); emit(part.id, "y", y);
          };
          let start = null;
          hot.addEventListener("pointerdown", (e) => {
            e.preventDefault(); hot.setPointerCapture?.(e.pointerId); hot.focus();
            const r = hot.getBoundingClientRect();
            start = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, s: r.width / 2 };
          });
          hot.addEventListener("pointermove", (e) => {
            if (!start) return;
            send(clamp01(0.5 + (e.clientX - start.cx) / start.s / 2), clamp01(0.5 + (e.clientY - start.cy) / start.s / 2));
          });
          const release = () => { if (start) { start = null; send(0.5, 0.5); } };
          hot.addEventListener("pointerup", release);
          hot.addEventListener("pointercancel", release);
          const keys = { ArrowLeft: ["x", 0], ArrowRight: ["x", 1], ArrowUp: ["y", 0], ArrowDown: ["y", 1] };
          hot.addEventListener("keydown", (e) => {
            if (keys[e.key]) {
              e.preventDefault();
              const [axis, v] = keys[e.key];
              if (values[part.id][axis] !== v) { values[part.id][axis] = v; emit(part.id, axis, v); }
            } else if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); emit(part.id, "press", true); }
          });
          hot.addEventListener("keyup", (e) => {
            if (keys[e.key]) { const [axis] = keys[e.key]; values[part.id][axis] = 0.5; emit(part.id, axis, 0.5); }
            if (e.key === " " || e.key === "Enter") emit(part.id, "press", false);
          });
          overlay.append(hot);
          ctrls.push({ id: part.id, el: hot, box: sim.knob ? circleBox(item, { ...sim.knob, r: sim.knob.r * 1.5 }) : item.box, kind: "hot" });
          const pressBtn = html("button", { type: "button", class: "cp-chip-button", text: "Press the stick" });
          pressBtn.addEventListener("pointerdown", () => emit(part.id, "press", true));
          for (const ev of ["pointerup", "pointerleave", "pointercancel"]) pressBtn.addEventListener(ev, () => { if (values[part.id].press) emit(part.id, "press", false); });
          pressBtn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); emit(part.id, "press", true); } });
          pressBtn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") emit(part.id, "press", false); });
          addChip("Joystick", pressBtn);
          break;
        }
        case "keypad": {
          for (const k of sim.keys || []) {
            const hot = html("button", { type: "button", class: "cp-hot cp-key", "aria-label": `Key ${k.key}`, title: `Key ${k.key}` });
            hot.addEventListener("click", () => emit(part.id, "key", k.key));
            overlay.append(hot);
            ctrls.push({ id: part.id, el: hot, box: boxOf(mul(item.matrix, T(k.x, k.y)), k.w, k.h), kind: "hot" });
          }
          break;
        }
        case "ldr": {
          const s = slider({ label: "Light", min: 0, max: 100, step: 1, value: 50, format: (v) => (v < 15 ? "dark" : v > 85 ? "bright" : `${v}%`),
            onInput: (v) => emit(part.id, "light", v / 100) });
          addChip("Light level", s.el);
          break;
        }
        case "hc-sr04": {
          const s = slider({ label: "Distance", min: 2, max: 400, step: 1, value: 100, unit: " cm", onInput: (v) => emit(part.id, "distance", v) });
          addChip("Something in front", s.el);
          break;
        }
        case "dht": {
          const t = slider({ label: "Temperature", min: -10, max: 50, step: 0.5, value: 22, unit: " °C", onInput: (v) => emit(part.id, "t", v) });
          const hm = slider({ label: "Humidity", min: 0, max: 100, step: 1, value: 45, unit: "%", onInput: (v) => emit(part.id, "h", v) });
          addChip("Weather", t.el, hm.el);
          break;
        }
        case "soil-moisture": {
          const s = slider({ label: "Wetness", min: 0, max: 100, step: 1, value: 50, format: (v) => (v < 15 ? "dry" : v > 85 ? "soaked" : `${v}%`),
            onInput: (v) => emit(part.id, "moisture", v / 100) });
          addChip("Soil", s.el);
          break;
        }
        case "pir": {
          const btn = html("button", { type: "button", class: "cp-chip-button", text: "Wave your hand" });
          btn.addEventListener("click", () => {
            emit(part.id, "motion", true);
            btn.classList.add("cp-active");
            btn.textContent = "Motion!";
            const t = setTimeout(() => {
              timers.delete(t);
              emit(part.id, "motion", false);
              btn.classList.remove("cp-active");
              btn.textContent = "Wave your hand";
            }, 2500);
            timers.add(t);
          });
          addChip("Motion sensor", btn);
          break;
        }
        case "rfid": {
          const cards = def.options?.cards || [{ name: "Card", uid: [0xde, 0xad, 0xbe, 0xef] }];
          const btns = cards.map((c) => {
            const b = html("button", { type: "button", class: "cp-chip-button cp-card", text: `Tap the ${c.name.toLowerCase()}`,
              title: `Card number ${c.uid.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join(" ")}` });
            b.addEventListener("click", () => {
              emit(part.id, "card", [...c.uid]);
              b.classList.add("cp-active");
              const t = setTimeout(() => { timers.delete(t); b.classList.remove("cp-active"); }, 600);
              timers.add(t);
            });
            return b;
          });
          addChip("RFID cards", ...btns);
          break;
        }
      }
    }
  }

  function placeControls() {
    if (!ctrls.length) return;
    const ctm = svg.getScreenCTM?.();
    const r = root.getBoundingClientRect();
    if (!ctm || !r.width) return;
    const toScreen = (b) => {
      const p1 = new DOMPoint(b.x, b.y).matrixTransform(ctm);
      const p2 = new DOMPoint(b.x + b.w, b.y + b.h).matrixTransform(ctm);
      return { left: Math.min(p1.x, p2.x) - r.left, top: Math.min(p1.y, p2.y) - r.top, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
    };
    const hidden = new Set(items.filter((i) => i.kind === "part" && i.state === "later").map((i) => i.id));
    const used = [];
    const asRect = (b) => { const q = toScreen(b); return { left: q.left, top: q.top, w: q.width, h: q.height }; };
    const bbScreen = layout.breadboard ? asRect({ x: 0, y: 0, w: layout.breadboard.width, h: layout.breadboard.height }) : null;
    const partScreens = layout.parts.filter((p) => !hidden.has(p.part.id)).map((p) => ({ id: p.part.id, ...asRect(p.box) }));
    for (const c of ctrls) {
      c.el.hidden = hidden.has(c.id);
      if (c.el.hidden) continue;
      const s = toScreen(c.box);
      if (c.kind === "hot") {
        Object.assign(c.el.style, { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px`, height: `${s.height}px` });
      } else {
        // Try above, below, right and left of the part; keep off the
        // breadboard and other chips where possible.
        const w = c.el.offsetWidth || 160, h = c.el.offsetHeight || 40;
        const cx = s.left + s.width / 2 - w / 2, cy = s.top + s.height / 2 - h / 2;
        const spots = [
          [cx, s.top - h - 6], [cx, s.top + s.height + 6],
          [s.left + s.width + 6, cy], [s.left - w - 6, cy],
        ];
        const overlap = (l, t, r2) => Math.max(0, Math.min(l + w, r2.left + r2.w) - Math.max(l, r2.left)) *
          Math.max(0, Math.min(t + h, r2.top + r2.h) - Math.max(t, r2.top));
        let best = null;
        for (const [l0, t0] of spots) {
          const l = Math.max(2, Math.min(l0, r.width - w - 2)), t = Math.max(2, Math.min(t0, r.height - h - 2));
          let cost = (l !== l0 || t !== t0 ? 400 : 0) + used.reduce((sum, u) => sum + overlap(l, t, u) * 3, 0);
          if (bbScreen) cost += overlap(l, t, bbScreen);
          for (const pb of partScreens) if (pb.id !== c.id) cost += overlap(l, t, pb) * 0.5;
          if (!best || cost < best.cost) best = { l, t, cost };
        }
        const left = best.l, top = best.t;
        used.push({ left, top, w, h });
        Object.assign(c.el.style, { left: `${left}px`, top: `${top}px` });
      }
    }
  }
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => placeControls()) : null;
  ro?.observe(root);
  applyStep();
  requestAnimationFrame?.(() => placeControls());

  return {
    svg, element: root, layout,
    setStep(n) { curStep = n; applyStep(); },
    setShowAll(on) { all = !!on; applyStep(); },
    setState(state) {
      for (const [key, map] of Object.entries(state || {})) {
        const beh = STATE_KEYS[key];
        if (!beh || !map) continue;
        for (const [id, v] of Object.entries(map)) {
          const s = setters.get(id);
          if (s && (s.behaviour === beh || (key === "led" && s.behaviour === "rgb-led"))) {
            if (key === "led" && s.behaviour === "rgb-led") continue;
            s.set(v);
          }
        }
      }
    },
    onControl(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    controlValues() { return JSON.parse(JSON.stringify(values)); },
    placeControls,
    destroy() {
      ro?.disconnect();
      for (const t of timers) clearTimeout(t);
      listeners.clear();
      root.remove();
    },
  };
}

/** Drag up/right to turn up, down/left to turn down. */
function dragValue(el, get, set) {
  let start = null;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.focus();
    start = { x: e.clientX, y: e.clientY, v: get() };
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    set(start.v + ((e.clientX - start.x) - (e.clientY - start.y)) / 150);
  });
  for (const ev of ["pointerup", "pointercancel"]) el.addEventListener(ev, () => { start = null; });
  el.addEventListener("wheel", (e) => {
    if (document.activeElement !== el) return; // don't steal page scrolling
    e.preventDefault();
    set(get() - Math.sign(e.deltaY) * 0.05);
  }, { passive: false });
}

/** A darker version of a #rrggbb colour. */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, "0");
  return `#${c(16)}${c(8)}${c(0)}`;
}
