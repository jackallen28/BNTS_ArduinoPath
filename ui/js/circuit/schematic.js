// The schematic view: the board as a box on the left (only the pins the
// circuit uses), each part's Fritzing schematic symbol to the right, and
// orthogonal lines per net. GND and power get the usual symbols at each
// leg instead of long lines, so the drawing stays tidy. Parts joined in a
// chain (pin → resistor → LED → GND) sit in one row, left to right.

import { buildNetlist, defaultResolvePin, activeItems } from "./netlist.js";
import { stepState, apply, mul, T, R } from "./layout.js";
import { svgEl, artContent } from "./svg.js";

const DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const dirName = ([x, y]) => (x < -0.5 ? "left" : x > 0.5 ? "right" : y < 0 ? "up" : "down");
const LINE = "#1a1a1a";
const f = (v) => Math.round(v * 100) / 100;

/** A symbol's transformed connector positions for a rotation. */
function placedSymbol(def, rot) {
  const w = def.schematic.width, h = def.schematic.height;
  const r = R(rot);
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => apply(r, x, y));
  const minX = Math.min(...corners.map((p) => p.x)), minY = Math.min(...corners.map((p) => p.y));
  const m = mul(T(-minX, -minY), r);
  const W = Math.max(...corners.map((p) => p.x)) - minX, H = Math.max(...corners.map((p) => p.y)) - minY;
  const legs = {};
  for (const [id, c] of Object.entries(def.schematic.connectors)) {
    const p = apply(m, c.x, c.y);
    const d = DIR[c.dir] || [-1, 0];
    const rd = apply(r, d[0], d[1]);
    legs[id] = { x: p.x, y: p.y, dir: dirName([rd.x, rd.y]) };
  }
  return { m, w: W, h: H, legs };
}

/**
 * Works out the schematic layout (pure; exported for tests).
 * @returns {{board: object, rows: object[], symbols: object[], pins: object[], nets: object[], bounds: object}}
 */
export function layoutSchematic({ board, circuit, parts, pins }) {
  const resolve = typeof pins === "function" ? pins : defaultResolvePin(board, pins || {});
  const net = buildNetlist(circuit, board, parts, resolve);
  const { parts: active } = activeItems(circuit, board);
  const defs = new Map(active.filter((p) => parts.types?.[p.type]).map((p) => [p.id, parts.types[p.type]]));
  const partOrder = active.filter((p) => defs.has(p.id));
  // Legs joined inside a part (a button's two legs on each side) are one
  // connection in the schematic: only the first of each is drawn.
  const hiddenLegs = new Set();
  for (const p of partOrder) {
    for (const bus of defs.get(p.id).buses || []) for (const leg of bus.slice(1)) hiddenLegs.add(`${p.id}:${leg}`);
  }
  const shown = (l) => !hiddenLegs.has(`${l.part}:${l.leg}`);
  const legsOf = (id) => defs.get(id).legs.filter((l) => !hiddenLegs.has(`${id}:${l.id}`));
  const kindOf = (n) => {
    if (!n) return "none";
    const pw = net.powerOnNet(n);
    if (pw.includes("GND")) return "gnd";
    if (pw.length) return "vcc";
    return net.pinsOnNet(n).length ? "pin" : "internal";
  };
  const boardOrder = new Map((board.pins || []).map((p, i) => [p.code, i]));
  const usedPins = [];
  for (const n of net.nets) {
    if (kindOf(n) !== "pin" || !net.legsOnNet(n).length) continue;
    for (const code of net.pinsOnNet(n)) usedPins.push({ code, net: n });
  }
  // Order pins by where their first part is in the circuit, then by board order.
  const firstPart = (n) => Math.min(...net.legsOnNet(n).map((l) => partOrder.findIndex((p) => p.id === l.part)));
  usedPins.sort((a, b) => firstPart(a.net) - firstPart(b.net) || (boardOrder.get(a.code) ?? 99) - (boardOrder.get(b.code) ?? 99));

  // Rows of parts.
  const placed = new Map(); // id → {row, enter}
  const rows = [];
  const twoLeg = (id) => legsOf(id).length === 2;
  const startRow = (id, enter) => {
    const row = [{ id, enter }];
    placed.set(id, row);
    rows.push(row);
    let cur = row[0];
    while (twoLeg(cur.id)) {
      const other = legsOf(cur.id).find((l) => l.id !== cur.enter)?.id;
      const n = net.legNet(cur.id, other);
      if (kindOf(n) !== "internal") break;
      const next = net.legsOnNet(n).find((l) => !placed.has(l.part) && defs.has(l.part) && shown(l));
      if (!next) break;
      cur = { id: next.part, enter: next.leg };
      row.push(cur);
      placed.set(cur.id, row);
    }
  };
  for (const { net: n } of usedPins) {
    for (const l of net.legsOnNet(n)) if (!placed.has(l.part) && defs.has(l.part) && shown(l)) startRow(l.part, l.leg);
  }
  for (const p of partOrder) if (!placed.has(p.id)) startRow(p.id, legsOf(p.id)[0].id);

  // Symbols: rotate two-leg parts so they read left to right.
  const symbols = [];
  const lanesStart = 120;
  let laneCount = usedPins.length + net.nets.filter((n) => kindOf(n) === "internal").length;
  const partsX = lanesStart + 16 + laneCount * 7 + 16;
  let y = 20;
  for (const row of rows) {
    let x = partsX;
    const syms = row.map(({ id, enter }) => {
      const def = defs.get(id);
      let best = placedSymbol(def, 0);
      const eff = legsOf(id);
      if (eff.length === 2) {
        const out = eff.find((l) => l.id !== enter).id;
        let bestScore = Infinity;
        for (const rot of [0, 90, 180, 270]) {
          const s = placedSymbol(def, rot);
          const score = (s.legs[enter].dir === "left" ? 0 : 10) + (s.legs[out].dir === "right" ? 0 : 5) + s.h / 100;
          if (score < bestScore) { bestScore = score; best = s; }
        }
      } else {
        // Most legs facing left (towards the board) wins.
        let bestScore = -1;
        for (const rot of [0, 90, 180, 270]) {
          const s = placedSymbol(def, rot);
          const score = Object.values(s.legs).filter((l) => l.dir === "left").length;
          if (score > bestScore) { bestScore = score; best = s; }
        }
      }
      return { id, enter, def, ...best };
    });
    const rowH = Math.max(...syms.map((s) => s.h));
    for (const s of syms) {
      s.x = x;
      s.y = y + (rowH - s.h) / 2;
      // line the entering leg up with the row's wire height when it can
      x += s.w + 46;
      s.part = active.find((p) => p.id === s.id);
      s.legsAbs = Object.fromEntries(Object.entries(s.legs).map(([k, l]) => [k, { x: s.x + l.x, y: s.y + l.y, dir: l.dir }]));
      symbols.push(s);
    }
    // In a chain, nudge each next symbol so its entering leg is level with the previous exit.
    for (let i = 1; i < syms.length; i++) {
      const prev = syms[i - 1], s = syms[i];
      const exit = legsOf(prev.id).find((l) => l.id !== prev.enter)?.id;
      const dy = prev.legsAbs[exit].y - s.legsAbs[s.enter].y;
      s.y += dy;
      for (const l of Object.values(s.legsAbs)) l.y += dy;
    }
    const top = Math.min(...syms.map((s) => s.y)), bottom = Math.max(...syms.map((s) => s.y + s.h));
    if (top < y) {
      const dy = y - top;
      for (const s of syms) { s.y += dy; for (const l of Object.values(s.legsAbs)) l.y += dy; }
    }
    y = Math.max(...syms.map((s) => s.y + s.h)) + 46;
    void bottom;
  }
  const symById = new Map(symbols.map((s) => [s.id, s]));

  // Board pins: level with the leg they feed where possible.
  let lastY = 10;
  const pinRows = usedPins.map(({ code, net: n }) => {
    const legs = net.legsOnNet(n).filter((l) => symById.has(l.part) && shown(l));
    const ys = legs.map((l) => symById.get(l.part).legsAbs[l.leg].y);
    let py = ys.length ? Math.min(...ys) : lastY + 14;
    if (py < lastY + 12) py = lastY + 12;
    lastY = py;
    const info = (board.pins || []).find((p) => p.code === code);
    return { code, label: info?.label || code, y: py, net: n };
  });
  const boardTop = Math.min(10, ...pinRows.map((p) => p.y - 22));
  const boardBottom = Math.max(boardTop + 80, ...pinRows.map((p) => p.y + 22));
  const boardBox = { x: 20, y: boardTop, w: lanesStart - 30, h: boardBottom - boardTop };

  // Nets to draw.
  const lines = [];
  let lane = 0;
  for (const p of pinRows) {
    const legs = net.legsOnNet(p.net).filter((l) => symById.has(l.part) && shown(l));
    const lx = lanesStart + 16 + lane++ * 7;
    lines.push({ kind: "pin", net: p.net.id, from: { x: boardBox.x + boardBox.w, y: p.y }, lane: lx, legs: legs.map((l) => ({ ...l, ...symById.get(l.part).legsAbs[l.leg] })) });
  }
  for (const n of net.nets) {
    if (kindOf(n) !== "internal") continue;
    const legs = net.legsOnNet(n).filter((l) => symById.has(l.part) && shown(l)).map((l) => ({ ...l, ...symById.get(l.part).legsAbs[l.leg] }));
    if (legs.length < 2) continue;
    lines.push({ kind: "internal", net: n.id, legs, lane: lanesStart + 16 + lane++ * 7 });
  }
  const power = [];
  for (const s of symbols) {
    for (const [leg, l] of Object.entries(s.legsAbs)) {
      if (hiddenLegs.has(`${s.id}:${leg}`)) continue;
      const n = net.legNet(s.id, leg);
      const k = kindOf(n);
      if (k === "gnd" || k === "vcc") {
        const name = k === "gnd" ? "GND" : net.powerOnNet(n).filter((x) => x !== "GND")[0];
        power.push({ part: s.id, leg, kind: k, name, ...l });
      }
    }
  }
  let maxX = boardBox.x + boardBox.w, maxY = boardBox.y + boardBox.h;
  for (const s of symbols) { maxX = Math.max(maxX, s.x + s.w + 30); maxY = Math.max(maxY, s.y + s.h + 34); }
  const bounds = { x: 0, y: Math.min(0, boardBox.y - 10), w: maxX + 10, h: maxY - Math.min(0, boardBox.y - 10) + 10 };
  return { board: boardBox, pins: pinRows, symbols, lines, power, bounds, netlist: net };
}

function orthoPath(points) {
  return points.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("");
}

/** Route from a lane (x) to a leg end, going round the symbol if the leg doesn't face left. */
function toLeg(laneX, leg, sym) {
  const out = 8;
  switch (leg.dir) {
    case "left": return [{ x: laneX, y: leg.y }, { x: leg.x, y: leg.y }];
    case "up": return [{ x: laneX, y: leg.y - out }, { x: leg.x, y: leg.y - out }, { x: leg.x, y: leg.y }];
    case "down": return [{ x: laneX, y: leg.y + out }, { x: leg.x, y: leg.y + out }, { x: leg.x, y: leg.y }];
    default: {
      const top = sym ? sym.y - 10 : leg.y - out;
      return [{ x: laneX, y: top }, { x: leg.x + out, y: top }, { x: leg.x + out, y: leg.y }, { x: leg.x, y: leg.y }];
    }
  }
}

function powerSymbol(p) {
  const d = DIR[p.dir] || [0, 1];
  const len = 9;
  const ex = p.x + d[0] * len, ey = p.y + d[1] * len;
  const g = svgEl("g", { class: `cp-sch-${p.kind}` });
  g.append(svgEl("path", { d: `M${f(p.x)} ${f(p.y)}L${f(ex)} ${f(ey)}`, stroke: LINE, "stroke-width": 1, fill: "none" }));
  // perpendicular direction
  const px = -d[1], py = d[0];
  if (p.kind === "gnd") {
    const bars = [[7, 0], [4.5, 2.5], [2, 5]];
    for (const [w, o] of bars) {
      const cx = ex + d[0] * o, cy = ey + d[1] * o;
      g.append(svgEl("path", { d: `M${f(cx - px * w)} ${f(cy - py * w)}L${f(cx + px * w)} ${f(cy + py * w)}`, stroke: LINE, "stroke-width": 1.2 }));
    }
  } else {
    g.append(svgEl("path", { d: `M${f(ex - px * 6)} ${f(ey - py * 6)}L${f(ex + px * 6)} ${f(ey + py * 6)}`, stroke: "#b3261e", "stroke-width": 1.4 }));
    const tx = ex + d[0] * 7, ty = ey + d[1] * 7 + (d[1] === 0 ? 2.5 : d[1] > 0 ? 3 : 0);
    g.append(svgEl("text", { x: f(tx), y: f(ty), "font-size": 7, fill: "#b3261e", "text-anchor": d[0] < 0 ? "end" : d[0] > 0 ? "start" : "middle",
      "font-family": "'Segoe UI', Arial, sans-serif" }, p.name || "VCC"));
  }
  return g;
}

/**
 * Draws the circuit's schematic.
 * @param {HTMLElement} container
 * @param {{board: object, circuit: object, parts: object, pins?: Function|object, step?: number|null,
 *   showAll?: boolean, label?: string}} opts  as for drawBreadboard
 * @returns {{svg: SVGSVGElement, element: HTMLElement, layout: object, setStep(n): void,
 *   setShowAll(on: boolean): void, destroy(): void}}
 */
export function drawSchematic(container, opts) {
  const { board, circuit, parts, step = null, showAll = false } = opts;
  const L = layoutSchematic(opts);
  const b = L.bounds;
  const label = opts.label || `Schematic of the circuit for the ${board.name || board.id}`;
  const root = document.createElement("div");
  root.className = "cp-circuit cp-schematic";
  const svg = svgEl("svg", { class: "cp-svg", viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`, role: "img", "aria-label": label, preserveAspectRatio: "xMidYMid meet" });
  svg.append(svgEl("title", {}, label));
  svg.append(svgEl("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "#ffffff" }));
  const items = [];
  const stepOfPart = new Map(activeItems(circuit, board).parts.map((p) => [p.id, p.step]));
  const font = "'Segoe UI', Arial, sans-serif";

  // The board.
  const bb = L.board;
  const boardG = svgEl("g", { class: "cp-sch-board" });
  boardG.append(svgEl("rect", { x: bb.x, y: bb.y, width: bb.w, height: bb.h, fill: "#fff", stroke: LINE, "stroke-width": 1.2 }));
  const title = board.short || board.name || board.id;
  boardG.append(svgEl("text", { x: bb.x + 10, y: bb.y + 14, "font-size": 9, "font-weight": "bold", fill: LINE, "font-family": font }, title));
  svg.append(boardG);
  for (const p of L.pins) {
    const t = svgEl("text", { x: bb.x + bb.w - 4, y: p.y + 3, "font-size": 7.5, fill: "#333", "text-anchor": "end", "font-family": font }, p.label);
    svg.append(t);
    const steps = L.netlist.legsOnNet(p.net).map((l) => stepOfPart.get(l.part)).filter((s) => s != null);
    items.push({ step: steps.length ? Math.min(...steps) : null, el: t });
  }

  // Lines.
  const lineLayer = svgEl("g", { class: "cp-sch-lines", fill: "none", stroke: LINE, "stroke-width": 1 });
  svg.append(lineLayer);
  const symById = new Map(L.symbols.map((s) => [s.id, s]));
  for (const ln of L.lines) {
    const legSteps = ln.legs.map((l) => stepOfPart.get(l.part)).filter((s) => s != null);
    const trunkStep = legSteps.length ? Math.min(...legSteps) : null;
    const routes = ln.legs.map((l) => toLeg(ln.lane, l, symById.get(l.part)));
    const ys = routes.map((r) => r[0].y);
    if (ln.kind === "pin") ys.push(ln.from.y);
    const trunk = svgEl("g", {});
    if (ln.kind === "pin") trunk.append(svgEl("path", { d: orthoPath([ln.from, { x: ln.lane, y: ln.from.y }]) }));
    trunk.append(svgEl("path", { d: orthoPath([{ x: ln.lane, y: Math.min(...ys) }, { x: ln.lane, y: Math.max(...ys) }]) }));
    if (ys.length > 2) for (const yy of ys) trunk.append(svgEl("circle", { cx: ln.lane, cy: yy, r: 1.6, fill: LINE, stroke: "none" }));
    lineLayer.append(trunk);
    items.push({ step: trunkStep, el: trunk });
    ln.legs.forEach((l, i) => {
      const seg = svgEl("path", { d: orthoPath(routes[i]) });
      lineLayer.append(seg);
      items.push({ step: stepOfPart.get(l.part), el: seg });
    });
  }

  // Symbols and power.
  for (const s of L.symbols) {
    const g = svgEl("g", { class: "cp-sch-part", "data-part": s.id });
    g.append(svgEl("g", { transform: `translate(${f(s.x)} ${f(s.y)}) matrix(${s.m.map(f).join(" ")})` }, artContent(`sch:${s.part.type}`, s.def.svg?.schematic)));
    const name = s.part.label || s.id;
    g.append(svgEl("text", { x: f(s.x + s.w / 2), y: f(s.y - 4), "font-size": 7, fill: "#704988", "text-anchor": "middle", "font-family": font }, name));
    for (const p of L.power.filter((q) => q.part === s.id)) g.append(powerSymbol(p));
    svg.append(g);
    items.push({ step: s.part.step, el: g });
  }

  root.append(svg);
  container.append(root);
  let cur = step, all = showAll;
  const applyStep = () => {
    for (const it of items) {
      const st = stepState(it.step, cur, all);
      it.el.setAttribute("display", st === "later" ? "none" : "inline");
      it.el.setAttribute("opacity", st === "earlier" ? "0.4" : "1");
      it.el.classList.toggle("cp-current", st === "current");
    }
  };
  applyStep();
  return {
    svg, element: root, layout: L,
    setStep(n) { cur = n; applyStep(); },
    setShowAll(on) { all = !!on; applyStep(); },
    destroy() { root.remove(); },
  };
}
