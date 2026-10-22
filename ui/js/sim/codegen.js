// The code generator: turns the checked AST into JavaScript closures.
//
// The page's security policy forbids eval / new Function, so instead of JS
// source we build closures. Each compiled piece is { g, f }:
//   g = false: f(frame) runs straight through and returns its value
//   g = true:  f is a generator function; it can pause (delay, the
//              instruction budget) and is run with yield*
// Only code that can wait (loops, delay, calls to such functions) uses
// generators, so plain arithmetic stays fast.
//
// A frame is a JS array of a function's locals (slot numbers from the
// checker); globals live in the array G. Statements return a signal:
// undefined (carry on), BRK, CNT or RET (the value is in R.rv).

import { Ptr, SimError, cstr, charArray, writeCStr, printInt, printFloat, itoa, dtostrf, format } from "./values.js";
import { STRING_METHODS, strcmp } from "./strings.js";
import { wrapper, isArith, isInt, zeroOf, typeName, wrapS64, wrapU64 } from "./types.js";
import { exprText } from "./checker.js";

const BRK = 1, CNT = 2, RET = 3;
const K = { k: 0 }; // scratch: the key of the last lvalue location

const S = (f) => ({ g: false, f });
const G_ = (f) => ({ g: true, f });

/** Typed array constructor for an element type, or null for plain arrays. */
function typedFor(t) {
  if (t.k === "bool") return Uint8Array;
  if (t.k === "enum") return Int32Array;
  if (t.k === "float") return t.bits === 32 ? Float32Array : Float64Array;
  if (t.k !== "int") return null;
  switch (t.bits) {
    case 8: return t.signed ? Int8Array : Uint8Array;
    case 16: return t.signed ? Int16Array : Uint16Array;
    case 32: return t.signed ? Int32Array : Uint32Array;
    default: return Float64Array;
  }
}

/**
 * Builds the runnable closures of a checked program for one runtime.
 * @param {object} program from the checker
 * @param {object} R the runtime (runtime.js Machine)
 * @param {object} natives { objects }
 */
export function instantiate(program, R, natives) {
  const G = new Array(program.gslots).fill(0);
  const C = R.cost; // simulated µs per statement
  const lits = program.strings.map((bytes) => {
    const a = new Int8Array(bytes.length + 1);
    for (let i = 0; i < bytes.length; i++) a[i] = bytes[i];
    return { a, p: new Ptr(a, 0) };
  });
  const compiled = new Map(); // Fn → holder { enter, g, slots }

  // ------------------------------------------------------------ errors

  const arrName = (e) => exprText(e) || "the array";
  function outOfRange(e, i, n) {
    const name = arrName(e);
    if (n === 0) return new SimError(`Your code used box ${i} of '${name}', but it has no boxes.`);
    return new SimError(`Your code used box ${i} of '${name}', but it only has ${n} boxes (0 to ${n - 1}). Check your loop or index.`);
  }
  const divZero = () => new SimError("Your code divided by zero. Check the number after the / or % sign.");
  const nullPtr = () => new SimError("Your code used a pointer that points to nothing (NULL).");

  // ------------------------------------------------------------ helpers

  function run(x, f) { return x.f(f); } // sync only
  void run;

  /** Evaluates kids in order, then combine(...values); sync if all kids are. */
  function seq(kids, combine) {
    if (kids.every((k) => !k.g)) {
      const fs = kids.map((k) => k.f);
      switch (fs.length) {
        case 0: return S(() => combine());
        case 1: { const [a] = fs; return S((f) => combine(a(f))); }
        case 2: { const [a, b] = fs; return S((f) => combine(a(f), b(f))); }
        case 3: { const [a, b, c] = fs; return S((f) => combine(a(f), b(f), c(f))); }
        default: return S((f) => combine(...fs.map((x) => x(f))));
      }
    }
    return G_(function* (f) {
      const vals = [];
      for (const k of kids) vals.push(k.g ? yield* k.f(f) : k.f(f));
      return combine(...vals);
    });
  }
  /** seq, but combine also gets the frame. */
  function seqF(kids, combine) {
    if (kids.every((k) => !k.g)) {
      const fs = kids.map((k) => k.f);
      return S((f) => combine(f, ...fs.map((x) => x(f))));
    }
    return G_(function* (f) {
      const vals = [];
      for (const k of kids) vals.push(k.g ? yield* k.f(f) : k.f(f));
      return combine(f, ...vals);
    });
  }
  /** Like seq, but combine returns a generator (a call that can wait). */
  function seqGen(kids, combineGen) {
    return G_(function* (f) {
      const vals = [];
      for (const k of kids) vals.push(k.g ? yield* k.f(f) : k.f(f));
      return yield* combineGen(...vals);
    });
  }
  const konst = (v) => S(() => v);

  // ------------------------------------------------------------ values

  /** A function that makes a fresh zero value of type t. */
  function maker(t) {
    switch (t.k) {
      case "arr": {
        if (t.vla) {
          const n = expr(t.vla);
          if (n.g) throw new SimError("unsupported VLA", "unsupported");
          const elem = maker(t.of);
          const TA = typedFor(t.of);
          return (f) => {
            const len = n.f(f);
            if (len < 0 || len > 100000) throw new SimError(`An array can't have ${len} boxes.`);
            if (TA) return new TA(len);
            const a = new Array(len);
            for (let i = 0; i < len; i++) a[i] = elem(f);
            return a;
          };
        }
        const TA = typedFor(t.of);
        const n = t.n ?? 0;
        if (TA) return () => new TA(n);
        const elem = maker(t.of);
        return (f) => {
          const a = new Array(n);
          for (let i = 0; i < n; i++) a[i] = elem(f);
          return a;
        };
      }
      case "struct": {
        const fields = t.fields.map((fl) => [fl.name, fl.init ? initializer(fl.init, fl.type) : null, maker(fl.type)]);
        return (f) => {
          const o = {};
          for (const [name, init, mk] of fields) o[name] = init ? init.f(f) : mk(f);
          return o;
        };
      }
      case "class": {
        const Impl = t.cls.impl;
        if (!Impl) return () => null;
        return () => new Impl(R);
      }
      default: {
        const z = zeroOf(t);
        return () => z;
      }
    }
  }

  /** A deep copy of a struct (value semantics). */
  function cloner(t) {
    if (t.k === "struct") {
      const fs = t.fields.map((fl) => [fl.name, cloner(fl.type)]);
      return (o) => {
        const c = {};
        for (const [n, cl] of fs) c[n] = cl ? cl(o[n]) : o[n];
        return c;
      };
    }
    if (t.k === "arr") {
      const inner = cloner(t.of);
      return (a) => (inner ? a.map(inner) : a.slice());
    }
    return null;
  }

  // ------------------------------------------------------------ conversions

  /** A JS function converting a value of type `from` to type `to`. */
  function caster(from, to, e) {
    if (to.k === "void") return null;
    if (isArith(to) && isArith(from)) {
      if (to.k === "bool") return (v) => (v !== 0 ? 1 : 0);
      if (to.k === "float") {
        if (to.bits === 64) return null;
        if (from.k === "float" && from.bits === 32) return null;
        return Math.fround;
      }
      // integer target
      if (from.k !== "float" && from.k !== "enum" && from.k !== "bool") {
        const [flo, fhi] = [from.signed ? -(2 ** (from.bits - 1)) : 0, from.signed ? 2 ** (from.bits - 1) - 1 : 2 ** from.bits - 1];
        const tb = to.k === "enum" ? 32 : to.bits;
        const [tlo, thi] = [to.signed !== false ? -(2 ** (tb - 1)) : 0, to.signed !== false ? 2 ** (tb - 1) - 1 : 2 ** tb - 1];
        if (flo >= tlo && fhi <= thi) return null;
      }
      if (from.k === "bool" && to.k !== "bool") return null;
      return wrapper(to);
    }
    if (to.k === "bool") return (v) => (v !== null && v !== 0 ? 1 : 0);
    if (to.k === "ptr") {
      if (from.k === "arr") return (a) => new Ptr(a, 0);
      return null;
    }
    if (to.k === "String") {
      if (from.k === "ptr" || from.k === "arr") return (p) => (from.k === "arr" ? cstr(new Ptr(p, 0)) : cstr(p));
      if (from.k === "class") return (o) => o.toString();
      return null;
    }
    void e;
    return null;
  }

  // ------------------------------------------------------------ text for String + and print

  /** A function turning a value of type t into a byte string (String concat). */
  function toStr(t) {
    if (t.k === "String") return (s) => s;
    if (t.k === "ptr" || t.k === "arr") return (p) => cstr(t.k === "arr" ? new Ptr(p, 0) : p);
    if (t.k === "int" && t.char) return (c) => String.fromCharCode(c & 255);
    if (t.k === "bool") return (b) => (b ? "1" : "0");
    if (t.k === "float") return (v) => dtostrf(v, 4, 2);
    if (t.k === "class") return (o) => o.toString();
    return (v) => String(v);
  }

  /** Print::print(value[, fmt]) for a value of type t → a byte string. */
  function printer(t, hasFmt) {
    const f32 = t.k === "float" && (t.bits === 32 || R.T.avr);
    if (t.k === "String") return (s) => s;
    if (t.k === "ptr" && t.to.k === "struct" && t.to.name === "tm") return (p, fmt) => R.strftime(fmt == null ? "%c" : cstr(fmt), p.a[p.i]);
    if (t.k === "ptr" || t.k === "arr") return (p) => cstr(p);
    if (t.k === "class") return (o) => o.toString();
    if (t.k === "float") return (v, d) => printFloat(v, d ?? 2, f32);
    if (t.k === "int" && t.char && !hasFmt) return (c) => String.fromCharCode(c & 255);
    return (v, base) => printInt(v, base ?? 10, t);
  }

  // ------------------------------------------------------------ lvalues

  /** Where an lvalue lives: { g, f } where f(frame) returns the container and sets K.k. */
  function loc(e) {
    switch (e.k) {
      case "id": {
        const s = e.sym;
        if (s.storage === "native") { const slot = s.slot; return S(() => { K.k = slot; return G; }); }
        if (s.storage !== "local") { const slot = s.slot; return S(() => { K.k = slot; return G; }); }
        const slot = s.slot, depth = e.depth || 0;
        if (s.ref) {
          if (depth) return S((f) => { let fr = f; for (let d = 0; d < depth; d++) fr = fr.up; const p = fr[slot]; K.k = p.i; return p.a; });
          return S((f) => { const p = f[slot]; K.k = p.i; return p.a; });
        }
        if (depth) return S((f) => { let fr = f; for (let d = 0; d < depth; d++) fr = fr.up; K.k = slot; return fr; });
        return S((f) => { K.k = slot; return f; });
      }
      case "index": {
        const a = expr(e.a), i = expr(e.i);
        if (e.kind === "arr") {
          return seq([a, i], (arr, idx) => {
            if (idx >= 0 && idx < arr.length) { K.k = idx; return arr; }
            throw outOfRange(e.a, idx, arr.length);
          });
        }
        return seq([a, i], (p, idx) => {
          if (p === null) throw nullPtr();
          const k = p.i + idx;
          if (k >= 0 && k < p.a.length) { K.k = k; return p.a; }
          throw outOfRange(e.a, idx, p.a.length - p.i);
        });
      }
      case "member": {
        const name = e.name;
        if (e.arrow) {
          const a = expr(e.a);
          return seq([a], (p) => { if (p === null) throw nullPtr(); K.k = name; return p.a[p.i]; });
        }
        if (e.a.type.k === "class") {
          const a = expr(e.a);
          return seq([a], (o) => { K.k = name; return o; });
        }
        const a = e.a.lv ? lvalueGet(e.a) : expr(e.a);
        return seq([a], (o) => { K.k = name; return o; });
      }
      case "un": {
        if (e.op === "*") {
          const a = expr(e.a);
          return seq([a], (p) => {
            if (p === null) throw nullPtr();
            if (typeof p.i === "number" && (p.i < 0 || p.i >= p.a.length)) throw outOfRange(e.a, p.i, p.a.length);
            K.k = p.i;
            return p.a;
          });
        }
        break;
      }
      case "cast":
        if (e.implicit && e.a.lv) return loc(e.a);
        break;
      case "comma": {
        const a = expr(e.a), b = loc(e.b);
        return seqF([a], (f) => b.f(f));
      }
      case "pre": {
        const x = expr(e), l = loc(e.a);
        return seqF([x], (f) => l.f(f));
      }
      case "assign": {
        const x = expr(e), l = loc(e.a);
        return seqF([x], (f) => l.f(f));
      }
      case "cond": {
        const c = expr(e.c), a = loc(e.a), b = loc(e.b);
        if (!c.g && !a.g && !b.g) return S((f) => (c.f(f) ? a.f(f) : b.f(f)));
        return G_(function* (f) {
          const v = c.g ? yield* c.f(f) : c.f(f);
          const x = v ? a : b;
          return x.g ? yield* x.f(f) : x.f(f);
        });
      }
    }
    throw new SimError("The simulator can't change this kind of value.", "unsupported");
  }

  /** Reads an lvalue (the value itself, not a copy). */
  function lvalueGet(e) {
    if (e.k === "id") {
      const s = e.sym;
      if (s.storage !== "local") { const slot = s.slot; return S(() => G[slot]); }
      const slot = s.slot, depth = e.depth || 0;
      if (s.ref) {
        if (depth) return S((f) => { let fr = f; for (let d = 0; d < depth; d++) fr = fr.up; const p = fr[slot]; return p.a[p.i]; });
        return S((f) => { const p = f[slot]; return p.a[p.i]; });
      }
      if (depth) return S((f) => { let fr = f; for (let d = 0; d < depth; d++) fr = fr.up; return fr[slot]; });
      return S((f) => f[slot]);
    }
    if (e.k === "index" && e.kind === "arr") {
      const a = expr(e.a), i = expr(e.i);
      if (!a.g && !i.g) {
        const af = a.f, inf = i.f;
        return S((f) => {
          const arr = af(f), idx = inf(f);
          if (idx >= 0 && idx < arr.length) return arr[idx];
          throw outOfRange(e.a, idx, arr.length);
        });
      }
    }
    const l = loc(e);
    if (!l.g) { const lf = l.f; return S((f) => { const c = lf(f); return c[K.k]; }); }
    return G_(function* (f) { const c = yield* l.f(f); return c[K.k]; });
  }

  /** A Ptr to an lvalue (for &x and reference parameters). */
  function addressOf(e) {
    if (e.k === "id" && e.sym.ref) {
      const slot = e.sym.slot, depth = e.depth || 0;
      return S((f) => { let fr = f; for (let d = 0; d < depth; d++) fr = fr.up; return fr[slot]; });
    }
    const l = loc(e);
    if (!l.g) { const lf = l.f; return S((f) => { const c = lf(f); return new Ptr(c, K.k); }); }
    return G_(function* (f) { const c = yield* l.f(f); return new Ptr(c, K.k); });
  }

  /** Stores the value of `val` into lvalue e; `transform(old, v)` for compound ops. */
  function store(e, val, transform = null, post = false) {
    // s[i] = c on a String
    if (e.k === "index" && e.kind === "string") {
      const base = loc(e.a), idx = expr(e.i);
      return seqF([val ?? konst(0)], (f, v) => {
        const c = base.g ? null : base.f(f);
        if (!c) throw new SimError("The simulator can't change this letter.", "unsupported");
        const k = K.k;
        const s = c[k];
        const i = idx.g ? 0 : idx.f(f);
        if (i >= s.length) return 0;
        const old = s.charCodeAt(i) << 24 >> 24;
        const nv = (transform ? transform(old, v) : v) & 255;
        c[k] = s.slice(0, i) + String.fromCharCode(nv) + s.slice(i + 1);
        return post ? old : nv << 24 >> 24;
      });
    }
    // Fast paths for plain variables.
    if (e.k === "id" && !e.sym.ref && !(e.depth > 0) && val && !val.g) {
      const slot = e.sym.slot, vf = val.f;
      const T = e.sym.storage === "local" ? null : G;
      if (!transform) {
        if (T) return S((f) => (T[slot] = vf(f)));
        return S((f) => (f[slot] = vf(f)));
      }
      if (T) return S((f) => { const old = T[slot]; const nv = transform(old, vf(f)); T[slot] = nv; return post ? old : nv; });
      return S((f) => { const old = f[slot]; const nv = transform(old, vf(f)); f[slot] = nv; return post ? old : nv; });
    }
    const l = loc(e);
    const v = val ?? konst(0);
    if (!l.g && !v.g) {
      const lf = l.f, vf = v.f;
      if (!transform) return S((f) => { const c = lf(f); const k = K.k; return (c[k] = vf(f)); });
      return S((f) => {
        const c = lf(f); const k = K.k;
        const old = c[k];
        const nv = transform(old, vf(f));
        c[k] = nv;
        return post ? old : nv;
      });
    }
    return G_(function* (f) {
      const c = l.g ? yield* l.f(f) : l.f(f);
      const k = K.k;
      const x = v.g ? yield* v.f(f) : v.f(f);
      if (!transform) return (c[k] = x);
      const old = c[k];
      const nv = transform(old, x);
      c[k] = nv;
      return post ? old : nv;
    });
  }

  // ------------------------------------------------------------ expressions

  function expr(e) {
    if (e.cv !== undefined && e.k !== "str" && !(e.k === "id" && e.sym?.kind === "var" && !e.sym.cnst)) {
      if (e.type && (isArith(e.type) || e.cv === null)) return konst(e.cv);
    }
    switch (e.k) {
      case "num": case "chr": case "bool": return konst(e.v);
      case "nullptr": return konst(null);
      case "str": { const a = lits[e.id].a; return konst(a); }
      case "id": {
        const s = e.sym;
        if (s.kind === "const") return konst(s.cv);
        if (s.kind === "func") return konst(null);
        return lvalueGet(e);
      }
      case "this": return S((f) => new Ptr(f, 0));
      case "cast": return castExpr(e);
      case "un": return unary(e);
      case "pre": case "post": return incdec(e);
      case "bin": return binary(e);
      case "assign": return assign(e);
      case "cond": {
        const c = expr(e.c), a = expr(e.a), b = expr(e.b);
        if (!c.g && !a.g && !b.g) { const cf = c.f, af = a.f, bf = b.f; return S((f) => (cf(f) ? af(f) : bf(f))); }
        return G_(function* (f) {
          const v = c.g ? yield* c.f(f) : c.f(f);
          const x = v ? a : b;
          return x.g ? yield* x.f(f) : x.f(f);
        });
      }
      case "comma": {
        const a = expr(e.a), b = expr(e.b);
        return seq([a, b], (_, y) => y);
      }
      case "index": {
        if (e.kind === "string") {
          const a = expr(e.a), i = expr(e.i);
          return seq([a, i], (s, idx) => (idx < s.length ? (s.charCodeAt(idx) << 24) >> 24 : 0));
        }
        return lvalueGet(e);
      }
      case "member": {
        const v = lvalueGet(e);
        return v;
      }
      case "call": return call(e);
      case "strctor": return stringCtor(e);
      case "lambda": {
        const h = compileFn(e.fn);
        return S((f) => fnValue(h, f));
      }
      case "initlist": case "initstr": case "initstruct": case "newobj": case "newstruct": case "classcopy":
        return initializer(e, e.type);
      case "staticref": case "methodref": case "selfmethod":
        throw new SimError("A method name needs () after it to call it.", "unsupported");
    }
    throw new Error("codegen: unknown expression " + e.k);
  }

  function castExpr(e) {
    const a = e.a;
    if (e.declInit) {
      // if (int x = f()): store, then test
      const d = e.declInit;
      const init = initializer(d.initChecked, d.sym.type);
      const st = store({ k: "id", sym: d.sym }, init);
      const test = caster(a.type, e.type);
      return seq([st], (v) => (test ? test(v) : v));
    }
    if (e.fnval) {
      // A function handed over as a callback.
      if (a.k === "lambda") return expr(a);
      const sym = a.sym ?? a.fn?.sym;
      const fn = sym.overloads.find((o) => o.body) ?? sym.overloads[0];
      if (fn.sys) throw new SimError("The simulator can't pass a built-in function as a callback.", "unsupported");
      const h = compileFn(fn);
      const fv = fnValue(h, null);
      return konst(fv);
    }
    if (e.decay) {
      if (a.k === "str") { const p = lits[a.id].p; return konst(p); }
      const x = a.lv ? lvalueGet(a) : expr(a);
      return seq([x], (arr) => new Ptr(arr, 0));
    }
    const x = expr(a);
    const from = a.type, to = e.type;
    if (to.k === "void") return x;
    if (from.k === "struct" && to.k === "struct") {
      const cl = cloner(to);
      return seq([x], cl);
    }
    const fn = caster(from, to, e);
    if (!fn) return x;
    if (!x.g) { const xf = x.f; return S((f) => fn(xf(f))); }
    return seq([x], fn);
  }

  function unary(e) {
    const T = R.T;
    if (e.op === "&") {
      if (e.objref) return expr(e.a);
      if (e.arrAddr) { const a = e.a.k === "str" ? konst(lits[e.a.id].a) : lvalueGet(e.a); return seq([a], (arr) => new Ptr(arr, 0)); }
      if (e.a.k === "un" && e.a.op === "*") return expr(e.a.a);
      return addressOf(e.a);
    }
    if (e.op === "*") return lvalueGet(e);
    const a = expr(e.a);
    const w = wrapper(e.type);
    switch (e.op) {
      case "!": return seq([a], (v) => (v ? 0 : 1));
      case "~":
        if (e.type.bits > 32) return seq([a], (v) => Number(e.type.signed ? BigInt.asIntN(64, ~BigInt(v)) : BigInt.asUintN(64, ~BigInt(v))));
        return seq([a], (v) => w(~v));
      case "-": return seq([a], (v) => w(-v));
      case "+": return a;
    }
    void T;
    throw new Error("unary " + e.op);
  }

  function incdec(e) {
    const t = e.type;
    const d = e.op === "++" ? 1 : -1;
    let tr;
    if (t.k === "ptr") tr = (p) => { if (p === null) throw nullPtr(); return new Ptr(p.a, p.i + d); };
    else if (t.k === "bool") tr = () => 1;
    else { const w = wrapper(t); tr = (v) => w(v + d); }
    return store(e.a, konst(0), (old) => tr(old), e.k === "post");
  }

  /** The JS function for an arithmetic operator on type t. */
  function arith(op, t) {
    if (t.k === "float") {
      const r = t.bits === 32 ? Math.fround : (v) => v;
      switch (op) {
        case "+": return (a, b) => r(a + b);
        case "-": return (a, b) => r(a - b);
        case "*": return (a, b) => r(a * b);
        case "/": return (a, b) => r(a / b);
      }
    }
    const w = wrapper(t);
    if (t.bits > 32) {
      const big = (f) => (a, b) => (t.signed ? wrapS64 : wrapU64)(Number(f(BigInt(Math.trunc(a)), BigInt(Math.trunc(b)))));
      switch (op) {
        case "+": return (a, b) => w(a + b);
        case "-": return (a, b) => w(a - b);
        case "*": return big((a, b) => (t.signed ? BigInt.asIntN(64, a * b) : BigInt.asUintN(64, a * b)));
        case "/": return (a, b) => { if (b === 0) throw divZero(); return w(Math.trunc(a / b)); };
        case "%": return (a, b) => { if (b === 0) throw divZero(); return w(a % b); };
        case "&": return big((a, b) => a & b);
        case "|": return big((a, b) => a | b);
        case "^": return big((a, b) => a ^ b);
      }
    }
    const b32 = t.bits === 32;
    switch (op) {
      case "+": return b32 ? (t.signed ? (a, b) => (a + b) | 0 : (a, b) => (a + b) >>> 0) : (a, b) => w(a + b);
      case "-": return b32 ? (t.signed ? (a, b) => (a - b) | 0 : (a, b) => (a - b) >>> 0) : (a, b) => w(a - b);
      case "*": return b32 ? (t.signed ? (a, b) => Math.imul(a, b) : (a, b) => Math.imul(a, b) >>> 0) : (a, b) => w(a * b);
      case "/": return (a, b) => { if (b === 0) throw divZero(); return w(Math.trunc(a / b)); };
      case "%": return (a, b) => { if (b === 0) throw divZero(); return w(a % b); };
      case "&": return (a, b) => w(a & b);
      case "|": return (a, b) => w(a | b);
      case "^": return (a, b) => w(a ^ b);
    }
    throw new Error("arith " + op);
  }

  function shift(op, t) {
    const w = wrapper(t);
    if (t.bits > 32) {
      return op === "<<"
        ? (a, b) => w(Number((t.signed ? BigInt.asIntN : BigInt.asUintN)(64, BigInt(a) << BigInt(b))))
        : (a, b) => w(Number(BigInt(a) >> BigInt(b)));
    }
    if (op === "<<") return (a, b) => w(a << b);
    if (!t.signed && t.bits === 32) return (a, b) => a >>> b;
    return (a, b) => a >> b;
  }

  const CMP = {
    "==": (a, b) => (a === b ? 1 : 0), "!=": (a, b) => (a !== b ? 1 : 0),
    "<": (a, b) => (a < b ? 1 : 0), ">": (a, b) => (a > b ? 1 : 0),
    "<=": (a, b) => (a <= b ? 1 : 0), ">=": (a, b) => (a >= b ? 1 : 0),
  };

  function ptrEq(a, b) {
    if (a === 0) a = null;
    if (b === 0) b = null;
    if (a === null || b === null) return a === b;
    return a.a === b.a && a.i === b.i;
  }

  function binary(e) {
    const op = e.op;
    const a = expr(e.a), b = expr(e.b);
    switch (e.kind) {
      case "logic": {
        if (!a.g && !b.g) {
          const af = a.f, bf = b.f;
          return op === "&&" ? S((f) => (af(f) && bf(f) ? 1 : 0)) : S((f) => (af(f) || bf(f) ? 1 : 0));
        }
        return G_(function* (f) {
          const x = a.g ? yield* a.f(f) : a.f(f);
          if (op === "&&" ? !x : x) return op === "&&" ? 0 : 1;
          const y = b.g ? yield* b.f(f) : b.f(f);
          return y ? 1 : 0;
        });
      }
      case "arith": {
        const fn = arith(op, e.opType);
        if (!a.g && !b.g) { const af = a.f, bf = b.f; return S((f) => fn(af(f), bf(f))); }
        return seq([a, b], fn);
      }
      case "shift": return seq([a, b], shift(op, e.opType));
      case "cmp": {
        const fn = CMP[op];
        if (!a.g && !b.g) { const af = a.f, bf = b.f; return S((f) => fn(af(f), bf(f))); }
        return seq([a, b], fn);
      }
      case "strcat": {
        const sa = toStr(e.a.type), sb = toStr(e.b.type);
        return seq([a, b], (x, y) => sa(x) + sb(y));
      }
      case "strcmp": {
        const sa = toStr(e.a.type), sb = toStr(e.b.type);
        const fn = CMP[op];
        return seq([a, b], (x, y) => fn(strcmp(sa(x), sb(y)), 0));
      }
      case "ptradd": {
        const d = op === "-" ? -1 : 1;
        return seq([a, b], (p, n) => { if (p === null) throw nullPtr(); return new Ptr(p.a, p.i + d * n); });
      }
      case "ptrdiff": return seq([a, b], (p, q) => {
        if (p === null || q === null) throw nullPtr();
        return p.i - q.i;
      });
      case "ptrcmp": {
        if (op === "==") return seq([a, b], (p, q) => (ptrEq(p, q) ? 1 : 0));
        if (op === "!=") return seq([a, b], (p, q) => (ptrEq(p, q) ? 0 : 1));
        const fn = CMP[op];
        return seq([a, b], (p, q) => fn(p?.i ?? 0, q?.i ?? 0));
      }
    }
    throw new Error("binary " + e.kind);
  }

  function assign(e) {
    const t = e.type;
    if (e.op === "=") {
      let v = e.b.k && ["initlist", "initstruct", "newstruct"].includes(e.b.k) ? initializer(e.b, t) : expr(e.b);
      if (t.k === "struct" && !["initlist", "initstruct", "newstruct"].includes(e.b.k) && e.b.k !== "cast") {
        const cl = cloner(t);
        v = seq([v], cl);
      }
      return store(e.a, v);
    }
    const b = expr(e.b);
    if (e.kind === "strcat") {
      const sb = toStr(e.b.type);
      return store(e.a, b, (old, x) => old + sb(x));
    }
    if (e.kind === "ptradd") {
      const d = e.op === "-=" ? -1 : 1;
      return store(e.a, b, (p, n) => { if (p === null) throw nullPtr(); return new Ptr(p.a, p.i + d * n); });
    }
    const ct = e.opType;
    const up = caster(t, ct) || ((v) => v);
    const down = caster(ct, t) || ((v) => v);
    const fn = e.kind === "shift" ? shift(e.bop, ct) : arith(e.bop, ct);
    return store(e.a, b, (old, x) => down(fn(up(old), x)));
  }

  // ------------------------------------------------------------ calls

  function argValues(fn, args) {
    return args.map((a, i) => {
      const p = fn.params?.[i];
      if (p && p.ref && !a.refTemp) return addressOf(a);
      if (p && p.ref) { const x = expr(a); return seq([x], (v) => new Ptr([v], 0)); }
      const x = expr(a);
      if (a.type?.k === "struct") { const cl = cloner(a.type); return seq([x], cl); }
      return x;
    });
  }

  function call(e) {
    switch (e.kind) {
      case "user": return userCall(e);
      case "native": return nativeCall(e);
      case "method": case "static": return methodCall(e);
      case "print": return printCall(e);
      case "printf": {
        const obj = expr(e.obj);
        const args = e.args.map(expr);
        const types = e.args.map((a) => a.type);
        return seq([obj, ...args], (o, fmt, ...rest) => {
          const s = format(cstr(fmt), rest.map((v, i) => ({ v: types[i + 1].k === "String" ? v : v, t: types[i + 1] })), { avr: R.T.avr });
          o.printStr(s);
          return s.length;
        });
      }
      case "string": return stringCall(e);
      case "structmethod": return structMethodCall(e);
      case "fnvalue": {
        const callee = expr(e.fn);
        const args = e.args.map((a, i) => (e.refs?.[i] ? addressOf(a) : expr(a)));
        return seqGen([callee, ...args], function* (fv, ...vals) {
          if (!fv) throw new SimError("Your code called a function variable that is empty.");
          return yield* fv.call(...vals);
        });
      }
    }
    throw new Error("call kind " + e.kind);
  }

  function userCall(e) {
    const fn = e.callee;
    const h = compileFn(fn);
    const args = argValues(fn, e.args);
    const slots = () => h.slots;
    if (!h.g && args.every((a) => !a.g)) {
      const afs = args.map((a) => a.f);
      const n = afs.length;
      if (n === 0) return S(() => h.enter(new Array(slots())));
      if (n === 1) { const a0 = afs[0]; return S((f) => { const fr = new Array(slots()); fr[0] = a0(f); return h.enter(fr); }); }
      if (n === 2) { const [a0, a1] = afs; return S((f) => { const fr = new Array(slots()); fr[0] = a0(f); fr[1] = a1(f); return h.enter(fr); }); }
      return S((f) => {
        const fr = new Array(slots());
        for (let i = 0; i < n; i++) fr[i] = afs[i](f);
        return h.enter(fr);
      });
    }
    return G_(function* (f) {
      const fr = new Array(slots());
      for (let i = 0; i < args.length; i++) fr[i] = args[i].g ? yield* args[i].f(f) : args[i].f(f);
      return h.g ? yield* h.enter(fr) : h.enter(fr);
    });
  }

  function retConv(fn) {
    const t = fn.ret;
    if (!t || t.k === "void") return null;
    if (isArith(t)) {
      if (isInt(t) || t.k === "bool" || t.bits === 32) return wrapper(t);
      return null;
    }
    return null;
  }

  function nativeArgs(fn, args) {
    const fixed = argValues(fn, args.slice(0, fn.params.length));
    if (!fn.variadic) return { fixed, extra: null };
    const extras = args.slice(fn.params.length);
    return { fixed, extra: extras.map(expr), types: extras.map((a) => a.type) };
  }

  function nativeCall(e) {
    const fn = e.callee;
    const impl = fn.native;
    const rc = retConv(fn);
    const { fixed, extra, types } = nativeArgs(fn, e.args);
    const kids = extra ? [...fixed, ...extra] : fixed;
    const nf = fixed.length;
    const pack = extra ? (vals) => [...vals.slice(0, nf), vals.slice(nf).map((v, i) => ({ v, t: types[i] }))] : (vals) => vals;
    if (fn.gen) {
      return seqGen(kids, function* (...vals) {
        const r = yield* impl(R, ...pack(vals));
        return rc ? rc(r) : r;
      });
    }
    if (!extra && kids.every((k) => !k.g)) {
      const fs = kids.map((k) => k.f);
      if (fs.length === 0) return S(() => { const r = impl(R); return rc ? rc(r) : r; });
      if (fs.length === 1) { const [a] = fs; return S((f) => { const r = impl(R, a(f)); return rc ? rc(r) : r; }); }
      if (fs.length === 2) { const [a, b] = fs; return S((f) => { const r = impl(R, a(f), b(f)); return rc ? rc(r) : r; }); }
    }
    return seq(kids, (...vals) => { const r = impl(R, ...pack(vals)); return rc ? rc(r) : r; });
  }

  function methodCall(e) {
    const fn = e.callee;
    const rc = retConv(fn);
    const name = e.name;
    const { fixed, extra, types } = nativeArgs(fn, e.args);
    const nf = fixed.length;
    const pack = extra ? (vals) => [...vals.slice(0, nf), vals.slice(nf).map((v, i) => ({ v, t: types[i] }))] : (vals) => vals;
    const extraKids = extra || [];
    if (e.kind === "static") {
      const Impl = e.cls.impl;
      return seq([...fixed, ...extraKids], (...vals) => { const r = Impl[name](...pack(vals)); return rc ? rc(r) : r; });
    }
    const obj = expr(e.obj);
    const kids = [obj, ...fixed, ...extraKids];
    if (fn.gen) {
      return seqGen(kids, function* (o, ...vals) {
        if (o == null) throw nullPtr();
        const r = yield* o[name](...pack(vals));
        return rc ? rc(r) : r;
      });
    }
    return seq(kids, (o, ...vals) => {
      if (o == null) throw nullPtr();
      const r = o[name](...pack(vals));
      return rc ? rc(r) : r;
    });
  }

  function printCall(e) {
    const obj = expr(e.obj);
    const args = e.args.map(expr);
    const nl = e.ln ? "\r\n" : "";
    if (!args.length) return seq([obj], (o) => { o.printStr(nl); return nl.length; });
    const p = printer(e.args[0].type, args.length > 1);
    return seq([obj, ...args], (o, v, fmt) => {
      const s = p(v, fmt) + nl;
      o.printStr(s);
      return s.length;
    });
  }

  function stringCall(e) {
    const spec = STRING_METHODS[e.name];
    const kinds = spec.args;
    const conv = e.args.map((a, i) => {
      const t = a.type;
      const k = kinds[i];
      if (k === "num" || k === "buf") return null;
      if (k === "textchar" && isArith(t)) return (c) => String.fromCharCode(c & 255);
      return toStr(t);
    });
    const args = e.args.map(expr);
    const obj = expr(e.obj);
    const cv = (vals) => vals.map((v, i) => (conv[i] ? conv[i](v) : v));
    if (e.name === "c_str") return seq([obj], (s) => new Ptr(charArray(s), 0));
    if (e.name === "getBytes" || e.name === "toCharArray") {
      return seq([obj, ...args], (s, buf, len, off = 0) => { writeCStr(buf, s.slice(off), len); });
    }
    if (!spec.mut) return seq([obj, ...args], (s, ...vals) => spec.impl(s, ...cv(vals)));
    // Changes the String: store the new value back.
    if (!e.obj.lv) return seq([obj, ...args], (s, ...vals) => spec.impl(s, ...cv(vals))[1] ?? 0);
    const l = loc(e.obj);
    return seqF([l, ...args], (f, c, ...vals) => {
      void f;
      const k = K.k;
      const [ns, r] = spec.impl(c[k], ...cv(vals));
      c[k] = ns;
      return r ?? 0;
    });
  }

  function structMethodCall(e) {
    const fn = e.callee;
    const h = compileFn(fn);
    const self = e.obj.type.k === "ptr" ? seq([expr(e.obj)], (p) => { if (p === null) throw nullPtr(); return p.a[p.i]; }) : (e.obj.lv ? lvalueGet(e.obj) : expr(e.obj));
    const args = argValues(fn, e.args);
    const kids = [self, ...args];
    if (!h.g && kids.every((k) => !k.g)) {
      const fs = kids.map((k) => k.f);
      return S((f) => {
        const fr = new Array(h.slots);
        fr[0] = fs[0](f);
        for (let i = 1; i < fs.length; i++) fr[i] = fs[i](f);
        return h.enter(fr);
      });
    }
    return G_(function* (f) {
      const fr = new Array(h.slots);
      for (let i = 0; i < kids.length; i++) fr[i] = kids[i].g ? yield* kids[i].f(f) : kids[i].f(f);
      return h.g ? yield* h.enter(fr) : h.enter(fr);
    });
  }

  function stringCtor(e) {
    const [v, x] = e.args;
    if (!v) return konst("");
    const a = expr(v);
    const t = v.type;
    if (t.k === "String") return a;
    if (t.k === "ptr" || t.k === "arr") return seq([a], (p) => cstr(p));
    if (t.k === "float") {
      const d = x ? expr(x) : konst(2);
      return seq([a, d], (val, dec) => dtostrf(val, dec + 2, dec).trim());
    }
    if (t.k === "int" && t.char && !x) return seq([a], (c) => String.fromCharCode(c & 255));
    const base = x ? expr(x) : konst(10);
    const bits = t.k === "int" ? t.bits : R.T.intBits;
    return seq([a, base], (val, b) => itoa(val, b, bits));
  }

  // ------------------------------------------------------------ initialisers

  /** An initialiser node → closure making a fresh value of type t. */
  function initializer(node, t) {
    if (!node) {
      const mk = maker(t);
      return S(mk);
    }
    switch (node.k) {
      case "initstr": {
        const s = String.fromCharCode(...node.bytes.map((b) => b & 255));
        const n = t.n ?? node.count;
        return S(() => charArray(s, n));
      }
      case "initlist": {
        const mk = maker(t);
        const items = node.items.map((it) => initializer(it, t.of));
        return seqF(items, (f, ...vals) => {
          const a = mk(f);
          for (let i = 0; i < vals.length; i++) a[i] = vals[i];
          return a;
        });
      }
      case "initstruct": {
        const mk = maker(t);
        const names = [...node.items.keys()];
        const items = [...node.items.values()].map((it, i) => initializer(it, t.fmap.get(names[i]).type));
        return seqF(items, (f, ...vals) => {
          const o = mk(f);
          for (let i = 0; i < vals.length; i++) o[names[i]] = vals[i];
          return o;
        });
      }
      case "newobj": {
        const Impl = node.cls.impl;
        const args = argValues(node.fn ?? { params: [] }, node.args);
        return seq(args, (...vals) => new Impl(R, ...vals));
      }
      case "classcopy": return expr(node.e);
      case "newstruct": {
        const mk = maker(t);
        const h = compileFn(node.fn);
        const args = argValues(node.fn, node.args);
        if (!h.g && args.every((a) => !a.g)) {
          const afs = args.map((a) => a.f);
          return S((f) => {
            const o = mk(f);
            const fr = new Array(h.slots);
            fr[0] = o;
            for (let i = 0; i < afs.length; i++) fr[i + 1] = afs[i](f);
            h.enter(fr);
            return o;
          });
        }
        return G_(function* (f) {
          const o = mk(f);
          const fr = new Array(h.slots);
          fr[0] = o;
          for (let i = 0; i < args.length; i++) fr[i + 1] = args[i].g ? yield* args[i].f(f) : args[i].f(f);
          if (h.g) yield* h.enter(fr); else h.enter(fr);
          return o;
        });
      }
    }
    const x = expr(node);
    if (t.k === "struct" && node.lv) { const cl = cloner(t); return seq([x], cl); }
    if (t.k === "arr" && node.type?.k === "arr") { const cl = cloner(t); return seq([x], cl); }
    return x;
  }

  // ------------------------------------------------------------ statements

  function prologue(s) {
    return s.pos?.line ?? 0;
  }

  function block(list) {
    const xs = list.map(stmt).filter(Boolean);
    if (xs.every((x) => !x.g)) {
      const fs = xs.map((x) => x.f);
      const n = fs.length;
      if (n === 0) return S(() => undefined);
      if (n === 1) return S(fs[0]);
      if (n === 2) { const [a, b] = fs; return S((f) => a(f) || b(f)); }
      return S((f) => {
        for (let i = 0; i < n; i++) { const r = fs[i](f); if (r) return r; }
        return undefined;
      });
    }
    return G_(function* (f) {
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const r = x.g ? yield* x.f(f) : x.f(f);
        if (r) return r;
      }
      return undefined;
    });
  }

  function stmt(s) {
    const L = prologue(s);
    switch (s.k) {
      case "block": return block(s.body);
      case "empty": case "case": case "default": case "struct": case "enum": case "typedef": case "func":
        return null;
      case "expr": {
        const e = expr(s.e);
        if (!e.g) { const ef = e.f; return S((f) => { R.us += C; R.ln = L; ef(f); }); }
        return G_(function* (f) { R.us += C; R.ln = L; yield* e.f(f); });
      }
      case "var": return varDecl(s, L);
      case "if": {
        const c = expr(s.c), a = s.then ? stmt(s.then) : null, b = s.els ? stmt(s.els) : null;
        const A = a ?? S(() => undefined), B = b ?? S(() => undefined);
        if (!c.g && !A.g && !B.g) {
          const cf = c.f, af = A.f, bf = B.f;
          return S((f) => { R.us += C; R.ln = L; return cf(f) ? af(f) : bf(f); });
        }
        return G_(function* (f) {
          R.us += C; R.ln = L;
          const v = c.g ? yield* c.f(f) : c.f(f);
          const x = v ? A : B;
          return x.g ? yield* x.f(f) : x.f(f);
        });
      }
      case "while": {
        const c = expr(s.c), body = stmt(s.body) ?? S(() => undefined);
        return G_(function* (f) {
          for (;;) {
            R.us += C; R.ln = L;
            if (--R.fuel < 0) { R.loopLine = L; yield 0; }
            const v = c.g ? yield* c.f(f) : c.f(f);
            if (!v) return undefined;
            const r = body.g ? yield* body.f(f) : body.f(f);
            if (r === BRK) return undefined;
            if (r === RET) return r;
          }
        });
      }
      case "do": {
        const c = expr(s.c), body = stmt(s.body) ?? S(() => undefined);
        return G_(function* (f) {
          for (;;) {
            R.us += C; R.ln = L;
            if (--R.fuel < 0) { R.loopLine = L; yield 0; }
            const r = body.g ? yield* body.f(f) : body.f(f);
            if (r === BRK) return undefined;
            if (r === RET) return r;
            const v = c.g ? yield* c.f(f) : c.f(f);
            if (!v) return undefined;
          }
        });
      }
      case "for": {
        const init = s.init ? stmt(s.init) : null;
        const c = s.c ? expr(s.c) : null;
        const step = s.step ? expr(s.step) : null;
        const body = stmt(s.body) ?? S(() => undefined);
        if ((!init || !init.g) && (!c || !c.g) && (!step || !step.g) && !body.g) {
          const inf = init?.f, cf = c?.f, sf = step?.f, bf = body.f;
          return G_(function* (f) {
            if (inf) inf(f);
            for (;;) {
              R.us += C; R.ln = L;
              if (--R.fuel < 0) { R.loopLine = L; yield 0; }
              if (cf && !cf(f)) return undefined;
              const r = bf(f);
              if (r === BRK) return undefined;
              if (r === RET) return r;
              if (sf) sf(f);
            }
          });
        }
        return G_(function* (f) {
          if (init) init.g ? yield* init.f(f) : init.f(f);
          for (;;) {
            R.us += C; R.ln = L;
            if (--R.fuel < 0) { R.loopLine = L; yield 0; }
            if (c && !(c.g ? yield* c.f(f) : c.f(f))) return undefined;
            const r = body.g ? yield* body.f(f) : body.f(f);
            if (r === BRK) return undefined;
            if (r === RET) return r;
            if (step) step.g ? yield* step.f(f) : step.f(f);
          }
        });
      }
      case "forrange": {
        const range = s.rangeE.lv ? lvalueGet(s.rangeE) : expr(s.rangeE);
        const body = stmt(s.body) ?? S(() => undefined);
        const slot = s.sym.slot, ref = s.sym.ref;
        const cv = ref ? null : caster(s.elemType, s.sym.type);
        const cl = !ref && s.sym.type.k === "struct" ? cloner(s.sym.type) : null;
        return G_(function* (f) {
          const a = range.g ? yield* range.f(f) : range.f(f);
          for (let i = 0; i < a.length; i++) {
            R.us += C; R.ln = L;
            if (--R.fuel < 0) { R.loopLine = L; yield 0; }
            f[slot] = ref ? new Ptr(a, i) : cl ? cl(a[i]) : cv ? cv(a[i]) : a[i];
            const r = body.g ? yield* body.f(f) : body.f(f);
            if (r === BRK) return undefined;
            if (r === RET) return r;
          }
          return undefined;
        });
      }
      case "switch": {
        const e = expr(s.e);
        const list = s.body.body;
        const xs = [];
        const map = new Map();
        let def;
        for (const st of list) {
          if (st.k === "case") map.set(st.value, xs.length);
          else if (st.k === "default") def = xs.length;
          const x = stmt(st);
          if (x) xs.push(x);
        }
        const n = xs.length;
        if (!e.g && xs.every((x) => !x.g)) {
          const ef = e.f, fs = xs.map((x) => x.f);
          return S((f) => {
            R.us += C; R.ln = L;
            let i = map.get(ef(f));
            if (i === undefined) i = def;
            if (i === undefined) return undefined;
            for (; i < n; i++) {
              const r = fs[i](f);
              if (r === BRK) return undefined;
              if (r) return r;
            }
            return undefined;
          });
        }
        return G_(function* (f) {
          R.us += C; R.ln = L;
          let i = map.get(e.g ? yield* e.f(f) : e.f(f));
          if (i === undefined) i = def;
          if (i === undefined) return undefined;
          for (; i < n; i++) {
            const x = xs[i];
            const r = x.g ? yield* x.f(f) : x.f(f);
            if (r === BRK) return undefined;
            if (r) return r;
          }
          return undefined;
        });
      }
      case "break": return S(() => BRK);
      case "continue": return S(() => CNT);
      case "return": {
        if (!s.e) return S(() => { R.us += C; R.ln = L; return RET; });
        const isInit = ["initlist", "initstruct", "newstruct", "initstr"].includes(s.e.k);
        let e = isInit ? initializer(s.e, s.e.type) : expr(s.e);
        if (s.e.type?.k === "struct" && s.e.lv) { const cl = cloner(s.e.type); e = seq([e], cl); }
        if (!e.g) { const ef = e.f; return S((f) => { R.us += C; R.ln = L; R.rv = ef(f); return RET; }); }
        return G_(function* (f) { R.us += C; R.ln = L; R.rv = yield* e.f(f); return RET; });
      }
    }
    throw new Error("codegen: unknown statement " + s.k);
  }

  function varDecl(s, L) {
    const parts = [];
    for (const d of s.decls) {
      const sym = d.sym;
      if (!sym || sym.storage === "native") continue;
      if (sym.storage === "global") continue; // done by init
      if (sym.storage === "static") {
        const init = initializer(d.initChecked, sym.type);
        const slot = sym.slot, guard = sym.guard;
        parts.push(seqF([], (f) => {
          if (G[guard]) return;
          G[guard] = 1;
          G[slot] = init.g ? runSync(init.f(f)) : init.f(f);
        }));
        continue;
      }
      const slot = sym.slot;
      if (sym.ref) {
        const p = addressOf(d.initChecked);
        parts.push(seqF([p], (f, v) => { f[slot] = v; }));
        continue;
      }
      const init = initializer(d.initChecked, sym.type);
      if (!init.g) { const fi = init.f; parts.push(S((f) => { f[slot] = fi(f); })); }
      else parts.push(G_(function* (f) { f[slot] = yield* init.f(f); }));
    }
    if (parts.every((p) => !p.g)) {
      const fs = parts.map((p) => p.f);
      return S((f) => { R.us += C; R.ln = L; for (const x of fs) x(f); });
    }
    return G_(function* (f) {
      R.us += C; R.ln = L;
      for (const p of parts) p.g ? yield* p.f(f) : p.f(f);
    });
  }

  /** Runs a generator to the end without pausing (static initialisers). */
  function runSync(gen) {
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  // ------------------------------------------------------------ functions

  /** Compiles a user function once; returns a holder { g, slots, enter }. */
  function compileFn(fn) {
    let h = compiled.get(fn);
    if (h) return h;
    const info = fn.info;
    h = { g: !!info.yields, slots: info.slots, enter: null, name: fn.name };
    compiled.set(fn, h);
    const body = block(fn.body.body);
    const zero = fn.ret ? zeroOf(fn.ret) : 0;
    const rc = retConv(fn) || ((v) => v);
    const line = fn.pos?.line ?? 0;
    const inits = fn.ctor && fn.initsChecked?.length ? fn.initsChecked.map((x) => ({ name: x.field.name, v: x.e ? expr(x.e) : null })) : null;
    if (!h.g) {
      // The checker said this can't wait; if a piece still came out as a
      // generator, run it straight through.
      const bf = body.g ? (fr) => runSync(body.f(fr)) : body.f;
      h.enter = (fr) => {
        R.us += C;
        if (inits) for (const it of inits) if (it.v) fr[0][it.name] = it.v.f(fr);
        R.rv = zero;
        bf(fr);
        const v = R.rv;
        R.rv = zero;
        return rc(v);
      };
    } else {
      const recursive = !!info.recursive;
      h.enter = function* (fr) {
        R.us += C;
        if (--R.fuel < 0) { R.loopLine = line; yield 0; }
        if (recursive && ++R.depth > R.maxDepth) {
          R.depth = 0;
          throw new SimError(`The function '${fn.name}' calls itself too many times, so the board ran out of memory (a "stack overflow"). Check that it has a way to stop.`);
        }
        try {
          if (inits) for (const it of inits) if (it.v) fr[0][it.name] = it.v.g ? yield* it.v.f(fr) : it.v.f(fr);
          R.rv = zero;
          if (body.g) yield* body.f(fr); else body.f(fr);
          const v = R.rv;
          R.rv = zero;
          return rc(v);
        } finally {
          if (recursive) R.depth--;
        }
      };
    }
    return h;
  }

  /** A function as a value (a callback or a lambda): call(...args) is a generator. */
  function fnValue(h, up) {
    return {
      name: h.name,
      *call(...args) {
        const fr = new Array(h.slots);
        if (up) fr.up = up;
        for (let i = 0; i < args.length; i++) fr[i] = args[i];
        return h.g ? yield* h.enter(fr) : h.enter(fr);
      },
    };
  }

  // ------------------------------------------------------------ the program

  // Globals: zero values first, then initialisers in order.
  for (const sym of program.globals) {
    if (sym.storage === "native") {
      const mk = natives.objects[sym.native];
      G[sym.slot] = mk ? mk(R) : null;
      continue;
    }
    if (sym.type.k === "class") continue;
    G[sym.slot] = maker(sym.type)(null);
  }
  const initParts = [];
  for (const { sym, init } of program.inits) {
    if (sym.ref) { initParts.push(seqF([addressOf(init)], (f, p) => { G[sym.slot] = p; })); continue; }
    if (!init && sym.type.k !== "class") continue;
    const x = initializer(init, sym.type);
    const slot = sym.slot;
    initParts.push(seqF([x], (f, v) => { G[slot] = v; }));
  }
  const init = G_(function* () {
    for (const p of initParts) p.g ? yield* p.f(null) : p.f(null);
  });

  const top = (fn) => {
    if (!fn) return null;
    const h = compileFn(fn);
    return {
      g: h.g,
      call: () => h.enter(new Array(h.slots)),
    };
  };

  return {
    G,
    init,
    setup: top(program.setup),
    loop: top(program.loop),
    serialEvent: top(program.serialEvent),
    BRK, CNT, RET,
  };
}

export { typeName };
