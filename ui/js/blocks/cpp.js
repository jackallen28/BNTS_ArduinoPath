// Blocks <-> C++ for block coding. Plain JSON in and out (Blockly's own
// workspace format), so it runs and is tested without Blockly.
//
//   toBlocks(code)  the C++ a student would see (a starter, their sketch)
//                   -> { blocks: { languageVersion: 0, blocks: [...] } }
//   toCode(state, { project, board })  the blocks -> the C++ that Run,
//                   Check my code and Upload use, with the pin #defines.
//
// The beginner subset becomes friendly blocks (setup / loop, pins, wait,
// servo, distance, Serial, if, compare...). Anything else becomes a grey
// "C++ code" block holding the text as it was, so nothing is ever lost.
// A blank (___) becomes an empty socket; an empty socket becomes ___ again,
// so the Coach's "fill in the blanks" works the same in both views.

import { lex } from "../sim/lexer.js";
import { ROLES, pinHeader } from "../sim/pins.js";
import { SERIAL_SPEEDS } from "./defs.js";

/** The distance helper the "distance in cm" block brings with it (as in the projects). */
export const MEASURE_CM = `long measureCm() {
  // Send a 10 microsecond ping...
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  // ...and time how long the echo takes to come back.
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  return duration / 58;  // sound travels 1 cm there and back in about 58 microseconds
}
`;

const TYPES = new Set(["void", "int", "long", "float", "double", "bool", "boolean", "byte", "char", "unsigned", "short", "String", "word", "uint8_t", "uint16_t", "uint32_t", "int8_t", "int16_t", "int32_t", "size_t"]);
const COMPARE = new Set(["<", ">", "<=", ">=", "==", "!="]);
const ARITH = new Set(["+", "-", "*", "/", "%"]);
const LOGIC = new Set(["&&", "||"]);
// Lower number = binds less tightly.
const PREC = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

class NotBlocks extends Error {}

// ---------------------------------------------------------------- C++ -> blocks

/** The C++ as blocks: Blockly's workspace JSON. */
export function toBlocks(code) {
  const src = String(code ?? "");
  const toks = lex(src).filter((t) => t.t !== "eof");
  const p = new Reader(src, toks);
  const top = [];
  const servos = new Set();
  let i = 0;
  // Which Servo objects exist (for the servo blocks), and is measureCm the standard helper?
  for (let k = 0; k + 2 < toks.length; k++) {
    if (toks[k].v === "Servo" && toks[k + 1].t === "id" && toks[k + 2].v === ";") servos.add(toks[k + 1].v);
  }
  p.servos = servos;
  while (i < toks.length) {
    const t = toks[i];
    if (t.v === "#" && t.bol) {
      const end = lineEnd(toks, i);
      const text = src.slice(t.pos, toks[end - 1].end);
      const def = /^#\s*define\s+(\w+)\b/.exec(text);
      const inc = /^#\s*include\s*<Servo\.h>/.test(text);
      const keep = !(def && (ROLES.includes(def[1]) || def[1] === "ANALOG_MAX")) && !inc;
      if (keep) top.push(raw("ap_raw_top", text));
      i = end;
      continue;
    }
    if (t.v === "Servo" && toks[i + 1]?.t === "id" && toks[i + 2]?.v === ";") { i += 3; continue; }
    const fn = functionAt(toks, i);
    if (fn) {
      const text = src.slice(t.pos, toks[fn.close].end);
      i = fn.close + 1;
      if (fn.name === "measureCm" && squash(stripComments(text)) === squash(stripComments(MEASURE_CM))) continue;
      top.push(p.functionBlock(fn, text));
      continue;
    }
    // A global: a declaration up to its ';' (or anything else, as raw text).
    const end = skipTo(toks, i, ";");
    const text = src.slice(t.pos, toks[end].end);
    let block = null;
    try {
      const r = new Reader(src, toks.slice(i, end + 1));
      r.servos = servos;
      block = r.declaration();
      if (r.i !== r.toks.length) block = null;
    } catch (e) { if (!(e instanceof NotBlocks)) throw e; }
    top.push(block ?? raw("ap_raw_top", text));
    i = end + 1;
  }
  let y = 10;
  for (const b of top) { b.x = 10; b.y = y; y += 60; }
  return { blocks: { languageVersion: 0, blocks: top } };
}

function raw(type, text) {
  return { type, extraState: { code: dedent(text) } };
}

function squash(s) { return s.replace(/\s+/g, ""); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""); }
function dedent(text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const ind = Math.min(...lines.slice(1).filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), Infinity);
  return [lines[0], ...lines.slice(1).map((l) => (Number.isFinite(ind) ? l.slice(ind) : l))].join("\n");
}

/** The index just past the last token on token i's logical line. */
function lineEnd(toks, i) {
  let j = i + 1;
  while (j < toks.length && toks[j].lline === toks[i].lline && !toks[j].bol) j++;
  return j;
}

/** The index of the next `want` at bracket depth 0 (or the last token). */
function skipTo(toks, i, want) {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    const v = toks[j].t === "op" ? toks[j].v : null;
    if (v === "(" || v === "[" || v === "{") depth++;
    else if (v === ")" || v === "]" || v === "}") depth--;
    else if (v === want && depth === 0) return j;
  }
  return toks.length - 1;
}

function matching(toks, i) {
  const open = toks[i].v, close = { "(": ")", "{": "}", "[": "]" }[open];
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].t !== "op") continue;
    if (toks[j].v === open) depth++;
    else if (toks[j].v === close && --depth === 0) return j;
  }
  return toks.length - 1;
}

/** A function definition starting at i: { type, name, params:[open,close], body, close } or null. */
function functionAt(toks, i) {
  let j = i;
  const typeParts = [];
  while (j < toks.length && toks[j].t === "id" && (TYPES.has(toks[j].v) || toks[j].v === "static" || toks[j].v === "const") && !(toks[j + 1]?.v === "(")) typeParts.push(toks[j++].v);
  if (!typeParts.length || toks[j]?.t !== "id" || toks[j + 1]?.v !== "(") return null;
  const name = toks[j].v;
  const pClose = matching(toks, j + 1);
  if (toks[pClose + 1]?.v !== "{") return null;
  return { type: typeParts.join(" "), name, open: j + 1, pClose, body: pClose + 1, close: matching(toks, pClose + 1) };
}

class Reader {
  constructor(src, toks) { this.src = src; this.toks = toks; this.i = 0; this.servos = new Set(); }
  peek(k = 0) { return this.toks[this.i + k]; }
  is(v, k = 0) { const t = this.peek(k); return !!t && t.v === v && (t.t === "op" || t.t === "id"); }
  take(v) { if (!this.is(v)) throw new NotBlocks(v); return this.toks[this.i++]; }
  text(a, b) { return this.src.slice(this.toks[a].pos, this.toks[b].end); }

  functionBlock(fn, text) {
    const r = new Reader(this.src, this.toks);
    r.servos = this.servos;
    if (fn.pClose !== fn.open + 1) return raw("ap_raw_top", text); // has parameters
    r.i = fn.body + 1;
    let body;
    try {
      body = r.statementsUntil(fn.close);
    } catch (e) {
      if (e instanceof NotBlocks) return raw("ap_raw_top", text);
      throw e;
    }
    const stmts = body ? { DO: { block: body } } : {};
    if (fn.name === "setup" && fn.type === "void") return { type: "ap_setup", inputs: stmts };
    if (fn.name === "loop" && fn.type === "void") return { type: "ap_loop", inputs: stmts };
    return { type: "ap_function", fields: { TYPE: fn.type, NAME: fn.name }, inputs: stmts };
  }

  /** Statements up to the token index `end` (exclusive), chained with next. */
  statementsUntil(end) {
    const list = [];
    while (this.i < end) list.push(this.statement());
    return chain(list);
  }

  /** One statement as a block; anything unusual becomes a raw block of its source. */
  statement() {
    const start = this.i;
    try {
      return this.statementBlock();
    } catch (e) {
      if (!(e instanceof NotBlocks)) throw e;
      this.i = start;
      const end = statementEnd(this.toks, start);
      this.i = end + 1;
      return raw("ap_raw", this.text(start, end));
    }
  }

  statementBlock() {
    const t = this.peek();
    if (this.is("{")) throw new NotBlocks("block");
    if (this.is("if")) return this.ifBlock();
    if (this.is("while")) {
      this.take("while"); this.take("(");
      const cond = this.expr(); this.take(")");
      return { type: "ap_while", inputs: { ...socket("COND", cond), ...this.body("DO") } };
    }
    if (this.is("for")) return this.forBlock();
    if (this.is("return")) {
      this.take("return");
      if (this.is(";")) { this.take(";"); return { type: "ap_return_void" }; }
      const v = this.expr(); this.take(";");
      return { type: "ap_return", inputs: socket("VALUE", v) };
    }
    if (t.t === "id" && (TYPES.has(t.v) || t.v === "const")) return this.declaration();
    // name = value;  name += value;  name++;
    if (t.t === "id" && this.peek(1)?.t === "op" && ["=", "+=", "-="].includes(this.peek(1).v)) {
      const name = t.v; const op = this.peek(1).v; this.i += 2;
      const v = this.expr(); this.take(";");
      return { type: "ap_var_set", fields: { NAME: name, OP: op }, inputs: socket("VALUE", v) };
    }
    if (t.t === "id" && (this.is("++", 1) || this.is("--", 1)) && this.is(";", 2)) {
      this.i += 3;
      return { type: "ap_var_change", fields: { NAME: t.v, OP: this.toks[this.i - 2].v } };
    }
    const call = this.callStatement();
    this.take(";");
    return call;
  }

  ifBlock() {
    const conds = [], bodies = [];
    let elseBody;
    this.take("if");
    for (;;) {
      this.take("(");
      conds.push(this.expr());
      this.take(")");
      bodies.push(this.bodyBlock());
      if (!this.is("else")) break;
      this.take("else");
      if (this.is("if")) { this.take("if"); continue; }
      elseBody = this.bodyBlock();
      break;
    }
    const inputs = {};
    conds.forEach((c, k) => {
      Object.assign(inputs, socket(`IF${k}`, c));
      if (bodies[k]) inputs[`DO${k}`] = { block: bodies[k] };
    });
    if (elseBody) inputs.ELSE = { block: elseBody };
    const b = { type: "controls_if", inputs };
    if (conds.length > 1 || elseBody !== undefined) b.extraState = { ...(conds.length > 1 ? { elseIfCount: conds.length - 1 } : {}), ...(elseBody !== undefined ? { hasElse: true } : {}) };
    return b;
  }

  /** for (int i = A; i < B; i++) as a counting loop. */
  forBlock() {
    this.take("for"); this.take("(");
    if (!this.is("int")) throw new NotBlocks("for");
    this.take("int");
    const v = this.peek();
    if (v.t !== "id") throw new NotBlocks("for");
    this.i++;
    this.take("=");
    const from = this.expr(); this.take(";");
    if (!this.is(v.v)) throw new NotBlocks("for");
    this.i++; this.take("<");
    const to = this.expr(); this.take(";");
    if (!this.is(v.v)) throw new NotBlocks("for");
    this.i++; this.take("++"); this.take(")");
    return { type: "ap_for", fields: { VAR: v.v }, inputs: { ...socket("FROM", from), ...socket("TO", to), ...this.body("DO") } };
  }

  /** A { } body or one statement, as a chain of blocks (or null if empty). */
  bodyBlock() {
    if (this.is("{")) {
      const close = matching(this.toks, this.i);
      this.i++;
      const b = this.statementsUntil(close);
      this.i = close + 1;
      return b;
    }
    return this.statement();
  }

  body(name) {
    const b = this.bodyBlock();
    return b ? { [name]: { block: b } } : {};
  }

  /** [const] type name = value;  (top level: a global) */
  declaration() {
    const typeParts = [];
    while (this.peek() && this.peek().t === "id" && (TYPES.has(this.peek().v) || this.peek().v === "const") && this.peek(1)?.t === "id") typeParts.push(this.toks[this.i++].v);
    const name = this.peek();
    if (!typeParts.length || name?.t !== "id" || !this.is("=", 1)) throw new NotBlocks("decl");
    this.i += 2;
    const v = this.expr();
    this.take(";");
    return { type: "ap_var_declare", fields: { TYPE: typeParts.join(" "), NAME: name.v }, inputs: socket("VALUE", v) };
  }

  callStatement() {
    const t = this.peek();
    if (t?.t !== "id") throw new NotBlocks("call");
    // obj.method(args)
    if (this.is(".", 1) && this.peek(2)?.t === "id" && this.is("(", 3)) {
      const obj = t.v, method = this.peek(2).v;
      this.i += 3;
      const args = this.args();
      if (obj === "Serial") {
        if (method === "begin" && args.length === 1 && args[0]?.type === "math_number" && SERIAL_SPEEDS.includes(String(args[0].fields.NUM))) return { type: "ap_serial_begin", fields: { BAUD: String(args[0].fields.NUM) } };
        if ((method === "print" || method === "println") && args.length === 1) return { type: "ap_serial_print", fields: { NL: method }, inputs: socket("VALUE", args[0]) };
        if (method === "println" && args.length === 0) return { type: "ap_serial_print", fields: { NL: "println" }, inputs: socket("VALUE", { type: "text", fields: { TEXT: "" } }) };
      }
      if (this.servos.has(obj) && method === "attach" && args.length === 1) return { type: "ap_servo_attach", fields: { VAR: obj }, inputs: socket("PIN", args[0]) };
      if (this.servos.has(obj) && method === "write" && args.length === 1) return { type: "ap_servo_write", fields: { VAR: obj }, inputs: socket("ANGLE", args[0]) };
      throw new NotBlocks("method");
    }
    if (!this.is("(", 1)) throw new NotBlocks("call");
    const name = t.v;
    this.i += 1;
    const a = this.args();
    const n = a.length;
    if (name === "pinMode" && n === 2 && a[1]?.type === "ap_word" && ["OUTPUT", "INPUT", "INPUT_PULLUP"].includes(a[1].fields.NAME)) return { type: "ap_pin_mode", fields: { MODE: a[1].fields.NAME }, inputs: socket("PIN", a[0]) };
    if (name === "digitalWrite" && n === 2) return { type: "ap_digital_write", inputs: { ...socket("PIN", a[0]), ...socket("VALUE", a[1]) } };
    if (name === "analogWrite" && n === 2) return { type: "ap_analog_write", inputs: { ...socket("PIN", a[0]), ...socket("VALUE", a[1]) } };
    if (name === "delay" && n === 1) return { type: "ap_delay", inputs: socket("MS", a[0]) };
    if (name === "delayMicroseconds" && n === 1) return { type: "ap_delay_us", inputs: socket("US", a[0]) };
    if (name === "tone" && n === 2) return { type: "ap_tone", inputs: { ...socket("PIN", a[0]), ...socket("FREQ", a[1]) } };
    if (name === "tone" && n === 3) return { type: "ap_tone_for", inputs: { ...socket("PIN", a[0]), ...socket("FREQ", a[1]), ...socket("MS", a[2]) } };
    if (name === "noTone" && n === 1) return { type: "ap_no_tone", inputs: socket("PIN", a[0]) };
    if (n === 0 && !TYPES.has(name)) return { type: "ap_call", fields: { NAME: name } };
    throw new NotBlocks("call");
  }

  /** (a, b, c) -> expression blocks (null for a ___ blank). */
  args() {
    this.take("(");
    const out = [];
    if (this.is(")")) { this.take(")"); return out; }
    for (;;) {
      out.push(this.expr());
      if (this.is(",")) { this.take(","); continue; }
      this.take(")");
      return out;
    }
  }

  // Expressions: precedence climbing over the operators blocks know about.
  expr(min = 1) {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || !(t.v in PREC) || PREC[t.v] < min) return left;
      this.i++;
      const right = this.expr(PREC[t.v] + 1);
      left = binary(t.v, left, right);
    }
  }

  unary() {
    if (this.is("!")) { this.i++; return { type: "ap_not", inputs: socket("A", this.unary()) }; }
    if (this.is("-") && this.peek(1)?.t === "num") {
      this.i++;
      const n = this.number();
      n.fields.NUM = -n.fields.NUM;
      return n;
    }
    return this.primary();
  }

  number() {
    const t = this.toks[this.i++];
    if (t.raw && !/^\d+(\.\d+)?$/.test(t.raw)) throw new NotBlocks("number");
    return { type: "math_number", fields: { NUM: t.v } };
  }

  primary() {
    const t = this.peek();
    if (!t) throw new NotBlocks("end");
    if (t.t === "num") return this.number();
    if (t.t === "str") {
      this.i++;
      const text = this.src.slice(t.pos + 1, t.end - 1);
      if (/\\/.test(text)) throw new NotBlocks("escape");
      return { type: "text", fields: { TEXT: text } };
    }
    if (this.is("(")) {
      this.take("(");
      const e = this.expr();
      this.take(")");
      return e;
    }
    if (t.t !== "id") throw new NotBlocks("expr");
    if (t.v === "___") { this.i++; return null; }
    if (this.is("(", 1)) {
      const name = t.v;
      this.i++;
      const a = this.args();
      const n = a.length;
      if (name === "measureCm" && n === 0) return { type: "ap_distance" };
      if (name === "digitalRead" && n === 1) return { type: "ap_digital_read", inputs: socket("PIN", a[0]) };
      if (name === "analogRead" && n === 1) return { type: "ap_analog_read", inputs: socket("PIN", a[0]) };
      if (name === "millis" && n === 0) return { type: "ap_millis" };
      if (name === "random" && n === 2) return { type: "ap_random", inputs: { ...socket("MIN", a[0]), ...socket("MAX", a[1]) } };
      if (name === "map" && n === 5) return { type: "ap_map", inputs: { ...socket("VALUE", a[0]), ...socket("FROM_LOW", a[1]), ...socket("FROM_HIGH", a[2]), ...socket("TO_LOW", a[3]), ...socket("TO_HIGH", a[4]) } };
      if (n === 0 && !TYPES.has(name)) return { type: "ap_call_value", fields: { NAME: name } };
      throw new NotBlocks("call");
    }
    if (this.is(".", 1)) throw new NotBlocks("member");
    this.i++;
    return { type: "ap_word", fields: { NAME: t.v } };
  }
}

/** The last token index of the statement starting at i (for raw blocks). */
function statementEnd(toks, i) {
  const v = toks[i]?.v;
  if (v === "{") return matching(toks, i);
  if (v === "if" || v === "while" || v === "for" || v === "switch") {
    const close = matching(toks, i + 1);
    let end = statementEnd(toks, close + 1);
    if (v === "if" && toks[end + 1]?.v === "else") end = statementEnd(toks, end + 2);
    return end;
  }
  if (v === "do") {
    const end = statementEnd(toks, i + 1);
    return skipTo(toks, end + 1, ";");
  }
  return skipTo(toks, i, ";");
}

function binary(op, a, b) {
  const type = COMPARE.has(op) ? "ap_compare" : ARITH.has(op) ? "ap_arith" : LOGIC.has(op) ? "ap_logic" : null;
  if (!type) throw new NotBlocks(op);
  return { type, fields: { OP: op }, inputs: { ...socket("A", a), ...socket("B", b) } };
}

/** An input holding a value block. Plain numbers and texts are shadows (type over them, or drop a block on them). */
function socket(name, value) {
  if (!value) return {};
  if (value.type === "math_number" || value.type === "text") return { [name]: { shadow: value } };
  return { [name]: { block: value } };
}

function chain(list) {
  const items = list.filter(Boolean);
  for (let k = items.length - 2; k >= 0; k--) items[k].next = { block: items[k + 1] };
  return items[0] ?? null;
}

// ---------------------------------------------------------------- blocks -> C++

const IND = "  ";

/** The blocks as C++, with the pin #defines the blocks use. */
export function toCode(state, { project = null, board = null } = {}) {
  const top = state?.blocks?.blocks ?? [];
  const g = { servos: new Set(), distance: false };
  const globals = [], functions = [], setups = [], loops = [];
  for (const b of top) {
    if (b.type === "ap_setup") setups.push(b);
    else if (b.type === "ap_loop") loops.push(b);
    else if (b.type === "ap_function") functions.push(b);
    else if (isStatement(b.type)) globals.push(b);
    // a value block left on its own does nothing in C++, so it's left out
  }
  const fn = (head, b) => `${head} {\n${stmts(b.inputs?.DO?.block, 1, g)}}\n`;
  const parts = [];
  const globalText = globals.map((b) => stmts(b, 0, g, false)).join("");
  const funcText = functions.map((b) => fn(`${b.fields?.TYPE || "void"} ${b.fields?.NAME || "myFunction"}()`, b));
  const setupText = setups.map((b) => fn("void setup()", b));
  const loopText = loops.map((b) => fn("void loop()", b));
  // (servo and distance blocks were found while making the text above)
  if (g.servos.size) parts.push("#include <Servo.h>\n");
  if (g.servos.size) parts.push([...g.servos].map((s) => `Servo ${s};\n`).join(""));
  if (globalText) parts.push(globalText);
  if (g.distance) parts.push(MEASURE_CM);
  parts.push(...funcText, ...setupText, ...loopText);
  const body = parts.join("\n");
  if (!project || !board) return body;
  return `${pinHeader(project, board, body)}\n${body}`;
}

function isStatement(type) {
  return !VALUE_TYPES.has(type);
}
const VALUE_TYPES = new Set(["math_number", "text", "ap_word", "ap_compare", "ap_arith", "ap_logic", "ap_not", "ap_distance", "ap_digital_read", "ap_analog_read", "ap_millis", "ap_random", "ap_map", "ap_call_value", "ap_raw_value"]);

function stmts(b, depth, g, follow = true) {
  let out = "";
  for (let cur = b; cur; cur = follow ? cur.next?.block : null) {
    out += stmt(cur, depth, g);
    if (!follow) break;
  }
  return out;
}

function stmt(b, d, g) {
  const ind = IND.repeat(d);
  const v = (name, outer = 0) => val(input(b, name), g, outer);
  const body = (name) => stmts(input(b, name), d + 1, g);
  const f = (name) => b.fields?.[name];
  switch (b.type) {
    case "ap_pin_mode": return `${ind}pinMode(${v("PIN")}, ${f("MODE")});\n`;
    case "ap_digital_write": return `${ind}digitalWrite(${v("PIN")}, ${v("VALUE")});\n`;
    case "ap_analog_write": return `${ind}analogWrite(${v("PIN")}, ${v("VALUE")});\n`;
    case "ap_delay": return `${ind}delay(${v("MS")});\n`;
    case "ap_delay_us": return `${ind}delayMicroseconds(${v("US")});\n`;
    case "ap_serial_begin": return `${ind}Serial.begin(${f("BAUD") || 9600});\n`;
    case "ap_serial_print": {
      const nl = f("NL") === "println";
      const value = input(b, "VALUE");
      // println with an empty text just ends the line (an empty socket is a blank).
      if (nl && value?.type === "text" && !value.fields?.TEXT) return `${ind}Serial.println();\n`;
      return `${ind}Serial.${nl ? "println" : "print"}(${v("VALUE")});\n`;
    }
    case "ap_servo_attach": g.servos.add(f("VAR") || "myServo"); return `${ind}${f("VAR") || "myServo"}.attach(${v("PIN")});\n`;
    case "ap_servo_write": g.servos.add(f("VAR") || "myServo"); return `${ind}${f("VAR") || "myServo"}.write(${v("ANGLE")});\n`;
    case "ap_tone": return `${ind}tone(${v("PIN")}, ${v("FREQ")});\n`;
    case "ap_tone_for": return `${ind}tone(${v("PIN")}, ${v("FREQ")}, ${v("MS")});\n`;
    case "ap_no_tone": return `${ind}noTone(${v("PIN")});\n`;
    case "ap_var_declare": return `${ind}${f("TYPE") || "int"} ${f("NAME") || "x"} = ${v("VALUE")};\n`;
    case "ap_var_set": return `${ind}${f("NAME") || "x"} ${f("OP") || "="} ${v("VALUE")};\n`;
    case "ap_var_change": return `${ind}${f("NAME") || "x"}${f("OP") === "--" ? "--" : "++"};\n`;
    case "ap_call": return `${ind}${f("NAME") || "myFunction"}();\n`;
    case "ap_return": return `${ind}return ${v("VALUE")};\n`;
    case "ap_return_void": return `${ind}return;\n`;
    case "ap_while": return `${ind}while (${v("COND")}) {\n${body("DO")}${ind}}\n`;
    case "ap_for": {
      const n = f("VAR") || "i";
      return `${ind}for (int ${n} = ${v("FROM")}; ${n} < ${v("TO", PREC["<"])}; ${n}++) {\n${body("DO")}${ind}}\n`;
    }
    case "controls_if": {
      const k = 1 + (b.extraState?.elseIfCount ?? 0);
      let out = "";
      for (let i = 0; i < k; i++) out += `${i ? " else if" : `${ind}if`} (${val(input(b, `IF${i}`), g)}) {\n${body(`DO${i}`)}${ind}}`;
      if (b.extraState?.hasElse) out += ` else {\n${body("ELSE")}${ind}}`;
      return out + "\n";
    }
    case "ap_raw": case "ap_raw_top": {
      const code = String(b.extraState?.code ?? "");
      if (/\bmeasureCm\s*\(/.test(code)) g.distance = true;
      return code.split("\n").map((l) => (l ? ind + l : l)).join("\n") + "\n";
    }
    default: return `${ind}// (a block ArduinoPath doesn't know: ${b.type})\n`;
  }
}

function input(b, name) {
  const i = b?.inputs?.[name];
  return i?.block ?? i?.shadow ?? null;
}

/** A value block as C++; `outer` is the precedence of the operator around it (for brackets). */
function val(b, g, outer = 0) {
  if (!b) return "___";
  const f = (name) => b.fields?.[name];
  const v = (name, p = 0) => val(input(b, name), g, p);
  switch (b.type) {
    case "math_number": return String(f("NUM") ?? 0);
    case "text": return JSON.stringify(String(f("TEXT") ?? ""));
    case "ap_word": return f("NAME") || "___";
    case "ap_compare": case "ap_arith": case "ap_logic": {
      const op = f("OP");
      const p = PREC[op] ?? 9;
      // Left-to-right: the right side needs brackets at the same level (a - (b - c)).
      const text = `${v("A", p)} ${op} ${v("B", p + 1)}`;
      return p < outer ? `(${text})` : text;
    }
    case "ap_not": return `!${bracket(v("A", 10))}`;
    case "ap_distance": g.distance = true; return "measureCm()";
    case "ap_digital_read": return `digitalRead(${v("PIN")})`;
    case "ap_analog_read": return `analogRead(${v("PIN")})`;
    case "ap_millis": return "millis()";
    case "ap_random": return `random(${v("MIN")}, ${v("MAX")})`;
    case "ap_map": return `map(${v("VALUE")}, ${v("FROM_LOW")}, ${v("FROM_HIGH")}, ${v("TO_LOW")}, ${v("TO_HIGH")})`;
    case "ap_call_value": return `${f("NAME") || "myFunction"}()`;
    case "ap_raw_value": return String(b.extraState?.code ?? "___");
    default: return "___";
  }
}

function bracket(text) {
  return /^[\w.]+(\(.*\))?$/.test(text) ? text : `(${text})`;
}
