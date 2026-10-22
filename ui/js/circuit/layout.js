// Where everything goes in the breadboard drawing: the breadboard at the
// origin, the board to its left, parts on their holes or at their
// "offboard" positions, and Fritzing-style wires between them. Pure
// functions (no DOM), so they're tested in Node.
//
// Units: 0.01 inch (the breadboard's 0.1" pitch is 10). Offboard positions
// are in the same units, measured from the breadboard's top-left corner.

import { activeItems, defaultResolvePin, parseEndpoint, rotateOffset } from "./netlist.js";

/** Fritzing's standard wire colours. */
export const WIRE_COLORS = {
  red: "#cc1414", black: "#404040", blue: "#418dd9", green: "#47cc79", yellow: "#ffe24d",
  orange: "#ff7033", white: "#f2f2f2", purple: "#ab58a2", grey: "#999999", brown: "#8c3b00",
};

const SIGNAL_CYCLE = ["yellow", "green", "blue", "orange", "purple", "white", "grey", "brown"];
const BOARD_GAP = 70;

// 2D affine matrices as [a, b, c, d, e, f] (like SVG's matrix()).
export const I = [1, 0, 0, 1, 0, 0];
export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const T = (x, y) => [1, 0, 0, 1, x, y];
export function R(deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9, s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return [c, s, -s, c, 0, 0];
}
export function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}
/** The box around a rectangle after a transform. */
export function boxOf(m, w, h, x0 = 0, y0 = 0) {
  const pts = [[x0, y0], [x0 + w, y0], [x0, y0 + h], [x0 + w, y0 + h]].map(([x, y]) => apply(m, x, y));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function union(a, b) {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * The transform that puts a part where the circuit says.
 * @param {object} part  a circuit part
 * @param {object} def   its part.json
 * @param {object|null} breadboard  breadboard.json (null when there's no breadboard)
 * @returns {number[]|null}  null if the part can't be placed
 */
export function partMatrix(part, def, breadboard) {
  const rot = part.at ? part.rotate || 0 : part.offboard?.rotate || 0;
  if (part.at && breadboard?.holes?.[part.at] && def.footprint) {
    const hole = breadboard.holes[part.at];
    const first = def.breadboard.connectors[def.legs[0].id];
    return mul(mul(T(hole.x, hole.y), R(rot)), T(-first.x, -first.y));
  }
  if (part.offboard) {
    const r = R(rot);
    const b = boxOf(r, def.breadboard.width, def.breadboard.height);
    return mul(T(part.offboard.x - b.x, part.offboard.y - b.y), r);
  }
  return null;
}

/** Where a board sits: to the left of the breadboard, centred on it. */
export function boardPlace(boardArt, breadboard) {
  const w = boardArt.breadboard.width, h = boardArt.breadboard.height;
  if (!breadboard) return T(-w - BOARD_GAP, 0);
  return T(-w - BOARD_GAP, Math.round((breadboard.height - h) / 2));
}

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/**
 * Picks a wire's colour: its own `color`, else red for power, black for
 * GND, else by signal (role names like LED_GREEN or SDA give a hint).
 */
export function wireColor(wire, index = 0, signalIndex = index) {
  if (wire.color && WIRE_COLORS[wire.color]) return wire.color;
  const ends = [wire.from, wire.to].map(parseEndpoint).filter(Boolean);
  const isGnd = (e) => (e.kind === "power" && e.name === "GND") || (e.kind === "hole" && /^[TB]N/.test(e.hole)) ||
    (e.kind === "part" && /^(gnd|cathode|negative)$/.test(e.leg));
  const isPwr = (e) => (e.kind === "power" && e.name !== "GND") || (e.kind === "hole" && /^[TB]P/.test(e.hole)) ||
    (e.kind === "part" && /^(vcc|power|positive)$/.test(e.leg));
  if (ends.some(isGnd)) return "black";
  if (ends.some(isPwr)) return "red";
  const pin = ends.find((e) => e.kind === "pin");
  if (pin) {
    const n = pin.name;
    if (/GREEN/.test(n)) return "green";
    if (/BLUE/.test(n)) return "blue";
    if (/YELLOW/.test(n)) return "yellow";
    if (/RED/.test(n)) return "orange";
    if (/SDA|MOSI|DIN/.test(n)) return "blue";
    if (/SCL|SCK|CLK/.test(n)) return "yellow";
  }
  return SIGNAL_CYCLE[signalIndex % SIGNAL_CYCLE.length];
}

/**
 * A Fritzing-style wire: a cubic curve from a to b that leaves each end
 * in its direction (if any) and otherwise bends gently.
 * @param {{x:number,y:number,dir?:number[]|null}} a
 * @param {{x:number,y:number,dir?:number[]|null}} b
 * @returns {string} SVG path data
 */
export function wirePath(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const k = Math.max(10, Math.min(dist * 0.4, 80));
  // A little sag to one side, so straight wires look like real wires.
  const sag = Math.min(dist * 0.08, 14);
  const px = (-dy / dist) * sag, py = (dx / dist) * sag;
  const c1 = a.dir ? { x: a.x + a.dir[0] * k, y: a.y + a.dir[1] * k }
    : { x: a.x + dx * 0.3 + px, y: a.y + dy * 0.3 + py };
  const c2 = b.dir ? { x: b.x + b.dir[0] * k, y: b.y + b.dir[1] * k }
    : { x: b.x - dx * 0.3 + px, y: b.y - dy * 0.3 + py };
  const f = (v) => Math.round(v * 100) / 100;
  return `M${f(a.x)} ${f(a.y)}C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
}

/**
 * Lays out a circuit for the breadboard view.
 * @param {{board: object, circuit: object, parts: object, pins?: Function|object}} opts
 * @returns {{breadboard: object|null, board: {matrix: number[], box: object}|null,
 *   parts: Array<{part: object, def: object, matrix: number[], box: object}>,
 *   wires: Array<{wire: object, index: number, a: object, b: object, color: string, d: string}>,
 *   bounds: object, problems: string[]}}
 */
export function layoutCircuit({ board, circuit, parts, pins }) {
  const resolve = typeof pins === "function" ? pins : defaultResolvePin(board, pins || {});
  const { parts: active, wires } = activeItems(circuit, board);
  const problems = [];
  const breadboard = circuit?.breadboard === "none" ? null : parts.breadboard;
  const boardArt = parts.boards?.[board.id] || null;
  let bounds = breadboard ? { x: 0, y: 0, w: breadboard.width, h: breadboard.height } : null;

  let boardLayout = null;
  if (boardArt) {
    const m = boardPlace(boardArt, breadboard);
    boardLayout = { matrix: m, box: boxOf(m, boardArt.breadboard.width, boardArt.breadboard.height) };
    bounds = union(bounds, boardLayout.box);
  }
  const placed = [];
  const byId = new Map();
  for (const part of active) {
    const def = parts.types?.[part.type];
    if (!def) { problems.push(`unknown part type ${part.type}`); continue; }
    const m = partMatrix(part, def, breadboard);
    if (!m) { problems.push(`part ${part.id} has no place`); continue; }
    const p = { part, def, matrix: m, box: boxOf(m, def.breadboard.width, def.breadboard.height) };
    placed.push(p);
    byId.set(part.id, p);
    bounds = union(bounds, p.box);
  }

  // Each endpoint as a point (and the direction a wire should leave it).
  const endPoint = (s, other) => {
    const e = parseEndpoint(s);
    if (!e) return null;
    if (e.kind === "hole") {
      const h = breadboard?.holes?.[e.hole];
      return h ? { x: h.x, y: h.y, hole: true } : null;
    }
    if (!boardArt && (e.kind === "pin" || e.kind === "power")) return null;
    const bm = boardLayout?.matrix;
    if (e.kind === "pin") {
      const r = resolve(e.name);
      const pin = r && boardArt.breadboard.pins[r.code];
      if (!pin) return null;
      return { ...apply(bm, pin.x, pin.y), dir: DIRS[pin.exit] };
    }
    if (e.kind === "power") {
      const name = e.name === "VCC" ? board.power?.vcc || "5V" : e.name;
      const list = boardArt.breadboard.power[name];
      if (!list?.length) return null;
      const pts = list.map((p) => ({ ...apply(bm, p.x, p.y), dir: DIRS[p.exit] }));
      if (!other) return pts[0];
      pts.sort((p, q) => Math.hypot(p.x - other.x, p.y - other.y) - Math.hypot(q.x - other.x, q.y - other.y));
      return pts[0];
    }
    const p = byId.get(e.part);
    const c = p?.def.breadboard.connectors[e.leg];
    if (!c) return null;
    const pt = apply(p.matrix, c.x, c.y);
    if (p.part.at) return pt; // a leg in the breadboard: no particular direction
    // Leave an offboard part away from its middle.
    const cx = p.box.x + p.box.w / 2, cy = p.box.y + p.box.h / 2;
    const ex = (pt.x - cx) / p.box.w, ey = (pt.y - cy) / p.box.h;
    pt.dir = Math.abs(ex) > Math.abs(ey) ? [Math.sign(ex), 0] : [0, Math.sign(ey) || 1];
    return pt;
  };
  // A rough position for an endpoint, to pick the nearest GND pin etc.
  const roughPoint = (s) => {
    const e = parseEndpoint(s);
    if (e?.kind === "power") return null;
    return endPoint(s, null);
  };

  const laid = [];
  let signal = 0;
  wires.forEach((wire, index) => {
    let a = endPoint(wire.from, roughPoint(wire.to));
    let b = endPoint(wire.to, a || roughPoint(wire.from));
    if (!a || !b) { problems.push(`wire ${index + 1} has an unknown end`); return; }
    a = { ...a }; b = { ...b };
    // A wire into a hole arrives straight down (or up) into it.
    for (const [p, q] of [[a, b], [b, a]]) {
      if (p.hole) p.dir = Math.abs(q.x - p.x) > 4 * Math.abs(q.y - p.y) ? null : [0, Math.sign(q.y - p.y) || -1];
    }
    const color = wireColor(wire, index, signal);
    if (!["red", "black"].includes(color) || wire.color) signal++;
    const d = wirePath(a, b);
    laid.push({ wire, index, a, b, color, d });
    const xs = [a.x, b.x], ys = [a.y, b.y];
    bounds = union(bounds, { x: Math.min(...xs) - 6, y: Math.min(...ys) - 6, w: Math.abs(a.x - b.x) + 12, h: Math.abs(a.y - b.y) + 12 });
    // the curve's control points can swing a little outside
    for (const p of [a, b]) {
      if (p.dir) {
        const k = Math.min(Math.hypot(a.x - b.x, a.y - b.y) * 0.4, 80) * 0.75;
        bounds = union(bounds, { x: p.x + p.dir[0] * k - 4, y: p.y + p.dir[1] * k - 4, w: 8, h: 8 });
      }
    }
  });
  bounds = bounds || { x: 0, y: 0, w: 100, h: 100 };
  const m = 14;
  bounds = { x: bounds.x - m, y: bounds.y - m, w: bounds.w + 2 * m, h: bounds.h + 2 * m };
  return { breadboard, board: boardLayout, parts: placed, wires: laid, bounds, problems };
}

/**
 * Which state each item is in for a wiring step: "current" (added in this
 * step), "earlier", "later" (hidden), or "normal" (showAll, or no step).
 */
export function stepState(itemStep, step, showAll) {
  if (showAll || step == null || itemStep == null) return "normal";
  if (itemStep === step) return "current";
  return itemStep < step ? "earlier" : "later";
}

/** The highest step number in a circuit. */
export function stepCount(circuit) {
  let n = 0;
  for (const it of [...(circuit?.parts || []), ...(circuit?.wires || [])]) n = Math.max(n, it.step || 0);
  return n;
}

export { rotateOffset };
