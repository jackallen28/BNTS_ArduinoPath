// The preprocessor: #include, #define (with arguments), #if / #ifdef and
// friends, run over the lexer's tokens. Library headers come from
// headers.js; an unknown header stops compiling the way gcc does.

import { lex } from "./lexer.js";

export class CompileError extends Error {
  constructor(line, col, message, extra) {
    super(message);
    this.line = line;
    this.col = col;
    Object.assign(this, extra);
  }
}

const at = (tok, message, extra) => new CompileError(tok.line, tok.col, message, extra);

/**
 * Runs the preprocessor.
 * @param {string} src the sketch
 * @param {object} opts
 * @param {(name: string) => string|null} opts.header returns a library header's text, or null if unknown
 * @param {Record<string,string>} opts.defines predefined object-like macros (name → text)
 * @param {string} [opts.prelude] the name of a header included before the sketch (Arduino.h)
 * @returns {{ tokens: object[], included: string[] }}
 * @throws {CompileError}
 */
export function preprocess(src, { header, defines = {}, prelude = null }) {
  const macros = new Map();
  for (const [name, text] of Object.entries(defines)) {
    macros.set(name, { name, body: lex(String(text), "<built-in>").slice(0, -1) });
  }
  const out = [];
  const included = [];
  const seen = new Set();

  function include(name, tok) {
    if (seen.has(name)) return;
    const text = header(name);
    if (text == null) {
      throw at(tok, `fatal error: ${name}: No such file or directory`, { fatal: true });
    }
    seen.add(name);
    included.push(name);
    run(lex(text, name));
  }

  function run(toks) {
    const conds = []; // { active, taken, sawElse, tok }
    const active = () => conds.every((c) => c.active);
    let i = 0;
    const pending = []; // tokens of normal text, expanded in chunks
    const flush = () => {
      if (pending.length) { expandInto(pending.splice(0), out); }
    };
    while (i < toks.length) {
      const tok = toks[i];
      if (tok.t === "eof") break;
      if (tok.t === "op" && tok.v === "#" && tok.bol) {
        // A directive: the rest of this logical line.
        let j = i + 1;
        while (toks[j].t !== "eof" && toks[j].lline === tok.lline && !toks[j].bol) j++;
        const line = toks.slice(i + 1, j);
        i = j;
        flush();
        directive(tok, line, conds, active);
        continue;
      }
      if (active()) pending.push(tok);
      i++;
    }
    flush();
    if (conds.length) {
      const c = conds[conds.length - 1];
      throw at(c.tok, `unterminated #${c.kind}`);
    }
  }

  function directive(hash, line, conds, active) {
    if (line.length === 0) return; // a lone '#' is allowed
    const name = line[0].t === "id" ? line[0].v : line[0].t === "num" ? "line" : "";
    const rest = line.slice(1);
    switch (name) {
      case "ifdef":
      case "ifndef": {
        const on = active() && rest[0] && (macros.has(rest[0].v) === (name === "ifdef"));
        conds.push({ kind: name, active: !!on, taken: !!on, tok: hash, parentActive: active() });
        return;
      }
      case "if": {
        const parentActive = active();
        const on = parentActive && evalIf(rest, hash) !== 0;
        conds.push({ kind: "if", active: on, taken: on, tok: hash, parentActive });
        return;
      }
      case "elif": {
        const c = conds[conds.length - 1];
        if (!c) throw at(hash, "#elif without #if");
        if (c.sawElse) throw at(hash, "#elif after #else");
        if (c.taken || !c.parentActive) { c.active = false; return; }
        c.active = evalIf(rest, hash) !== 0;
        c.taken = c.active;
        return;
      }
      case "else": {
        const c = conds[conds.length - 1];
        if (!c) throw at(hash, "#else without #if");
        if (c.sawElse) throw at(hash, "#else after #else");
        c.sawElse = true;
        c.active = c.parentActive && !c.taken;
        c.taken = true;
        return;
      }
      case "endif":
        if (!conds.length) throw at(hash, "#endif without #if");
        conds.pop();
        return;
    }
    if (!active()) return;
    switch (name) {
      case "include": {
        let hname;
        const t0 = rest[0];
        if (!t0) throw at(hash, "#include expects \"FILENAME\" or <FILENAME>");
        if (t0.t === "str") hname = String.fromCharCode(...t0.v);
        else if (t0.t === "op" && t0.v === "<") {
          const close = rest.findIndex((t) => t.t === "op" && t.v === ">");
          if (close < 0) throw at(t0, "missing terminating > character");
          hname = rest.slice(1, close).map((t, k, arr) => {
            const prev = arr[k - 1];
            const gap = prev && t.pos > prev.end ? " " : "";
            return gap + (t.t === "num" ? t.raw : t.v);
          }).join("");
        } else throw at(t0, "#include expects \"FILENAME\" or <FILENAME>");
        include(hname.trim(), t0);
        return;
      }
      case "define": {
        const nm = rest[0];
        if (!nm || nm.t !== "id") throw at(nm || hash, "macro names must be identifiers");
        let body = rest.slice(1), params = null, variadic = false;
        if (body[0] && body[0].t === "op" && body[0].v === "(" && body[0].pos === nm.end) {
          params = [];
          let k = 1;
          while (k < body.length && !(body[k].t === "op" && body[k].v === ")")) {
            const p = body[k];
            if (p.t === "id") params.push(p.v);
            else if (p.t === "op" && p.v === "...") { params.push("__VA_ARGS__"); variadic = true; }
            else if (!(p.t === "op" && p.v === ",")) throw at(p, "expected parameter name, found \"" + (p.v || p.t) + "\"");
            k++;
          }
          if (k >= body.length) throw at(nm, "missing ')' in macro parameter list");
          body = body.slice(k + 1);
        }
        macros.set(nm.v, { name: nm.v, params, variadic, body });
        return;
      }
      case "undef":
        if (rest[0]) macros.delete(rest[0].v);
        return;
      case "error":
        throw at(hash, "#error " + rawText(rest));
      case "warning":
      case "pragma":
      case "line":
      case "ident":
        return;
      default:
        throw at(line[0], `invalid preprocessing directive #${line[0].v ?? ""}`);
    }
  }

  function rawText(toks) {
    return toks.map((t) => (t.t === "str" ? '"' + String.fromCharCode(...t.v) + '"' : t.t === "num" ? t.raw : t.t === "chr" ? "'" + String.fromCharCode(t.v & 255) + "'" : t.v)).join(" ");
  }

  // #if expressions: defined(X), macros, integers.
  function evalIf(toks, hash) {
    const pre = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.t === "id" && t.v === "defined") {
        let nm = toks[k + 1];
        if (nm && nm.t === "op" && nm.v === "(") { nm = toks[k + 2]; k += 3; } else k += 1;
        const v = nm && macros.has(nm.v) ? 1 : 0;
        pre.push({ ...t, t: "num", v, num: { v }, raw: String(v) });
        continue;
      }
      pre.push(t);
    }
    const ex = [];
    expandInto(pre, ex);
    let p = 0;
    const peek = () => ex[p];
    const isOp = (v) => ex[p] && ex[p].t === "op" && ex[p].v === v;
    const BIN = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];
    function primary() {
      const t = ex[p++];
      if (!t) throw at(hash, "#if with no expression");
      if (t.t === "num") return t.num ? Math.trunc(t.num.v ?? t.v) : t.v;
      if (t.t === "chr") return t.v;
      if (t.t === "id") return t.v === "true" ? 1 : 0;
      if (t.t === "op") {
        if (t.v === "(") { const v = cond(); if (isOp(")")) p++; return v; }
        if (t.v === "!") return primary() ? 0 : 1;
        if (t.v === "-") return -primary();
        if (t.v === "+") return primary();
        if (t.v === "~") return ~primary();
      }
      throw at(t, "token is not valid in preprocessor expressions");
    }
    function bin(level) {
      if (level >= BIN.length) return primary();
      let v = bin(level + 1);
      while (peek() && peek().t === "op" && BIN[level].includes(peek().v)) {
        const op = ex[p++].v;
        const r = bin(level + 1);
        switch (op) {
          case "||": v = v || r ? 1 : 0; break;
          case "&&": v = v && r ? 1 : 0; break;
          case "|": v |= r; break;
          case "^": v ^= r; break;
          case "&": v &= r; break;
          case "==": v = v === r ? 1 : 0; break;
          case "!=": v = v !== r ? 1 : 0; break;
          case "<": v = v < r ? 1 : 0; break;
          case ">": v = v > r ? 1 : 0; break;
          case "<=": v = v <= r ? 1 : 0; break;
          case ">=": v = v >= r ? 1 : 0; break;
          case "<<": v = v << r; break;
          case ">>": v = v >> r; break;
          case "+": v += r; break;
          case "-": v -= r; break;
          case "*": v *= r; break;
          case "/": if (r === 0) throw at(hash, "division by zero in #if"); v = Math.trunc(v / r); break;
          case "%": if (r === 0) throw at(hash, "division by zero in #if"); v %= r; break;
        }
      }
      return v;
    }
    function cond() {
      const c = bin(0);
      if (isOp("?")) {
        p++;
        const a = cond();
        if (isOp(":")) p++;
        const b = cond();
        return c ? a : b;
      }
      return c;
    }
    return cond();
  }

  // Expands macros in a list of tokens, appending the result to `dest`.
  // Each token may carry `hide`: the macros it came from (not expanded again).
  function expandInto(list, dest) {
    const q = list.slice().reverse(); // a stack: the next token is q[q.length - 1]
    while (q.length) {
      const tok = q.pop();
      if (tok.t === "bad") throw at(tok, tok.msg);
      if (tok.t === "op" && tok.v === "#") throw at(tok, "stray '#' in program");
      if (tok.t !== "id" || !macros.has(tok.v) || (tok.hide && tok.hide.has(tok.v))) {
        dest.push(tok);
        continue;
      }
      const m = macros.get(tok.v);
      const hide = new Set(tok.hide || []);
      hide.add(m.name);
      const place = (t) => ({ ...t, line: tok.line, col: tok.col, endLine: tok.endLine, endCol: tok.endCol, sys: tok.sys, file: tok.file, hide, pos: tok.pos, end: tok.end, fromMacro: m.name });
      if (!m.params) {
        const rep = m.body.map(place);
        for (let k = rep.length - 1; k >= 0; k--) q.push(rep[k]);
        continue;
      }
      // Function-like: only when followed by '('.
      const next = q[q.length - 1];
      if (!next || next.t !== "op" || next.v !== "(") {
        dest.push(tok);
        continue;
      }
      q.pop();
      const args = [[]];
      let depth = 0;
      for (;;) {
        const t = q.pop();
        if (!t || t.t === "eof") throw at(tok, `unterminated argument list invoking macro "${m.name}"`);
        if (t.t === "op" && (t.v === "(" || t.v === "[" || t.v === "{")) depth++;
        if (t.t === "op" && (t.v === ")" || t.v === "]" || t.v === "}")) {
          if (depth === 0 && t.v === ")") break;
          depth--;
        }
        if (t.t === "op" && t.v === "," && depth === 0 && !(m.variadic && args.length === m.params.length)) { args.push([]); continue; }
        args[args.length - 1].push(t);
      }
      if (args.length === 1 && args[0].length === 0 && m.params.length === 0) args.length = 0;
      if (args.length < m.params.length) {
        if (!(m.variadic && args.length === m.params.length - 1)) {
          throw at(tok, `macro "${m.name}" requires ${m.params.length} arguments, but only ${args.length} given`);
        }
        args.push([]);
      }
      if (args.length > m.params.length) {
        throw at(tok, `macro "${m.name}" passed ${args.length} arguments, but takes just ${m.params.length}`);
      }
      const expanded = new Map();
      const argExp = (k) => {
        if (!expanded.has(k)) { const d = []; expandInto(args[k], d); expanded.set(k, d); }
        return expanded.get(k);
      };
      const rep = [];
      const body = m.body;
      for (let k = 0; k < body.length; k++) {
        const b = body[k];
        const pi = b.t === "id" ? m.params.indexOf(b.v) : -1;
        if (b.t === "op" && b.v === "#" && body[k + 1] && m.params.includes(body[k + 1].v)) {
          const arg = args[m.params.indexOf(body[k + 1].v)];
          const text = arg.map((t, j) => (j && t.pos > arg[j - 1].end ? " " : "") + tokText(t)).join("");
          rep.push(place({ t: "str", v: [...text].map((c) => c.charCodeAt(0) & 255) }));
          k++;
          continue;
        }
        if (b.t === "op" && b.v === "##") {
          const left = rep.pop();
          let right = body[++k];
          let rightToks = [];
          if (right) {
            const rpi = right.t === "id" ? m.params.indexOf(right.v) : -1;
            rightToks = rpi >= 0 ? args[rpi].map(place) : [place(right)];
          }
          if (left && rightToks.length) {
            const text = tokText(left) + tokText(rightToks[0]);
            const joined = lex(text).slice(0, -1).map(place);
            rep.push(...joined, ...rightToks.slice(1));
          } else if (left) rep.push(left, ...rightToks);
          else rep.push(...rightToks);
          continue;
        }
        if (pi >= 0) {
          const nextIsPaste = body[k + 1] && body[k + 1].t === "op" && body[k + 1].v === "##";
          const src = nextIsPaste ? args[pi] : argExp(pi);
          for (const t of src) rep.push({ ...t, line: tok.line, col: tok.col, endLine: tok.endLine, endCol: tok.endCol, pos: tok.pos, end: tok.end });
          continue;
        }
        rep.push(place(b));
      }
      for (let k = rep.length - 1; k >= 0; k--) q.push(rep[k]);
    }
  }

  if (prelude) include(prelude, { line: 1, col: 1 });
  const main = lex(src);
  run(main);
  out.push(main[main.length - 1]);
  return { tokens: out, included, macros };
}

function tokText(t) {
  if (t.t === "str") return '"' + String.fromCharCode(...t.v).replace(/["\\]/g, "\\$&") + '"';
  if (t.t === "num") return t.raw ?? String(t.v);
  if (t.t === "chr") return "'" + String.fromCharCode(t.v & 255) + "'";
  return String(t.v);
}
