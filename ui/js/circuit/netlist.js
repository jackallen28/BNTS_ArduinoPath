// The circuit's netlist: which holes, board pins, power pins and part legs
// are joined. Breadboard strips (A–E and F–J of each column), the four
// power rails, wires and every leg's hole are joined with union-find.
// Parts' own internal joins (from Fritzing's buses, like the two legs on
// each side of a push button) are joined too. Resistors and buttons are
// NOT joined across: the bench decides what flows through them.
//
// Pure functions, no DOM: the same code runs in the browser and in Node.

/** Power pin names a wire can use (`board:<name>`); VCC means the board's logic voltage. */
export const POWER_PINS = ["5V", "3V3", "GND", "VIN", "VCC"];

const HOLE_RE = /^(?:([A-J])([1-9]|[12][0-9]|30)|([TB][PN])([1-9]|1[0-9]|2[0-5]))$/;

/** Is this a breadboard hole name ("A1"–"J30", "TP1"–"BN25")? */
export function isHole(name) {
  return HOLE_RE.test(name);
}

/**
 * The strip a hole belongs to: "col:12:a" (rows A–E of column 12),
 * "col:12:f" (rows F–J), or "rail:TP" (a whole power rail).
 * @param {string} hole
 * @returns {string|null}
 */
export function stripOf(hole) {
  const m = HOLE_RE.exec(hole);
  if (!m) return null;
  if (m[3]) return `rail:${m[3]}`;
  return `col:${m[2]}:${m[1] <= "E" ? "a" : "f"}`;
}

/**
 * Splits a wire endpoint: a hole, `pin:<ROLE or code>`, `board:<power>`
 * or `part:<id>:<leg>`.
 * @param {string} s
 * @returns {{kind: "hole", hole: string} | {kind: "pin", name: string} |
 *   {kind: "power", name: string} | {kind: "part", part: string, leg: string} | null}
 */
export function parseEndpoint(s) {
  if (typeof s !== "string") return null;
  if (isHole(s)) return { kind: "hole", hole: s };
  let m = /^pin:([A-Za-z0-9_]+)$/.exec(s);
  if (m) return { kind: "pin", name: m[1] };
  m = /^board:(5V|3V3|GND|VIN|VCC)$/.exec(s);
  if (m) return { kind: "power", name: m[1] };
  m = /^part:([a-z0-9][a-z0-9-]*):([a-z0-9_-]+)$/.exec(s);
  if (m) return { kind: "part", part: m[1], leg: m[2] };
  return null;
}

/** "3v3" for 3.3V boards, "5v" for 5V boards. */
export function boardVoltage(board) {
  return board?.power?.vcc === "3V3" || board?.logic_volts === 3.3 ? "3v3" : "5v";
}

/**
 * The circuit's parts and wires for this board (dropping `when: "3v3"`
 * items on 5V boards and `when: "5v"` items on 3.3V boards).
 */
export function activeItems(circuit, board) {
  const v = boardVoltage(board);
  const keep = (item) => !item.when || item.when === v;
  return {
    parts: (circuit?.parts || []).filter(keep),
    wires: (circuit?.wires || []).filter(keep),
  };
}

/**
 * Pin overrides from a project's `pins` (by "all", family, then board id).
 * @returns {Record<string, string>} role → pin code
 */
export function pinOverrides(projectPins, board) {
  if (!projectPins) return {};
  const fam = board.family;
  const esp = fam === "esp8266" || fam === "esp32" ? "esp" : null;
  return Object.assign({}, projectPins.all, esp && projectPins[esp], projectPins[fam], projectPins[board.id]);
}

/**
 * A resolvePin function for a board: a role through the pin plan (and
 * overrides), LED_BUILTIN, the bus names (SDA, SCL, MOSI, MISO, SCK, SS),
 * or a pin code. Returns {code} or null if the board has no such pin.
 * @param {object} board  content/boards/<id>.json
 * @param {Record<string, string>} [overrides]  role → code
 * @returns {(name: string) => ({code: string} | null)}
 */
export function defaultResolvePin(board, overrides = {}) {
  const codes = new Set((board.pins || []).map((p) => p.code));
  const special = {
    LED_BUILTIN: board.led_builtin?.pin,
    SDA: board.i2c?.sda, SCL: board.i2c?.scl,
    MOSI: board.spi?.mosi, MISO: board.spi?.miso, SCK: board.spi?.sck, SS: board.spi?.ss,
  };
  return (name) => {
    const code = overrides[name] ?? board.pin_plan?.[name] ?? special[name] ?? name;
    return codes.has(code) ? { code } : null;
  };
}

function toResolver(pins, board) {
  if (typeof pins === "function") return pins;
  return defaultResolvePin(board, pins || {});
}

/** Rotates a footprint offset (in holes) clockwise on screen by 0/90/180/270. */
export function rotateOffset([dx, dy], rotate = 0) {
  switch (((rotate % 360) + 360) % 360) {
    case 90: return [-dy, dx];
    case 180: return [-dx, -dy];
    case 270: return [dy, -dx];
    default: return [dx, dy];
  }
}

// A spatial index of the breadboard's holes, so a leg's position can be
// matched to the nearest hole.
const holeIndexCache = new WeakMap();
function holeIndex(breadboard) {
  let idx = holeIndexCache.get(breadboard);
  if (idx) return idx;
  idx = new Map();
  for (const [name, p] of Object.entries(breadboard.holes)) {
    const key = `${Math.round(p.x / 5)},${Math.round(p.y / 5)}`;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ name, ...p });
  }
  holeIndexCache.set(breadboard, idx);
  return idx;
}

/**
 * The hole at a position on the breadboard (within 0.03"), or null.
 * @param {object} breadboard  ui/parts/breadboard/breadboard.json
 */
export function holeAt(breadboard, x, y) {
  const idx = holeIndex(breadboard);
  const kx = Math.round(x / 5), ky = Math.round(y / 5);
  let best = null, bestD = 3;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const h of idx.get(`${kx + i},${ky + j}`) || []) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bestD) { best = h.name; bestD = d; }
      }
    }
  }
  return best;
}

/** Is (x, y) in the breadboard's centre gap (between rows E and F)? */
function inGap(breadboard, x, y) {
  const e = breadboard.holes.E1, f = breadboard.holes.F1, last = breadboard.holes.E30;
  return y > f.y + 3 && y < e.y - 3 && x > e.x - 5 && x < last.x + 5;
}

/**
 * Where each leg of a breadboard part goes: {holes: {leg: hole}, problems:
 * [{leg, where: "gap" | "off"}]}.
 * @param {object} part  a circuit part (with `at` and `rotate`)
 * @param {object} def   its part.json
 * @param {object} breadboard  breadboard.json
 */
export function legHoles(part, def, breadboard) {
  const out = { holes: {}, problems: [] };
  const start = breadboard?.holes?.[part.at];
  if (!start || !def?.footprint) return out;
  const pitch = breadboard.pitch || 10;
  def.legs.forEach((leg, i) => {
    const [dx, dy] = rotateOffset(def.footprint[i], part.rotate || 0);
    const x = start.x + dx * pitch, y = start.y + dy * pitch;
    const hole = holeAt(breadboard, x, y);
    if (hole) out.holes[leg.id] = hole;
    else out.problems.push({ leg: leg.id, where: inGap(breadboard, x, y) ? "gap" : "off" });
  });
  return out;
}

class UnionFind {
  constructor() { this.parent = new Map(); }
  find(a) {
    if (!this.parent.has(a)) this.parent.set(a, a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(a) !== r) { const n = this.parent.get(a); this.parent.set(a, r); a = n; }
    return r;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Builds the netlist. Node names: "hole:E12", "pin:13" (a board pin, by
 * code), "power:GND" (VCC becomes the board's 5V or 3V3), "leg:red:anode".
 *
 * @param {object} circuit  the project's circuit
 * @param {object} board    content/boards/<id>.json
 * @param {{breadboard: object, types: Record<string, object>}} parts  the part catalogue (part.json data)
 * @param {((name: string) => ({code: string}|null)) | Record<string,string>} [resolvePin]
 * @returns {Netlist}
 */
export function buildNetlist(circuit, board, parts, resolvePin) {
  const resolve = toResolver(resolvePin, board);
  const { parts: active, wires } = activeItems(circuit, board);
  const uf = new UnionFind();
  const nodes = new Set();
  const add = (n) => { nodes.add(n); uf.find(n); return n; };
  const partById = new Map(active.map((p) => [p.id, p]));
  const legHoleMap = {};
  const breadboard = circuit?.breadboard === "none" ? null : parts?.breadboard;

  const endpointNode = (s) => {
    const e = parseEndpoint(s);
    if (!e) return null;
    switch (e.kind) {
      case "hole": return breadboard?.holes?.[e.hole] ? add(`hole:${e.hole}`) : null;
      case "pin": { const r = resolve(e.name); return r ? add(`pin:${r.code}`) : null; }
      case "power": return add(`power:${e.name === "VCC" ? board.power?.vcc || "5V" : e.name}`);
      case "part": {
        const p = partById.get(e.part);
        const def = p && parts?.types?.[p.type];
        if (!def || !def.legs.some((l) => l.id === e.leg)) return null;
        return add(`leg:${e.part}:${e.leg}`);
      }
    }
    return null;
  };

  for (const p of active) {
    const def = parts?.types?.[p.type];
    if (!def) continue;
    for (const leg of def.legs) add(`leg:${p.id}:${leg.id}`);
    for (const bus of def.buses || []) {
      for (let i = 1; i < bus.length; i++) uf.union(`leg:${p.id}:${bus[0]}`, `leg:${p.id}:${bus[i]}`);
    }
    if (breadboard && p.at && def.footprint) {
      const { holes } = legHoles(p, def, breadboard);
      legHoleMap[p.id] = holes;
      for (const [leg, hole] of Object.entries(holes)) uf.union(`leg:${p.id}:${leg}`, add(`hole:${hole}`));
    }
  }
  for (const w of wires) {
    const a = endpointNode(w.from), b = endpointNode(w.to);
    if (a && b) uf.union(a, b);
  }
  // Holes join their strip.
  for (const n of [...nodes]) {
    if (n.startsWith("hole:")) uf.union(n, add(`strip:${stripOf(n.slice(5))}`));
  }
  // Every GND (etc.) pin of the board is one node already ("power:GND").

  const groups = new Map();
  for (const n of nodes) {
    const r = uf.find(n);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  }
  const nets = [];
  const netOfNode = new Map();
  let i = 0;
  for (const members of groups.values()) {
    members.sort();
    const net = { id: `n${i++}`, nodes: members };
    nets.push(net);
    for (const m of members) netOfNode.set(m, net);
  }
  return new Netlist(nets, netOfNode, legHoleMap, active, wires, endpointNode);
}

/** The result of buildNetlist. */
export class Netlist {
  constructor(nets, netOfNode, legHoles, parts, wires, endpointNode) {
    /** Every net: {id, nodes: ["hole:E12", "leg:red:anode", ...]} */
    this.nets = nets;
    /** The hole of each breadboard part's leg: {partId: {leg: "E12"}} */
    this.legHoles = legHoles;
    /** The parts and wires used on this board (after `when`). */
    this.parts = parts;
    this.wires = wires;
    this._netOf = netOfNode;
    this._endpoint = endpointNode;
  }

  /** The net a node is on (or null). */
  netOf(node) { return this._netOf.get(node) || null; }
  /** The net of a part's leg. */
  legNet(partId, leg) { return this.netOf(`leg:${partId}:${leg}`); }
  /** The net of a board pin (by code). */
  pinNet(code) { return this.netOf(`pin:${code}`); }
  /** The net of a power pin ("5V", "3V3", "GND", "VIN"). */
  powerNet(name) { return this.netOf(`power:${name}`); }
  /** The net of a wire endpoint string ("A12", "pin:LED_RED", ...). */
  endpointNet(s) { const n = this._endpoint(s); return n ? this.netOf(n) : null; }

  /** Board pin codes on a net. */
  pinsOnNet(net) { return this._pick(net, "pin:"); }
  /** Power pin names on a net. */
  powerOnNet(net) { return this._pick(net, "power:"); }
  /** Part legs on a net: [{part, leg}]. */
  legsOnNet(net) {
    return this._pick(net, "leg:").map((s) => {
      const i = s.indexOf(":");
      return { part: s.slice(0, i), leg: s.slice(i + 1) };
    });
  }
  /** Board pin codes that share a net with a part's leg. */
  pinsForLeg(partId, leg) { return this.pinsOnNet(this.legNet(partId, leg)); }
  /** Power pins that share a net with a part's leg. */
  powerForLeg(partId, leg) { return this.powerOnNet(this.legNet(partId, leg)); }
  /** Are two nodes joined? */
  joined(a, b) { const na = this.netOf(a); return !!na && na === this.netOf(b); }

  _pick(net, prefix) {
    if (typeof net === "string") net = this.nets.find((n) => n.id === net);
    if (!net) return [];
    return net.nodes.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length));
  }
}

/**
 * Checks a circuit against a board and the parts library. Returns a list
 * of problems: {level: "error" | "warning", code, message, part?, wire?, leg?}.
 * An empty list means the circuit is fine.
 *
 * Codes: duplicate-id, unknown-type, no-place, not-breadboard-part,
 * no-breadboard, unknown-hole, leg-in-gap, leg-off-breadboard,
 * shared-hole, bad-endpoint, unknown-part, unknown-leg, unknown-pin,
 * no-power-pin, short-circuit, five-volt-on-esp-pin, pins-joined, same-hole-wire.
 */
export function validateCircuit(circuit, board, parts, resolvePin) {
  const resolve = toResolver(resolvePin, board);
  const problems = [];
  const err = (code, message, extra = {}) => problems.push({ level: "error", code, message, ...extra });
  const warn = (code, message, extra = {}) => problems.push({ level: "warning", code, message, ...extra });
  const { parts: active, wires } = activeItems(circuit, board);
  const allIds = new Set((circuit?.parts || []).map((p) => p.id));
  const activeIds = new Map(active.map((p) => [p.id, p]));
  const noBreadboard = circuit?.breadboard === "none";
  const breadboard = parts?.breadboard;
  const seen = new Set();
  const holeUse = new Map();

  for (const p of active) {
    if (seen.has(p.id)) err("duplicate-id", `Two parts are called "${p.id}".`, { part: p.id });
    seen.add(p.id);
    const def = parts?.types?.[p.type];
    if (!def) { err("unknown-type", `Part "${p.id}" has an unknown type "${p.type}".`, { part: p.id }); continue; }
    if (p.at) {
      if (noBreadboard) { err("no-breadboard", `Part "${p.id}" is placed at ${p.at}, but this circuit has no breadboard.`, { part: p.id }); continue; }
      if (!def.footprint) { err("not-breadboard-part", `Part "${p.id}" (${p.type}) doesn't plug into a breadboard: give it an "offboard" position.`, { part: p.id }); continue; }
      if (!breadboard?.holes?.[p.at]) { err("unknown-hole", `Part "${p.id}" is at "${p.at}", which isn't a breadboard hole.`, { part: p.id }); continue; }
      const { holes, problems: legProblems } = legHoles(p, def, breadboard);
      for (const lp of legProblems) {
        if (lp.where === "gap") err("leg-in-gap", `Part "${p.id}": leg "${lp.leg}" lands in the gap in the middle of the breadboard.`, { part: p.id, leg: lp.leg });
        else err("leg-off-breadboard", `Part "${p.id}": leg "${lp.leg}" is off the edge of the breadboard.`, { part: p.id, leg: lp.leg });
      }
      for (const [leg, hole] of Object.entries(holes)) {
        const other = holeUse.get(hole);
        if (other) err("shared-hole", `Hole ${hole} has two legs in it: ${other} and ${p.id}:${leg}.`, { part: p.id, leg });
        else holeUse.set(hole, `${p.id}:${leg}`);
      }
    } else if (!p.offboard) {
      err("no-place", `Part "${p.id}" needs an "at" hole or an "offboard" position.`, { part: p.id });
    }
  }

  const powerPins = new Set([...(board.power?.pins || []), "VCC"]);
  wires.forEach((w, i) => {
    const label = `Wire ${i + 1} (${w.from} → ${w.to})`;
    const ends = [w.from, w.to];
    if (w.from === w.to) warn("same-hole-wire", `${label} starts and ends in the same place.`, { wire: i });
    for (const s of ends) {
      const e = parseEndpoint(s);
      if (!e) { err("bad-endpoint", `${label}: "${s}" isn't a hole, pin:, board: or part: end.`, { wire: i }); continue; }
      if (e.kind === "hole") {
        if (noBreadboard) err("no-breadboard", `${label} goes to hole ${e.hole}, but this circuit has no breadboard.`, { wire: i });
        else if (!breadboard?.holes?.[e.hole]) err("unknown-hole", `${label}: ${e.hole} isn't a breadboard hole.`, { wire: i });
        else {
          // A wire in a hole that a leg already uses.
          const other = holeUse.get(e.hole);
          if (other) err("shared-hole", `${label} goes into hole ${e.hole}, where ${other} already is.`, { wire: i });
        }
      } else if (e.kind === "pin") {
        if (!resolve(e.name)) {
          const isRole = /^[A-Z][A-Z0-9_]*$/.test(e.name) && !/^[AD]?\d+$/.test(e.name);
          err("unknown-pin", isRole
            ? `${label}: the ${board.name || board.id} has no pin for "${e.name}" (add it to the pin plan or the project's pins).`
            : `${label}: the ${board.name || board.id} has no pin "${e.name}".`, { wire: i });
        }
      } else if (e.kind === "power") {
        if (!powerPins.has(e.name)) err("no-power-pin", `${label}: the ${board.name || board.id} has no ${e.name} pin.`, { wire: i });
      } else if (e.kind === "part") {
        if (!activeIds.has(e.part)) {
          err("unknown-part", allIds.has(e.part)
            ? `${label} goes to part "${e.part}", which isn't used on this board.`
            : `${label} goes to part "${e.part}", which isn't in the circuit.`, { wire: i });
        } else {
          const def = parts?.types?.[activeIds.get(e.part).type];
          if (def && !def.legs.some((l) => l.id === e.leg)) {
            err("unknown-leg", `${label}: part "${e.part}" has no leg "${e.leg}" (it has ${def.legs.map((l) => l.id).join(", ")}).`, { wire: i });
          }
        }
      }
    }
  });

  // Electrical checks on the nets.
  const net = buildNetlist(circuit, board, parts, resolve);
  const esp = boardVoltage(board) === "3v3";
  for (const n of net.nets) {
    const power = net.powerOnNet(n);
    const pins = net.pinsOnNet(n);
    const supply = power.filter((p) => p !== "GND");
    if (power.includes("GND") && supply.length) {
      err("short-circuit", `${supply.join(" and ")} is joined straight to GND: that's a short circuit.`);
    }
    if (new Set(supply).size > 1) err("short-circuit", `${supply.join(" and ")} are joined together.`);
    if (esp && (supply.includes("5V") || supply.includes("VIN")) && pins.length) {
      err("five-volt-on-esp-pin", `5V reaches pin ${pins.join(", ")}: ESP pins only take 3.3V.`);
    }
    if ((power.includes("GND") || supply.length) && pins.length) {
      warn("pins-joined", `Pin ${pins.join(", ")} is joined straight to ${power.join(", ")}.`);
    } else if (pins.length > 1) {
      warn("pins-joined", `Pins ${pins.join(" and ")} are joined together.`);
    }
  }
  return problems;
}
