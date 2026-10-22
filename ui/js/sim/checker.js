// The checker: names, types and gcc-style errors. It annotates the AST for
// codegen.js: every expression gets `type`, `lv` (an lvalue?) and `cv` (its
// value when it is a constant); names get `sym`; calls get the function
// they call; implicit conversions become { k: "cast", implicit: true }.

import { CompileError } from "./preprocess.js";
import { Unsupported } from "./parser.js";
import { suggest } from "./suggest.js";
import {
  ptr, arr, constOf, unconst, isInt, isArith, isScalar, same, typeName, className,
  sizeOf, promote, common, wrapper, intRange, convertRank, zeroOf,
} from "./types.js";
import { STRING_METHODS } from "./strings.js";

const LOOPS = new Set(["while", "do", "for", "forrange"]);

class Scope {
  constructor(parent, kind, fn = parent?.fn) {
    this.parent = parent;
    this.kind = kind;
    this.fn = fn;
    this.names = new Map();
  }
  lookup(name) {
    for (let s = this; s; s = s.parent) {
      const v = s.names.get(name);
      if (v) return v;
    }
    return null;
  }
  *all() {
    for (let s = this; s; s = s.parent) yield* s.names.keys();
  }
}

/** Everything one function needs at run time. */
class FnInfo {
  constructor(name, parent = null) {
    this.name = name;
    this.slots = 0;
    this.parent = parent; // the enclosing function, for lambdas
    this.calls = new Set();
    this.direct = false; // contains a loop or calls something that can wait
    this.yields = false;
    this.lambda = !!parent;
  }
}

const isCharType = (t) => t.k === "int" && t.bits === 8 && t.char;
const isCharish = (t) => t.k === "int" && t.bits === 8;
const isCStr = (t) => (t.k === "ptr" && isCharish(t.to)) || (t.k === "arr" && isCharish(t.of));
const isGenFn = (f) => typeof f === "function" && f.constructor && f.constructor.name === "GeneratorFunction";

/**
 * Checks a parsed unit.
 * @returns {{ errors: CompileError[], program?: object }}
 */
export function check(unit, { T, board, natives, macroNames = [] }) {
  const c = new Checker(T, board, natives);
  c.macroNames = macroNames;
  return c.run(unit);
}

class Checker {
  constructor(T, board, natives) {
    this.T = T;
    this.board = board;
    this.natives = natives;
    this.errors = [];
    this.typeTable = new Map();
    this.global = new Scope(null, "global", null);
    this.globals = []; // symbols with a global slot
    this.gslots = 0;
    this.fns = []; // FnInfo for every user function and lambda
    this.strings = []; // string literals
    this.classes = new Map();
    this.loopDepth = 0;
    this.switchStack = [];
    this.fn = null; // the Fn being checked
    this.info = null; // its FnInfo
    this.inits = []; // global initialisers in order
    const t = this.typeTable;
    for (const [k, v] of Object.entries({ String: T.String, callback: T.callback })) t.set(k, v);
  }

  run(unit) {
    try {
      // Pass 1: types and function signatures (Arduino adds prototypes for us).
      for (const item of unit.items) this.declarePass(item);
      // Pass 2: globals and function bodies, in order.
      for (const item of unit.items) this.definePass(item);
      if (this.errors.length) return { errors: this.errors };
      this.linkCheck();
      if (this.errors.length) return { errors: this.errors };
      this.yieldAnalysis();
    } catch (e) {
      if (e instanceof CompileError || e instanceof Unsupported) {
        if (e instanceof Unsupported) return { errors: this.errors, unsupported: e };
        this.errors.push(e);
        return { errors: this.errors };
      }
      throw e;
    }
    if (this.errors.length) return { errors: this.errors };
    const sym = (n) => this.global.names.get(n);
    return {
      errors: [],
      program: {
        T: this.T,
        board: this.board,
        globals: this.globals,
        gslots: this.gslots,
        inits: this.inits,
        fns: this.fns,
        strings: this.strings,
        setup: sym("setup").overloads.find((o) => o.params.length === 0),
        loop: sym("loop").overloads.find((o) => o.params.length === 0),
        serialEvent: sym("serialEvent")?.overloads?.find((o) => o.body) ?? null,
      },
    };
  }

  error(pos, msg) {
    const e = new CompileError(pos?.line ?? 0, pos?.col ?? 0, msg);
    this.errors.push(e);
    if (this.errors.length >= 8) throw e;
    return e;
  }
  fail(pos, msg) { throw new CompileError(pos?.line ?? 0, pos?.col ?? 0, msg); }
  unsupported(what, pos) {
    const u = new Unsupported(what, pos);
    throw u;
  }

  // ---------------------------------------------------------------- types

  resolveType(tn, opts = {}) {
    switch (tn.k) {
      case "tbase": {
        const t = this.resolveBase(tn);
        return tn.cnst ? constOf(t) : t;
      }
      case "tptr": {
        const to = this.resolveType(tn.to, opts);
        if (to.k === "ptr" && !tn.pos?.sys && !opts.sys) this.unsupported("pointers to pointers", opts.pos);
        if (to.k === "ref") this.unsupported("pointers to references", opts.pos);
        return ptr(to, tn.cnst);
      }
      case "tarr": {
        const of = this.resolveType(tn.of, opts);
        if (of.k === "void") this.fail(opts.pos, `declaration of '${opts.name}' as array of void`);
        let n = null, vla = null;
        if (tn.size) {
          const e = this.expr(tn.size);
          if (!isInt(e.type)) this.fail(tn.size.pos, `size of array '${opts.name ?? ""}' has non-integral type '${typeName(e.type)}'`);
          if (e.cv === undefined) {
            if (opts.global) this.fail(tn.size.pos, "array bound is not an integer constant before ']' token");
            vla = e;
          } else {
            n = e.cv;
            if (n < 0) this.fail(tn.size.pos, `size of array '${opts.name ?? ""}' is negative`);
            if (n > 1e6) this.fail(tn.size.pos, `size of array '${opts.name ?? ""}' is too large`);
          }
        }
        const t = arr(of, n);
        if (vla) t.vla = vla;
        return t;
      }
      case "tref": return { k: "ref", to: this.resolveType(tn.to, opts) };
      case "tfn": this.unsupported("function types", opts.pos);
    }
    throw new Error("unknown type node " + tn.k);
  }

  resolveBase(tn) {
    const T = this.T;
    if (tn.name) {
      const t = this.typeTable.get(tn.name);
      if (!t) this.fail(tn.pos, `'${tn.name}' does not name a type`);
      return t;
    }
    const w = tn.words;
    const count = (x) => w.filter((v) => v === x).length;
    const has = (x) => w.includes(x);
    if (has("auto")) return { k: "auto" };
    if (has("void")) return T.void;
    if (has("bool")) return T.bool;
    if (has("float")) return T.float;
    if (has("double")) return T.double;
    const uns = has("unsigned");
    if (has("char")) return uns ? T.uchar : has("signed") ? T.schar : T.char;
    if (has("wchar_t") || has("char16_t") || has("char32_t")) return uns ? T.uint : T.int;
    if (has("short")) return uns ? T.ushort : T.short;
    const longs = count("long");
    if (longs >= 2) return uns ? T.ullong : T.llong;
    if (longs === 1) return uns ? T.ulong : T.long;
    return uns ? T.uint : T.int;
  }

  // ---------------------------------------------------------------- pass 1

  declarePass(item) {
    switch (item.k) {
      case "struct": return this.declareStruct(item);
      case "enum": return this.declareEnum(item, this.global);
      case "typedef": {
        const t = this.resolveType(item.type, { pos: item.pos, sys: item.pos.sys });
        if (t.k === "struct" && t.anon) { t.name = item.name; t.anon = false; this.typeTable.set(item.name, t); return; }
        if (t.k === "enum" && t.anon) { t.name = item.name; this.typeTable.set(item.name, t); return; }
        this.typeTable.set(item.name, isArith(t) ? { ...t, alias: item.name } : t);
        return;
      }
      case "func": return this.declareFunc(item, this.global);
      case "var": {
        // Enum / struct definitions inside declarations were pushed separately.
        return;
      }
    }
  }

  declareEnum(item, scope, cls = null) {
    const T = this.T;
    const base = item.base ? this.resolveType(item.base, { pos: item.pos }) : null;
    const et = { k: "enum", name: item.name, scoped: item.scoped, values: new Map(), base, anon: item.anon };
    const ut = base && isInt(base) ? base : T.int;
    et.bits = ut.bits;
    if (!item.anon || item.name) this.typeTable.set(item.name, et);
    let next = 0;
    for (const it of item.items) {
      if (it.value) {
        const e = this.expr(it.value, scope);
        if (e.cv === undefined) this.fail(it.pos, `enumerator value for '${it.name}' is not an integer constant`);
        next = e.cv;
      }
      et.values.set(it.name, next);
      const sym = { kind: "const", name: it.name, type: et, cv: next, pos: it.pos };
      if (cls) cls.consts.set(it.name, sym);
      else if (!item.scoped) {
        if (scope.names.has(it.name) && !it.pos.sys) this.error(it.pos, `redeclaration of '${it.name}'`);
        scope.names.set(it.name, sym);
      }
      next = next + 1;
    }
    return et;
  }

  declareStruct(item) {
    const T = this.T;
    if (item.sys && item.isClass) return this.declareNativeClass(item);
    const existing = this.typeTable.get(item.name);
    if (existing && existing.k === "struct" && existing.fields.length) this.fail(item.pos, `redefinition of 'struct ${item.name}'`);
    const st = existing && existing.k === "struct" ? existing : { k: "struct", name: item.name, fields: [], fmap: new Map(), anon: item.anon };
    this.typeTable.set(item.name, st);
    for (const en of item.enums || []) if (en.k === "enum") this.declareEnum(en, this.global);
    for (const f of item.fields) {
      if (f.isStatic) this.unsupported("static members in a struct", f.pos);
      let ft = this.resolveType(f.type, { pos: f.pos, name: f.name, global: true });
      if (ft.k === "ref") this.unsupported("reference members", f.pos);
      if (ft.k === "arr" && ft.n == null) this.fail(f.pos, `flexible array member '${st.name}::${f.name}' not at end of 'struct ${st.name}'`);
      if (ft.k === "struct" && ft === st) this.fail(f.pos, `field '${f.name}' has incomplete type 'struct ${st.name}'`);
      const field = { name: f.name, type: ft, init: null, pos: f.pos, initNode: f.init };
      if (st.fmap.has(f.name)) this.fail(f.pos, `redeclaration of '${typeName(ft)} ${st.name}::${f.name}'`);
      st.fields.push(field);
      st.fmap.set(f.name, field);
    }
    for (const f of st.fields) {
      if (f.initNode) f.init = this.initializer(f.initNode, f.type, this.global, f.pos);
    }
    if (item.methods.some((m) => m.body || !m.sys) || item.ctors.length) {
      this.declareStructMethods(st, item);
    }
    void T;
    return st;
  }

  declareStructMethods(st, item) {
    st.methods = new Map();
    st.ctors = [];
    for (const m of item.methods) {
      if (!m.body) continue;
      const fn = this.makeFn(m, this.global, st);
      fn.method = st;
      if (!st.methods.has(m.name)) st.methods.set(m.name, []);
      st.methods.get(m.name).push(fn);
    }
    for (const ct of item.ctors) {
      if (!ct.body) continue;
      const fn = this.makeFn({ ...ct, ret: { k: "tbase", words: ["void"], pos: ct.pos } }, this.global, st);
      fn.method = st;
      fn.ctor = true;
      fn.inits = ct.inits;
      st.ctors.push(fn);
    }
    st.pendingMethods = item;
  }

  declareNativeClass(item) {
    const T = this.T;
    const impl = this.natives.classes[item.name] || null;
    const cls = {
      name: item.name, methods: new Map(), ctors: [], fields: new Map(), consts: new Map(),
      bases: item.bases || [], impl, printable: false, stream: false, statics: new Map(),
    };
    const t = { k: "class", name: item.name, cls };
    this.typeTable.set(item.name, t);
    this.classes.set(item.name, cls);
    for (const b of cls.bases) {
      const base = this.classes.get(b);
      if (b === "Print" || base?.printable) cls.printable = true;
      if (b === "Stream" || base?.stream) cls.stream = true;
      if (base) {
        for (const [k, v] of base.methods) cls.methods.set(k, [...v]);
        for (const [k, v] of base.consts) cls.consts.set(k, v);
        for (const [k, v] of base.fields) cls.fields.set(k, v);
      }
    }
    if (item.name === "Print") cls.printable = true;
    if (item.name === "Stream") cls.printable = cls.stream = true;
    for (const en of item.enums) {
      if (en.k === "enum") this.declareEnum(en, this.global, cls);
      else if (en.k === "typedef") this.typeTable.set(en.name, this.resolveType(en.type, { pos: en.pos, sys: true }));
    }
    for (const f of item.fields) {
      const ft = this.resolveType(f.type, { pos: f.pos, sys: true });
      if (f.isStatic && f.cnst && f.init) {
        const e = this.expr(f.init, this.global);
        cls.consts.set(f.name, { kind: "const", name: f.name, type: ft, cv: e.cv, pos: f.pos });
      } else cls.fields.set(f.name, { name: f.name, type: ft });
    }
    for (const m of item.methods) {
      const fn = this.makeFn(m, this.global, null, cls);
      fn.cls = cls;
      fn.isStatic = m.isStatic;
      const impl = cls.impl && (m.isStatic ? cls.impl[m.name] : cls.impl.prototype[m.name]);
      fn.native = impl || null;
      fn.gen = isGenFn(impl);
      const map = m.isStatic ? cls.statics : cls.methods;
      if (!map.has(m.name) || !map.get(m.name).ownedBy || map.get(m.name).ownedBy !== cls) {
        const list = [];
        list.ownedBy = cls;
        map.set(m.name, list);
      }
      map.get(m.name).push(fn);
      if (m.isStatic) {
        if (!cls.methods.has(m.name)) cls.methods.set(m.name, map.get(m.name));
      }
    }
    for (const ct of item.ctors) {
      cls.ctors.push(this.makeFn({ ...ct, ret: { k: "tbase", words: ["void"], pos: ct.pos } }, this.global, null, cls));
    }
    void T;
  }

  /** Builds a Fn (a function or method signature) from a parsed func node. */
  makeFn(item, scope, struct = null, cls = null) {
    const sys = !!item.sys || !!item.pos?.sys;
    let ret = this.resolveType(item.ret, { pos: item.pos, sys });
    if (ret.k === "ref") ret = ret.to;
    if (ret.k === "arr") this.fail(item.pos, `'${item.name}' declared as function returning an array`);
    const params = item.params.map((p) => {
      let t = this.resolveType(p.type, { pos: p.pos, name: p.name, sys });
      let ref = false;
      if (t.k === "ref") { ref = true; t = t.to; }
      if (t.k === "arr") t = ptr(t.of); // int a[] is int* a
      if (t.k === "void") this.fail(p.pos, "invalid use of type 'void' in parameter declaration");
      return { name: p.name, type: t, ref, def: p.def, pos: p.pos };
    });
    const fn = {
      name: item.name, ret, params, body: item.body, pos: item.pos, sys, variadic: !!item.variadic,
      struct, cls, native: null, info: null, isStatic: !!item.isStatic,
    };
    for (const p of params) {
      if (p.def) p.defExpr = p.def;
    }
    fn.sig = this.signature(fn);
    return fn;
  }

  signature(fn) {
    const owner = fn.cls ? fn.cls.name + "::" : fn.struct ? fn.struct.name + "::" : "";
    const ps = fn.params.map((p) => typeName(p.type) + (p.ref ? "&" : "")).join(", ");
    return `${fn.ctor ? "" : typeName(fn.ret) + " "}${owner}${fn.name}(${ps}${fn.variadic ? (ps ? ", ..." : "...") : ""})`;
  }

  declareFunc(item, scope) {
    const fn = this.makeFn(item, scope);
    if (item.name === "main" && !item.sys) this.unsupported("a main() function (Arduino sketches use setup() and loop())", item.pos);
    let sym = scope.names.get(item.name);
    if (sym && sym.kind !== "func") {
      if (!item.sys) this.fail(item.pos, `'${typeName(fn.ret)} ${item.name}(${fn.params.map((p) => typeName(p.type)).join(", ")})' redeclared as different kind of symbol`);
      return;
    }
    if (!sym) {
      sym = { kind: "func", name: item.name, overloads: [] };
      scope.names.set(item.name, sym);
    }
    if (item.sys) {
      fn.native = this.natives.functions[item.name] || null;
      fn.gen = isGenFn(fn.native);
    }
    const twin = sym.overloads.find((o) => o.params.length === fn.params.length && o.params.every((p, i) => same(p.type, fn.params[i].type) && p.ref === fn.params[i].ref));
    if (twin) {
      if (twin.body && fn.body) this.fail(item.pos, `redefinition of '${fn.sig}'`);
      if (!same(twin.ret, fn.ret)) this.fail(item.pos, `ambiguating new declaration of '${fn.sig}'`);
      if (fn.body) { twin.body = fn.body; twin.pos = fn.pos; twin.params = fn.params; }
      item.fn = twin;
      return;
    }
    sym.overloads.push(fn);
    item.fn = fn;
  }

  // ---------------------------------------------------------------- pass 2

  definePass(item) {
    switch (item.k) {
      case "var": return this.declareVars(item, this.global, true);
      case "func":
        if (item.body) this.checkFunction(item.fn, item.pos);
        return;
      case "struct":
        if (item.isClass && item.sys) return;
        return this.checkStructMethods(this.typeTable.get(item.name));
    }
  }

  checkStructMethods(st) {
    if (!st?.pendingMethods) return;
    delete st.pendingMethods;
    for (const list of st.methods.values()) for (const fn of list) this.checkFunction(fn, fn.pos);
    for (const fn of st.ctors) this.checkFunction(fn, fn.pos);
  }

  checkFunction(fn, pos) {
    const info = new FnInfo(fn.name);
    fn.info = info;
    info.fn = fn;
    this.fns.push(info);
    const scope = new Scope(this.global, "func", info);
    if (fn.struct) {
      scope.self = fn.struct;
      info.self = true;
      info.slots = 1; // slot 0 is `this`
    }
    for (const p of fn.params) {
      if (!p.name) { info.slots++; continue; }
      if (scope.names.has(p.name)) this.error(p.pos, `redefinition of '${typeName(p.type)} ${p.name}'`);
      p.sym = { kind: "var", name: p.name, type: p.type, ref: p.ref, storage: "local", slot: info.slots++, info, pos: p.pos, param: true, cnst: !!p.type.cnst };
      scope.names.set(p.name, p.sym);
    }
    const saveFn = this.fn, saveInfo = this.info;
    this.fn = fn;
    this.info = info;
    const body = new Scope(scope, "block", info);
    body.fnTop = true;
    if (fn.ctor) {
      fn.initsChecked = (fn.inits || []).map((ini) => {
        const f = fn.struct.fmap.get(ini.name);
        if (!f) this.fail(ini.pos, `class '${fn.struct.name}' does not have any field named '${ini.name}'`);
        const e = ini.args.length === 1 ? this.conv(this.expr(ini.args[0], body), f.type, { what: "init" }, ini.pos) : null;
        return { field: f, e };
      });
    }
    this.statements(fn.body.body, body);
    this.fn = saveFn;
    this.info = saveInfo;
    void pos;
  }

  /** Declares variables (globals, locals or statics) from a var node. */
  declareVars(item, scope, isGlobal) {
    const T = this.T;
    for (const d of item.decls) {
      const sys = !!item.sys;
      let t = this.resolveType(d.type, { pos: d.pos, name: d.name, global: isGlobal || item.specs.static, sys });
      let ref = false;
      if (t.k === "ref") {
        ref = true;
        t = t.to;
        if (!d.init) this.fail(d.pos, `'${d.name}' declared as reference but not initialized`);
      }
      if (t.k === "void") this.fail(d.pos, `variable or field '${d.name}' declared void`);
      const cnst = !!item.specs.const || !!item.specs.constexpr || !!t.cnst;
      let storage = isGlobal ? "global" : item.specs.static ? "static" : "local";
      if (item.specs.extern && isGlobal) storage = sys ? "native" : "global";
      if (t.k === "auto") {
        if (!d.init) this.fail(d.pos, `declaration of 'auto ${d.name}' has no initializer`);
        const e = this.rv(this.expr(d.init, scope));
        t = unconst(e.type.k === "null" ? ptr(T.void) : e.type);
        if (t.k === "fn") t = { k: "fn" };
        d.autoInit = e;
      }
      const prior = scope.names.get(d.name);
      if (prior && !sys) {
        if (prior.kind === "var" && prior.param && scope.fnTop) this.fail(d.pos, `declaration of '${typeName(t)} ${d.name}' shadows a parameter`);
        if (prior.kind === "var" && storage === "global" && !same(prior.type, t)) this.fail(d.pos, `conflicting declaration '${typeName(t)} ${d.name}'`);
        if (prior.kind === "func") this.fail(d.pos, `'${typeName(t)} ${d.name}' redeclared as different kind of symbol`);
        this.fail(d.pos, `${isGlobal ? "redefinition" : "redeclaration"} of '${typeName(t)} ${d.name}'`);
      }
      const sym = { kind: "var", name: d.name, type: t, cnst, ref, storage, pos: d.pos };
      if (storage === "native") {
        sym.native = d.name;
        sym.slot = this.gslots++;
        this.globals.push(sym);
        scope.names.set(d.name, sym);
        continue;
      }
      if (storage === "local") {
        sym.slot = this.info.slots++;
        sym.info = this.info;
      } else {
        sym.slot = this.gslots++;
        if (storage === "static") sym.guard = this.gslots++;
        this.globals.push(sym);
      }
      // Initialiser
      let init = null;
      if (ref) {
        const e = this.expr(d.init, scope);
        if (!e.lv) this.fail(d.init.pos, `cannot bind non-const lvalue reference of type '${typeName(t)}&' to an rvalue of type '${typeName(e.type)}'`);
        if (!same(e.type, t) && !(e.type.k === "arr" && t.k === "arr")) this.fail(d.init.pos, `invalid initialization of reference of type '${typeName(t)}&' from expression of type '${typeName(e.type)}'`);
        init = e;
      } else if (d.autoInit) {
        init = this.conv(d.autoInit, t, { what: "init" }, d.pos);
      } else if (t.k === "class") {
        init = this.classInit(t, d, scope);
      } else if (d.ctorArgs) {
        if (t.k === "String") init = this.stringCtor(d.ctorArgs, d.pos, scope);
        else if (t.k === "struct" && t.ctors?.length) init = this.structCtor(t, d.ctorArgs, d.pos, scope);
        else if (d.ctorArgs.length === 1) init = this.conv(this.expr(d.ctorArgs[0], scope), t, { what: "init" }, d.pos);
        else if (d.ctorArgs.length === 0) init = null;
        else this.fail(d.pos, `expression list treated as compound expression in initializer [-fpermissive]`);
      } else if (d.init) {
        init = this.initializer(d.init, t, scope, d.pos);
        if (t.k === "arr" && t.n == null) {
          t = sym.type = arr(t.of, init.count);
        }
      } else if (t.k === "struct" && t.ctors?.length) {
        init = this.structCtor(t, [], d.pos, scope);
      }
      if (t.k === "arr" && t.n == null && !t.vla && !init) this.fail(d.pos, `storage size of '${d.name}' isn't known`);
      if (cnst && !init && t.k !== "class" && !(t.k === "struct" && t.ctors?.length) && !sys) this.fail(d.pos, `uninitialized const '${d.name}' [-fpermissive]`);
      if (cnst && init && init.cv !== undefined && isArith(t)) sym.cv = wrapper(t)(init.cv);
      d.sym = sym;
      d.initChecked = init;
      scope.names.set(d.name, sym);
      if (storage === "global") this.inits.push({ sym, init, pos: d.pos });
    }
  }

  classInit(t, d, scope) {
    const cls = t.cls;
    let args = d.ctorArgs || [];
    let pos = d.pos;
    if (d.init) {
      // Keypad k = Keypad(...);  Servo s = other;
      if (d.init.k === "construct" && d.init.type.name === t.name) {
        args = d.init.args;
        pos = d.init.pos;
      } else {
        const e = this.expr(d.init, scope);
        if (e.type.k === "class" && e.type.name === t.name) return { k: "classcopy", e, type: t };
        this.fail(d.init.pos, `conversion from '${typeName(e.type)}' to non-scalar type '${t.name}' requested`);
      }
    }
    return this.construct(cls, t, args, pos, scope);
  }

  construct(cls, t, args, pos, scope) {
    const checked = args.map((a) => this.expr(a, scope));
    let fn = null;
    if (cls.ctors.length) {
      fn = this.pickOverload(cls.ctors, checked, pos, cls.name, `${cls.name}::${cls.name}`);
      checked.splice(0, checked.length, ...this.convertArgs(fn, checked, pos));
    }
    if (!cls.impl) this.unsupported(`the ${cls.name} library`, pos);
    return { k: "newobj", cls, args: checked, type: t, fn };
  }

  structCtor(st, args, pos, scope) {
    const checked = args.map((a) => this.expr(a, scope));
    const fn = this.pickOverload(st.ctors, checked, pos, st.name, `${st.name}::${st.name}`);
    const conv = this.convertArgs(fn, checked, pos);
    if (this.info) this.info.calls.add(fn);
    else this.ctorCalls = [...(this.ctorCalls || []), fn];
    return { k: "newstruct", st, fn, args: conv, type: st };
  }

  /** Checks an initialiser for type t: an expression or a { ... } list. */
  initializer(node, t, scope, pos) {
    const T = this.T;
    if (t.k === "arr") {
      if (node.k === "str" || (node.k === "paren" && node.e.k === "str")) {
        const s = node.k === "str" ? node : node.e;
        if (!isCharish(t.of)) this.fail(node.pos, `array must be initialized with a brace-enclosed initializer`);
        const n = s.bytes.length + 1;
        if (t.n != null && n - 1 > t.n) this.fail(node.pos, `initializer-string for array of chars is too long [-fpermissive]`);
        return { k: "initstr", bytes: s.bytes, count: n, type: t };
      }
      if (node.k !== "init") {
        const e = this.expr(node, scope);
        if (e.type.k === "arr") this.fail(node.pos, `array must be initialized with a brace-enclosed initializer`);
        this.fail(node.pos, `array must be initialized with a brace-enclosed initializer`);
      }
      const items = [];
      const list = node.items;
      let k = 0;
      // Brace elision: int m[2][3] = {1, 2, 3, 4, 5, 6}
      const elemIsAgg = t.of.k === "arr" || t.of.k === "struct";
      while (k < list.length) {
        const it = list[k];
        if (elemIsAgg && it.k !== "init" && !(t.of.k === "arr" && it.k === "str")) {
          const need = t.of.k === "arr" ? t.of.n ?? 1 : t.of.fields.length;
          const sub = { k: "init", items: list.slice(k, k + need), pos: it.pos };
          items.push(this.initializer(sub, t.of, scope, it.pos));
          k += need;
          continue;
        }
        items.push(this.initializer(it, t.of, scope, it.pos));
        k++;
      }
      if (t.n != null && items.length > t.n) this.fail(node.pos, `too many initializers for '${typeName(t)}'`);
      return { k: "initlist", items, count: items.length, type: t };
    }
    if (t.k === "struct") {
      if (node.k !== "init") {
        const e = this.expr(node, scope);
        return this.conv(e, t, { what: "init" }, pos);
      }
      if (t.ctors?.length) {
        return this.structCtor(t, node.items, pos, scope);
      }
      const items = new Map();
      let fi = 0;
      for (const it of node.items) {
        let field;
        if (it.designator) {
          field = t.fmap.get(it.designator);
          if (!field) this.fail(it.pos, `'${t.name}' has no non-static data member named '${it.designator}'`);
          fi = t.fields.indexOf(field) + 1;
        } else {
          field = t.fields[fi++];
          if (!field) this.fail(node.pos, `too many initializers for '${t.name}'`);
        }
        items.set(field.name, this.initializer(it, field.type, scope, it.pos));
      }
      return { k: "initstruct", items, type: t };
    }
    if (node.k === "init") {
      if (node.items.length === 0) return { k: "num", v: 0, type: t, cv: zeroOf(t) === 0 ? 0 : undefined, zero: true };
      if (node.items.length > 1) this.fail(node.pos, `scalar object requires one element in initializer`);
      const e = this.expr(node.items[0], scope);
      if (isArith(e.type) && isArith(t) && e.cv !== undefined && isInt(t) && e.type.k === "float") {
        this.fail(node.pos, `narrowing conversion of '${e.cv}' from '${typeName(e.type)}' to '${typeName(t)}' [-Wnarrowing]`);
      }
      return this.conv(e, t, { what: "init" }, pos);
    }
    if (t.k === "String") {
      const e = this.expr(node, scope);
      return this.conv(e, t, { what: "init" }, pos);
    }
    void T;
    return this.conv(this.expr(node, scope), t, { what: "init" }, pos);
  }

  // ---------------------------------------------------------------- statements

  statements(list, scope) {
    for (let i = 0; i < list.length; i++) this.statement(list[i], scope);
  }

  statement(s, scope) {
    switch (s.k) {
      case "block": {
        const inner = s.noScope ? scope : new Scope(scope, "block");
        this.statements(s.body, inner);
        return;
      }
      case "empty": return;
      case "expr": s.e = this.expr(s.e, scope); return;
      case "var": return this.declareVars(s, scope, false);
      case "struct":
        this.declareStruct(s);
        this.checkStructMethods(this.typeTable.get(s.name));
        return;
      case "enum": this.declareEnum(s, scope); return;
      case "typedef": this.declarePass(s); return;
      case "func": {
        // A local prototype: int f(int);
        this.declareFunc(s, this.global);
        return;
      }
      case "if": {
        const inner = new Scope(scope, "block");
        s.c = this.cond(s.c, inner);
        this.statement(s.then, new Scope(inner, "block"));
        if (s.els) this.statement(s.els, new Scope(inner, "block"));
        return;
      }
      case "while": {
        this.info.direct = true;
        const inner = new Scope(scope, "block");
        s.c = this.cond(s.c, inner);
        this.loop(() => this.statement(s.body, new Scope(inner, "block")));
        return;
      }
      case "do": {
        this.info.direct = true;
        this.loop(() => this.statement(s.body, new Scope(scope, "block")));
        s.c = this.cond(s.c, scope);
        return;
      }
      case "for": {
        this.info.direct = true;
        const inner = new Scope(scope, "block");
        if (s.init) this.statement(s.init, inner);
        if (s.c) s.c = this.cond(s.c, inner);
        if (s.step) s.step = this.expr(s.step, inner);
        this.loop(() => this.statement(s.body, new Scope(inner, "block")));
        return;
      }
      case "forrange": {
        this.info.direct = true;
        const inner = new Scope(scope, "block");
        const range = this.expr(s.range, inner);
        if (range.type.k !== "arr" || range.type.n == null) {
          if (range.type.k === "String") this.unsupported("range-based for over a String", s.pos);
          this.fail(s.range.pos, `'begin' was not declared in this scope`);
        }
        s.rangeE = range;
        const d = s.decl.decls[0];
        let t = this.resolveType(d.type, { pos: d.pos });
        let ref = false;
        if (t.k === "ref") { ref = true; t = t.to; }
        if (t.k === "auto") t = unconst(range.type.of);
        s.sym = { kind: "var", name: d.name, type: t, ref, storage: "local", slot: this.info.slots++, info: this.info, pos: d.pos, cnst: !!s.decl.specs.const };
        s.idxSlot = this.info.slots++;
        if (!ref && !same(unconst(t), unconst(range.type.of)) && !(isArith(t) && isArith(range.type.of))) {
          this.fail(d.pos, `cannot convert '${typeName(range.type.of)}' to '${typeName(t)}' in initialization`);
        }
        s.elemType = range.type.of;
        inner.names.set(d.name, s.sym);
        this.loop(() => this.statement(s.body, new Scope(inner, "block")));
        return;
      }
      case "switch": {
        const e = this.rv(this.expr(s.e, scope));
        if (!isInt(e.type)) this.fail(s.e.pos, `switch quantity not an integer`);
        s.e = this.conv(e, promote(e.type, this.T), { what: "init" }, s.pos);
        const sw = { cases: new Map(), hasDefault: false, node: s };
        this.switchStack.push(sw);
        const body = s.body.k === "block" ? s.body : { k: "block", body: [s.body], pos: s.body.pos };
        s.body = body;
        const inner = new Scope(scope, "block");
        let crossed = null;
        for (const st of body.body) {
          if ((st.k === "case" || st.k === "default") && crossed) {
            this.fail(st.pos, `jump to case label [-fpermissive]`);
          }
          this.statement(st, inner);
          if (st.k === "var" && st.decls.some((d) => d.initChecked || d.sym?.type.k === "String" || d.sym?.type.k === "class")) crossed = st;
        }
        this.switchStack.pop();
        s.cases = sw.cases;
        return;
      }
      case "case": {
        const sw = this.switchStack[this.switchStack.length - 1];
        const e = this.expr(s.v, scope);
        if (!sw) this.fail(s.pos, `case label '${e.cv ?? "?"}' not within a switch statement`);
        if (e.cv === undefined) this.fail(s.v.pos, `the value of '${s.v.name ?? "?"}' is not usable in a constant expression`);
        if (!isInt(e.type)) this.fail(s.v.pos, `could not convert '${e.cv}' from '${typeName(e.type)}' to 'int'`);
        if (sw.cases.has(e.cv)) this.fail(s.pos, `duplicate case value`);
        sw.cases.set(e.cv, s);
        s.value = e.cv;
        return;
      }
      case "default": {
        const sw = this.switchStack[this.switchStack.length - 1];
        if (!sw) this.fail(s.pos, `'default' label not within a switch statement`);
        if (sw.hasDefault) this.fail(s.pos, `multiple default labels in one switch`);
        sw.hasDefault = true;
        return;
      }
      case "break":
        if (!this.loopDepth && !this.switchStack.length) this.fail(s.pos, `break statement not within loop or switch`);
        return;
      case "continue":
        if (!this.loopDepth) this.fail(s.pos, `continue statement not within a loop`);
        return;
      case "return": {
        const fn = this.fn;
        const ret = fn.lambdaRet !== undefined ? fn.lambdaRet : fn.ret;
        if (s.e) {
          if (ret === null) { // lambda: return type from the first return
            const e = this.rv(this.expr(s.e, scope));
            fn.lambdaRet = unconst(e.type);
            s.e = e;
            return;
          }
          if (ret.k === "void") {
            const e = this.expr(s.e, scope);
            if (e.type.k !== "void") this.fail(s.pos, `return-statement with a value, in function returning 'void' [-fpermissive]`);
            s.e = e;
            return;
          }
          s.e = s.e.k === "init" ? this.initializer(s.e, ret, scope, s.pos) : this.conv(this.expr(s.e, scope), ret, { what: "return" }, s.pos);
        } else if (ret && ret.k !== "void") {
          this.fail(s.pos, `return-statement with no value, in function returning '${typeName(ret)}' [-fpermissive]`);
        }
        return;
      }
      case "declcond": return;
    }
    throw new Error("unknown statement " + s.k);
  }

  loop(body) {
    this.loopDepth++;
    const saveSw = this.switchStack;
    this.switchStack = [];
    try { body(); } finally {
      this.loopDepth--;
      this.switchStack = saveSw;
    }
  }

  /** A condition (if / while / for): converts to bool. */
  cond(e, scope) {
    if (e.k === "declcond") {
      this.declareVars({ k: "var", specs: e.specs, decls: e.decls, pos: e.pos }, scope, false);
      const d = e.decls[0];
      const id = { k: "id", name: d.name, pos: d.pos };
      return this.toBool(this.expr(id, scope), e.pos, { declInit: d });
    }
    return this.toBool(this.expr(e, scope), e.pos);
  }

  toBool(e, pos, extra) {
    e = this.rv(e);
    const t = e.type;
    if (t.k === "void") this.fail(pos, `could not convert '${exprText(e)}' from 'void' to 'bool'`);
    if (t.k === "String") this.fail(pos, `could not convert '${exprText(e)}' from 'String' to 'bool'`);
    if (t.k === "struct") this.fail(pos, `could not convert '${exprText(e)}' from '${t.name}' to 'bool'`);
    const out = t.k === "bool" ? e : { k: "cast", a: e, type: this.T.bool, implicit: true, pos: e.pos, cv: e.cv === undefined ? undefined : (e.cv !== 0 && e.cv !== null ? 1 : 0) };
    if (extra?.declInit) out.declInit = extra.declInit;
    return out;
  }

  // ---------------------------------------------------------------- expressions

  /** Array-to-pointer decay for values used as rvalues. */
  rv(e) {
    if (e.type.k === "arr") {
      return { k: "cast", a: e, type: ptr(e.type.of), implicit: true, decay: true, pos: e.pos };
    }
    if (e.type.k === "fn" && e.k !== "lambda") return e;
    return e;
  }

  expr(e, scope = this.global) {
    const out = this.expr1(e, scope);
    return out;
  }

  expr1(e, scope) {
    const T = this.T;
    switch (e.k) {
      case "num": {
        if (e.type) return e;
        e.type = this.literalType(e);
        e.cv = e.num?.float ? (e.type.bits === 32 ? Math.fround(e.v) : e.v) : e.v;
        e.lv = false;
        return e;
      }
      case "chr": e.type = e.multi ? T.int : T.char; e.cv = e.v; return e;
      case "bool": e.type = T.bool; e.cv = e.v; return e;
      case "nullptr": e.type = T.null; e.cv = null; return e;
      case "str": {
        e.type = arr(constOf(T.char), e.bytes.length + 1);
        e.id = this.strings.length;
        this.strings.push(e.bytes);
        e.lv = true;
        return e;
      }
      case "paren": {
        const inner = this.expr(e.e, scope);
        return inner;
      }
      case "id": return this.ident(e, scope);
      case "scope": return this.scoped(e, scope);
      case "this": {
        if (!scope.lookupSelf?.() && !this.selfStruct(scope)) this.fail(e.pos, `invalid use of 'this' in non-member function`);
        e.type = ptr(this.selfStruct(scope));
        e.self = true;
        return e;
      }
      case "un": return this.unary(e, scope);
      case "pre": case "post": return this.incdec(e, scope);
      case "bin": return this.binary(e, scope);
      case "assign": return this.assign(e, scope);
      case "cond": return this.ternary(e, scope);
      case "comma": {
        e.a = this.expr(e.a, scope);
        e.b = this.expr(e.b, scope);
        e.type = e.b.type;
        e.lv = e.b.lv;
        return e;
      }
      case "call": return this.call(e, scope);
      case "index": return this.index(e, scope);
      case "member": return this.member(e, scope);
      case "cast": return this.castExpr(e, scope);
      case "construct": return this.constructExpr(e, scope);
      case "compound": {
        const t = this.resolveType(e.type, { pos: e.pos });
        return { ...this.initializer(e.init, t, scope, e.pos), type: t };
      }
      case "sizeof": {
        let t;
        if (e.type && !e.e) t = this.resolveType(e.type, { pos: e.pos });
        else {
          const x = this.expr(e.e, scope);
          t = x.type;
        }
        if (t.k === "ref") t = t.to;
        if (t.k === "void") this.fail(e.pos, `invalid application of 'sizeof' to a void type`);
        return { k: "num", v: sizeOf(t, T), cv: sizeOf(t, T), type: T.uint, pos: e.pos, lv: false };
      }
      case "lambda": return this.lambda(e, scope);
      case "init": this.fail(e.pos, `expected primary-expression before '{' token`);
    }
    throw new Error("unknown expression " + e.k);
  }

  selfStruct(scope) {
    for (let s = scope; s; s = s.parent) if (s.self) return s.self;
    return null;
  }

  literalType(e) {
    const T = this.T;
    const n = e.num;
    if (!n) return T.int;
    if (n.float) return n.f ? T.float : T.double;
    const dec = n.base === 10;
    let list;
    if (n.long === 2) list = n.unsigned ? [T.ullong] : dec ? [T.llong] : [T.llong, T.ullong];
    else if (n.long === 1) list = n.unsigned ? [T.ulong, T.ullong] : dec ? [T.long, T.llong] : [T.long, T.ulong, T.llong, T.ullong];
    else list = n.unsigned ? [T.uint, T.ulong, T.ullong] : dec ? [T.int, T.long, T.llong] : [T.int, T.uint, T.long, T.ulong, T.llong, T.ullong];
    for (const t of list) {
      const [lo, hi] = intRange(t);
      if (e.v >= lo && e.v <= hi) return t;
    }
    return list[list.length - 1];
  }

  ident(e, scope) {
    const sym = scope.lookup(e.name);
    if (!sym) {
      // A field of the struct whose method this is.
      const st = this.selfStruct(scope);
      if (st) {
        const f = st.fmap.get(e.name);
        if (f) return this.member({ k: "member", a: { k: "this", pos: e.pos }, name: e.name, arrow: true, pos: e.pos }, scope);
        if (st.methods?.has(e.name)) {
          return { k: "selfmethod", name: e.name, st, pos: e.pos, type: { k: "method" } };
        }
      }
      const names = [...scope.all(), ...this.typeTable.keys(), ...(this.macroNames || [])];
      const s = suggest(e.name, names);
      this.fail(e.pos, `'${e.name}' was not declared in this scope${s ? `; did you mean '${s}'?` : ""}`);
    }
    e.sym = sym;
    if (sym.kind === "const") {
      e.type = sym.type;
      e.cv = sym.cv;
      e.lv = false;
      return e;
    }
    if (sym.kind === "func") {
      e.type = { k: "fn", sym };
      e.lv = false;
      return e;
    }
    e.type = sym.type;
    e.lv = true;
    if (sym.cv !== undefined && !sym.ref) e.cv = sym.cv;
    if (sym.storage === "local" && sym.info !== this.info) {
      // A lambda using a variable of the function around it.
      let depth = 0;
      for (let f = this.info; f && f !== sym.info; f = f.parent) depth++;
      e.depth = depth;
    }
    return e;
  }

  scoped(e, scope) {
    const t = this.typeTable.get(e.scope);
    if (t?.k === "enum") {
      if (!t.values.has(e.name)) this.fail(e.pos, `'${e.name}' is not a member of '${e.scope}'`);
      return { k: "num", v: t.values.get(e.name), cv: t.values.get(e.name), type: t, pos: e.pos, lv: false };
    }
    if (t?.k === "class") {
      const c = t.cls.consts.get(e.name);
      if (c) return { k: "num", v: c.cv, cv: c.cv, type: c.type, pos: e.pos, lv: false };
      if (t.cls.statics.has(e.name)) return { k: "staticref", cls: t.cls, name: e.name, type: { k: "method" }, pos: e.pos };
      this.fail(e.pos, `'${e.name}' is not a member of '${e.scope}'`);
    }
    if (t?.k === "struct") {
      if (t.methods?.has(e.name)) this.unsupported("static methods", e.pos);
      this.fail(e.pos, `'${e.name}' is not a member of '${e.scope}'`);
    }
    if (!t) {
      void scope;
      this.fail(e.pos, `'${e.scope}' has not been declared`);
    }
    this.fail(e.pos, `'${e.scope}' is not a class, namespace, or enumeration`);
  }

  unary(e, scope) {
    const T = this.T;
    if (e.op === "&") {
      const a = this.expr(e.a, scope);
      e.a = a;
      if (a.type.k === "fn") { e.type = a.type; return Object.assign(a, { pos: e.pos }); }
      if (a.k === "str") this.fail(e.pos, "lvalue required as unary '&' operand");
      if (!a.lv) this.fail(e.pos, "lvalue required as unary '&' operand");
      if (a.type.k === "class") { e.type = ptr(a.type); e.objref = true; return e; }
      if (a.type.k === "arr") { e.type = ptr(a.type.of); e.arrAddr = true; return e; }
      e.type = ptr(a.type);
      return e;
    }
    if (e.op === "*") {
      const a = this.rv(this.expr(e.a, scope));
      e.a = a;
      if (a.type.k !== "ptr") this.fail(e.pos, `invalid type argument of unary '*' (have '${typeName(a.type)}')`);
      if (a.type.to.k === "void") this.fail(e.pos, `'void*' is not a pointer-to-object type`);
      e.type = a.type.to;
      e.lv = true;
      return e;
    }
    const a = this.rv(this.expr(e.a, scope));
    e.a = a;
    const t = a.type;
    if (e.op === "!") {
      e.a = this.toBool(a, e.pos);
      e.type = T.bool;
      if (e.a.cv !== undefined) e.cv = e.a.cv ? 0 : 1;
      return e;
    }
    if (e.op === "~") {
      if (!isInt(t)) this.fail(e.pos, `wrong type argument to bit-complement`);
      e.type = promote(t, T);
      e.a = this.conv(a, e.type);
      if (e.a.cv !== undefined) e.cv = wrapper(e.type)(~e.a.cv);
      return e;
    }
    // + and -
    if (!isArith(t)) {
      if (t.k === "ptr" && e.op === "+") { e.type = t; return e; }
      this.fail(e.pos, `wrong type argument to unary ${e.op === "-" ? "minus" : "plus"}`);
    }
    e.type = promote(t, T);
    e.a = this.conv(a, e.type);
    if (e.a.cv !== undefined) e.cv = e.op === "-" ? wrapper(e.type)(-e.a.cv) : e.a.cv;
    return e;
  }

  incdec(e, scope) {
    const a = this.expr(e.a, scope);
    e.a = a;
    const word = e.op === "++" ? "increment" : "decrement";
    if (!a.lv) this.fail(e.pos, `lvalue required as ${word} operand`);
    if (a.k === "id" && a.sym?.cnst || (a.type.cnst && a.type.k !== "ptr")) this.fail(e.pos, `${word} of read-only ${a.k === "id" ? `variable '${a.name}'` : "location"}`);
    const t = a.type;
    if (t.k === "String" || t.k === "struct" || t.k === "class" || t.k === "arr") this.fail(e.pos, `no match for 'operator${e.op}' (operand type is '${typeName(t)}')`);
    if (t.k === "enum") this.fail(e.pos, `no match for 'operator${e.op}' (operand type is '${t.name}')`);
    if (t.k === "bool" && e.op === "--") this.fail(e.pos, `use of an operand of type 'bool' in 'operator--' is forbidden`);
    e.type = t;
    e.lv = e.k === "pre";
    return e;
  }

  binary(e, scope) {
    const T = this.T;
    const op = e.op;
    let a = this.rv(this.expr(e.a, scope));
    let b = this.rv(this.expr(e.b, scope));
    const ta = a.type, tb = b.type;
    const bad = () => {
      if (ta.k === "String" || tb.k === "String" || ta.k === "class" || tb.k === "class" || ta.k === "struct" || tb.k === "struct") {
        this.fail(e.pos, `no match for 'operator${op}' (operand types are '${typeName(ta)}' and '${typeName(tb)}')`);
      }
      const na = e.a.k === "str" ? typeName(e.a.type) : typeName(ta);
      const nb = e.b.k === "str" ? typeName(e.b.type) : typeName(tb);
      this.fail(e.pos, `invalid operands of types '${na}' and '${nb}' to binary 'operator${op}'`);
    };
    if (ta.k === "void" || tb.k === "void") this.fail(e.pos, "invalid use of void expression");
    if (op === "&&" || op === "||") {
      e.a = this.toBool(a, e.pos);
      e.b = this.toBool(b, e.pos);
      e.type = T.bool;
      e.kind = "logic";
      if (e.a.cv !== undefined && e.b.cv !== undefined) e.cv = op === "&&" ? (e.a.cv && e.b.cv ? 1 : 0) : (e.a.cv || e.b.cv ? 1 : 0);
      return e;
    }
    // String concatenation and comparison
    if (ta.k === "String" || tb.k === "String") {
      const textish = (t) => t.k === "String" || isCStr(t) || isArith(t);
      if (op === "+") {
        if (!textish(ta) || !textish(tb)) bad();
        e.a = a; e.b = b;
        e.kind = "strcat";
        e.type = T.String;
        return e;
      }
      if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
        const ok = (t) => t.k === "String" || isCStr(t);
        if (!ok(ta) || !ok(tb)) bad();
        e.a = a; e.b = b;
        e.kind = "strcmp";
        e.type = T.bool;
        return e;
      }
      bad();
    }
    if (ta.k === "struct" || tb.k === "struct" || ta.k === "class" || tb.k === "class") bad();
    // Pointer arithmetic and comparison
    if (ta.k === "ptr" || tb.k === "ptr" || ta.k === "null" || tb.k === "null") {
      if ((op === "+" || op === "-") && ta.k === "ptr" && isInt(tb)) {
        e.a = a; e.b = this.conv(b, T.long); e.kind = "ptradd"; e.type = ta; return e;
      }
      if (op === "+" && isInt(ta) && tb.k === "ptr") {
        e.a = b; e.b = this.conv(a, T.long); e.kind = "ptradd"; e.op = "+"; e.type = tb; return e;
      }
      if (op === "-" && ta.k === "ptr" && tb.k === "ptr") {
        e.a = a; e.b = b; e.kind = "ptrdiff"; e.type = T.int; return e;
      }
      if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
        const nullish = (x) => x.type.k === "null" || x.type.k === "ptr" || (isInt(x.type) && x.cv === 0);
        if (!nullish(a) || !nullish(b)) {
          if (op === "==" || op === "!=") this.fail(e.pos, `ISO C++ forbids comparison between pointer and integer [-fpermissive]`);
          bad();
        }
        e.a = a; e.b = b; e.kind = "ptrcmp"; e.type = T.bool; return e;
      }
      bad();
    }
    if (!isArith(ta) || !isArith(tb)) bad();
    if (op === "<<" || op === ">>") {
      if (!isInt(ta) || !isInt(tb)) bad();
      const pt = promote(ta, T);
      e.a = this.conv(a, pt);
      e.b = this.conv(b, promote(tb, T));
      e.type = pt;
      e.kind = "shift";
      e.opType = pt;
      this.fold(e);
      return e;
    }
    const ct = common(ta, tb, T);
    if ((op === "%" || op === "&" || op === "|" || op === "^") && ct.k === "float") bad();
    e.a = this.conv(a, ct);
    e.b = this.conv(b, ct);
    e.opType = ct;
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
      e.kind = "cmp";
      e.type = T.bool;
    } else {
      e.kind = "arith";
      e.type = ct;
    }
    this.fold(e);
    return e;
  }

  /** Constant folding for arithmetic on constants. */
  fold(e) {
    const x = e.a.cv, y = e.b.cv;
    if (x === undefined || y === undefined || x === null || y === null) return;
    const t = e.opType;
    const w = wrapper(e.kind === "cmp" ? t : e.type);
    let v;
    switch (e.op) {
      case "+": v = x + y; break;
      case "-": v = x - y; break;
      case "*": v = t.k === "int" && t.bits === 32 ? Math.imul(x, y) : x * y; break;
      case "/":
        if (y === 0) return; // a runtime error, like the board
        v = t.k === "float" ? x / y : Math.trunc(x / y); break;
      case "%": if (y === 0) return; v = x % y; break;
      case "<<": v = t.bits > 32 ? Number(BigInt(x) << BigInt(y)) : x << y; break;
      case ">>": v = t.bits > 32 ? Number(BigInt(x) >> BigInt(y)) : t.signed ? x >> y : (t.bits === 32 ? x >>> y : x >> y); break;
      case "&": v = x & y; break;
      case "|": v = x | y; break;
      case "^": v = x ^ y; break;
      case "==": v = x === y ? 1 : 0; break;
      case "!=": v = x !== y ? 1 : 0; break;
      case "<": v = x < y ? 1 : 0; break;
      case ">": v = x > y ? 1 : 0; break;
      case "<=": v = x <= y ? 1 : 0; break;
      case ">=": v = x >= y ? 1 : 0; break;
      default: return;
    }
    e.cv = e.kind === "cmp" ? v : w(v);
  }

  assign(e, scope) {
    const T = this.T;
    const a = this.expr(e.a, scope);
    e.a = a;
    if (!a.lv || a.k === "str") this.fail(e.pos, `lvalue required as left operand of assignment`);
    if (a.k === "id" && a.sym?.cnst) this.fail(e.pos, `assignment of read-only variable '${a.name}'`);
    if (a.type.cnst && a.type.k !== "ptr") this.fail(e.pos, `assignment of read-only location '${exprText(a)}'`);
    if (a.type.k === "arr") this.fail(e.pos, `invalid array assignment`);
    if (a.type.k === "class") this.unsupported("copying a library object", e.pos);
    const t = a.type;
    if (e.op === "=") {
      if (t.k === "struct" && e.b.k === "init") e.b = this.initializer(e.b, t, scope, e.pos);
      else {
        const b = this.expr(e.b, scope);
        if (t.k === "String" && !(b.type.k === "String" || isCStr(b.type))) {
          if (isArith(b.type)) this.fail(e.pos, `ambiguous overload for 'operator=' (operand types are 'String' and '${typeName(b.type)}')`);
          this.fail(e.pos, `no match for 'operator=' (operand types are 'String' and '${typeName(b.type)}')`);
        }
        e.b = this.conv(b, t, { what: "assign" }, e.pos);
      }
      e.type = t;
      e.lv = true;
      return e;
    }
    const bop = e.op.slice(0, -1);
    let b = this.rv(this.expr(e.b, scope));
    if (t.k === "String") {
      if (bop !== "+") this.fail(e.pos, `no match for 'operator${e.op}' (operand types are 'String' and '${typeName(b.type)}')`);
      if (!(b.type.k === "String" || isCStr(b.type) || isArith(b.type))) this.fail(e.pos, `no match for 'operator+=' (operand types are 'String' and '${typeName(b.type)}')`);
      e.kind = "strcat";
      e.b = b;
      e.type = t;
      e.lv = true;
      return e;
    }
    if (t.k === "ptr") {
      if ((bop === "+" || bop === "-") && isInt(b.type)) {
        e.kind = "ptradd";
        e.b = this.conv(b, T.long);
        e.type = t;
        e.lv = true;
        return e;
      }
      this.fail(e.pos, `invalid operands of types '${typeName(t)}' and '${typeName(b.type)}' to binary 'operator${bop}'`);
    }
    if (!isArith(t) || !isArith(b.type)) {
      this.fail(e.pos, `no match for 'operator${e.op}' (operand types are '${typeName(t)}' and '${typeName(b.type)}')`);
    }
    if (t.k === "enum") this.fail(e.pos, `invalid conversion from 'int' to '${t.name}' [-fpermissive]`);
    let ct;
    if (bop === "<<" || bop === ">>") {
      if (!isInt(t) || !isInt(b.type)) this.fail(e.pos, `invalid operands of types '${typeName(t)}' and '${typeName(b.type)}' to binary 'operator${bop}'`);
      ct = promote(t, T);
      b = this.conv(b, promote(b.type, T));
      e.kind = "shift";
    } else {
      ct = common(t, b.type, T);
      if ((bop === "%" || bop === "&" || bop === "|" || bop === "^") && ct.k === "float") {
        this.fail(e.pos, `invalid operands of types '${typeName(t)}' and '${typeName(b.type)}' to binary 'operator${bop}'`);
      }
      b = this.conv(b, ct);
      e.kind = "arith";
    }
    e.b = b;
    e.opType = ct;
    e.bop = bop;
    e.type = t;
    e.lv = true;
    return e;
  }

  ternary(e, scope) {
    const T = this.T;
    e.c = this.toBool(this.expr(e.c, scope), e.pos);
    let a = this.expr(e.a, scope), b = this.expr(e.b, scope);
    if (a.lv && b.lv && same(a.type, b.type) && a.type.k !== "arr") {
      e.a = a; e.b = b; e.type = a.type; e.lv = true;
    } else {
      a = this.rv(a); b = this.rv(b);
      const ta = a.type, tb = b.type;
      let t;
      if (isArith(ta) && isArith(tb)) t = ta.k === "enum" && same(ta, tb) ? ta : common(ta, tb, T);
      else if (same(ta, tb)) t = ta;
      else if (ta.k === "String" && isCStr(tb) || tb.k === "String" && isCStr(ta)) t = T.String;
      else if (ta.k === "ptr" && (tb.k === "null" || b.cv === 0)) t = ta;
      else if (tb.k === "ptr" && (ta.k === "null" || a.cv === 0)) t = tb;
      else if (ta.k === "ptr" && tb.k === "ptr" && isCharish(ta.to) && isCharish(tb.to)) t = ta.to.cnst ? ta : tb;
      else if (ta.k === "void" && tb.k === "void") t = T.void;
      else this.fail(e.pos, `operands to ?: have different types '${typeName(ta)}' and '${typeName(tb)}'`);
      e.a = t.k === "void" ? a : this.conv(a, t);
      e.b = t.k === "void" ? b : this.conv(b, t);
      e.type = t;
      e.lv = false;
    }
    if (e.c.cv !== undefined && e.a.cv !== undefined && e.b.cv !== undefined) e.cv = e.c.cv ? e.a.cv : e.b.cv;
    return e;
  }

  index(e, scope) {
    const T = this.T;
    const a = this.expr(e.a, scope);
    let i = this.rv(this.expr(e.i, scope));
    // 3[arr] is legal C, but nobody means it.
    if (a.type.k === "String") {
      if (!isInt(i.type)) this.fail(e.pos, `no match for 'operator[]' (operand types are 'String' and '${typeName(i.type)}')`);
      e.a = a; e.i = this.conv(i, T.uint); e.kind = "string"; e.type = T.char; e.lv = a.lv; return e;
    }
    if (a.type.k !== "arr" && a.type.k !== "ptr") {
      this.fail(e.pos, `invalid types '${typeName(a.type)}[${typeName(i.type)}]' for array subscript`);
    }
    if (!isInt(i.type)) this.fail(e.pos, `invalid types '${typeName(a.type)}[${typeName(i.type)}]' for array subscript`);
    e.a = a;
    e.i = this.conv(i, T.long);
    e.kind = a.type.k;
    e.type = a.type.k === "arr" ? a.type.of : a.type.to;
    if (a.type.k === "arr" && a.type.cnst) e.type = constOf(e.type);
    e.lv = true;
    if (a.type.k === "arr" && a.cv === undefined && e.i.cv !== undefined && a.type.n != null && a.k === "id" && a.sym?.cnst && a.sym.constItems) {
      e.cv = a.sym.constItems[e.i.cv];
    }
    return e;
  }

  member(e, scope) {
    const a = this.expr(e.a, scope);
    e.a = a;
    let t = a.type;
    if (e.arrow) {
      if (t.k !== "ptr") this.fail(e.opPos ?? e.pos, `base operand of '->' has non-pointer type '${typeName(t)}'`);
      t = t.to;
    } else if (t.k === "ptr" && (t.to.k === "struct" || t.to.k === "class")) {
      this.fail(e.pos, `request for member '${e.name}' in '${exprText(a)}', which is of pointer type '${typeName(t)}' (maybe you meant to use '->' ?)`);
    }
    if (t.k === "struct") {
      const f = t.fmap.get(e.name);
      if (!f) {
        if (t.methods?.has(e.name)) return { k: "methodref", obj: e, st: t, name: e.name, type: { k: "method" }, pos: e.pos };
        const s = suggest(e.name, [...t.fmap.keys(), ...(t.methods?.keys() ?? [])]);
        this.fail(e.pos, `'${className(t)}' has no member named '${e.name}'${s ? `; did you mean '${s}'?` : ""}`);
      }
      e.kind = "struct";
      e.field = f;
      e.type = a.type.cnst && !e.arrow ? constOf(f.type) : f.type;
      e.lv = true;
      return e;
    }
    if (t.k === "class") {
      const f = t.cls.fields.get(e.name);
      if (f) {
        e.kind = "native";
        e.type = f.type;
        e.lv = true;
        return e;
      }
      const c = t.cls.consts.get(e.name);
      if (c) return { k: "num", v: c.cv, cv: c.cv, type: c.type, pos: e.pos, lv: false };
      if (t.cls.methods.has(e.name) || (t.cls.printable && (e.name === "print" || e.name === "println" || e.name === "printf"))) {
        return { k: "methodref", obj: e, cls: t.cls, name: e.name, type: { k: "method" }, pos: e.pos };
      }
      this.noMember(t, e);
    }
    if (t.k === "String") {
      if (STRING_METHODS[e.name]) return { k: "methodref", obj: e, string: true, name: e.name, type: { k: "method" }, pos: e.pos };
      this.noMember(t, e);
    }
    this.fail(e.pos, `request for member '${e.name}' in '${exprText(a)}', which is of non-class type '${typeName(t)}'`);
  }

  noMember(t, e) {
    let names;
    if (t.k === "String") names = Object.keys(STRING_METHODS);
    else names = [...t.cls.methods.keys(), ...t.cls.fields.keys(), ...(t.cls.printable ? ["print", "println"] : [])];
    const s = suggest(e.name, names);
    this.fail(e.pos, `'${className(t)}' has no member named '${e.name}'${s ? `; did you mean '${s}'?` : ""}`);
  }

  castExpr(e, scope) {
    const T = this.T;
    let t = this.resolveType(e.type, { pos: e.pos });
    if (t.k === "ref") t = t.to;
    const a = this.rv(this.expr(e.a, scope));
    return this.explicitCast(a, t, e.pos, T);
  }

  explicitCast(a, t, pos) {
    const from = a.type;
    const out = { k: "cast", a, type: t, pos, explicit: true };
    if (t.k === "void") { out.type = this.T.void; return out; }
    if (isArith(t) && isArith(from)) {
      if (a.cv !== undefined) out.cv = wrapper(t)(t.k === "int" && from.k === "float" ? Math.trunc(a.cv) : a.cv);
      return out;
    }
    if (t.k === "bool" && (from.k === "ptr" || from.k === "null")) return out;
    if (t.k === "ptr" && (from.k === "ptr" || from.k === "null")) return out;
    if (t.k === "ptr" && isInt(from) && a.cv === 0) { out.cv = null; return out; }
    if (t.k === "ptr" && isInt(from)) this.unsupported("turning a number into a pointer", pos);
    if (isInt(t) && from.k === "ptr") this.unsupported("turning a pointer into a number", pos);
    if (t.k === "String") return this.conv(a, t, { what: "init" }, pos);
    if (same(t, from)) return a;
    this.fail(pos, `invalid cast from type '${typeName(from)}' to type '${typeName(t)}'`);
  }

  constructExpr(e, scope) {
    const T = this.T;
    let t = this.resolveType(e.type, { pos: e.pos });
    if (t.k === "String") return this.stringCtor(e.args, e.pos, scope);
    if (t.k === "class") return this.construct(t.cls, t, e.args, e.pos, scope);
    if (t.k === "struct") {
      if (t.ctors?.length) return this.structCtor(t, e.args, e.pos, scope);
      return { ...this.initializer({ k: "init", items: e.args, pos: e.pos }, t, scope, e.pos), type: t };
    }
    if (e.args.length === 0) return { k: "num", v: 0, cv: zeroOf(t), type: t, pos: e.pos };
    if (e.args.length > 1) this.fail(e.pos, `expression list treated as compound expression in functional cast [-fpermissive]`);
    void T;
    return this.explicitCast(this.rv(this.expr(e.args[0], scope)), t, e.pos);
  }

  /** String(x), String(x, HEX), String(3.14, 3) */
  stringCtor(args, pos, scope) {
    const T = this.T;
    const checked = args.map((a) => this.rv(this.expr(a, scope)));
    if (checked.length > 2) this.fail(pos, `no matching function for call to 'String::String(${checked.map((x) => typeName(x.type)).join(", ")})'`);
    const [v, extra] = checked;
    if (!v) return { k: "strctor", args: [], type: T.String, pos };
    const vt = v.type;
    if (!(vt.k === "String" || isCStr(vt) || isArith(vt))) {
      this.fail(pos, `no matching function for call to 'String::String(${checked.map((x) => typeName(x.type)).join(", ")})'`);
    }
    if (extra && !(isArith(vt) && isArith(extra.type))) {
      this.fail(pos, `no matching function for call to 'String::String(${checked.map((x) => typeName(x.type)).join(", ")})'`);
    }
    return { k: "strctor", args: checked, type: T.String, pos };
  }

  lambda(e, scope) {
    const T = this.T;
    const info = new FnInfo("lambda", this.info);
    this.fns.push(info);
    const params = e.params.map((p) => {
      let t = this.resolveType(p.type, { pos: p.pos });
      let ref = false;
      if (t.k === "ref") { ref = true; t = t.to; }
      if (t.k === "arr") t = ptr(t.of);
      return { name: p.name, type: t, ref, pos: p.pos };
    });
    const fn = { name: "lambda", ret: e.ret ? this.resolveType(e.ret, { pos: e.pos }) : null, params, body: e.body, pos: e.pos, info, lambda: true };
    info.fn = fn;
    fn.lambdaRet = fn.ret === null ? null : undefined;
    const outer = new Scope(scope, "func", info);
    for (const p of params) {
      p.sym = { kind: "var", name: p.name, type: p.type, ref: p.ref, storage: "local", slot: info.slots++, info, pos: p.pos, param: true };
      if (p.name) outer.names.set(p.name, p.sym);
    }
    const saveFn = this.fn, saveInfo = this.info, saveLoop = this.loopDepth, saveSw = this.switchStack;
    this.fn = fn; this.info = info; this.loopDepth = 0; this.switchStack = [];
    const body = new Scope(outer, "block", info);
    body.fnTop = true;
    this.statements(e.body.body, body);
    if (fn.ret === null) fn.ret = fn.lambdaRet ?? T.void;
    this.fn = saveFn; this.info = saveInfo; this.loopDepth = saveLoop; this.switchStack = saveSw;
    e.fn = fn;
    e.info = info;
    e.type = { k: "fn", lambda: fn };
    e.lv = false;
    return e;
  }

  // ---------------------------------------------------------------- calls

  call(e, scope) {
    const T = this.T;
    const callee = this.expr(e.fn, scope);
    e.fn = callee;
    const pos = e.pos;
    if (callee.type.k === "method") {
      if (callee.string) return this.stringCall(e, callee, scope);
      if (callee.k === "staticref") return this.nativeMethodCall(e, null, callee.cls, callee.name, scope, true);
      if (callee.k === "selfmethod") {
        const self = { k: "this", pos };
        return this.structMethodCall(e, this.expr(self, scope), callee.st, callee.name, scope);
      }
      if (callee.st) return this.structMethodCall(e, callee.obj.a, callee.st, callee.name, scope, callee.obj.arrow);
      return this.nativeMethodCall(e, callee.obj.a, callee.cls, callee.name, scope, false, callee.obj.arrow);
    }
    if (callee.type.k === "fn" && callee.sym) {
      const sym = callee.sym;
      const args = e.args.map((a) => this.expr(a, scope));
      const name = sym.name;
      const fn = this.pickOverload(sym.overloads, args, pos, name, name);
      e.args = this.convertArgs(fn, args, pos);
      e.callee = fn;
      e.type = fn.ret;
      e.lv = false;
      if (fn.sys) {
        e.kind = "native";
        if (!fn.native) this.unsupported(`the function '${name}()'`, pos);
        if (fn.gen) this.info && (this.info.direct = true);
        if (!this.info && fn.gen) this.globalYield = true;
      } else {
        e.kind = "user";
        if (this.info) this.info.calls.add(fn);
        else (this.initCalls ||= new Set()).add(fn);
      }
      return e;
    }
    if (callee.type.k === "fn") {
      // Calling a lambda held in a variable, or a lambda right away.
      const lam = callee.type.lambda;
      const args = e.args.map((a) => this.expr(a, scope));
      e.kind = "fnvalue";
      if (lam) {
        if (args.length !== lam.params.length) this.fail(pos, `no match for call to '(lambda) (${args.map((a) => typeName(a.type)).join(", ")})'`);
        e.args = args.map((a, i) => (lam.params[i].ref ? a : this.conv(a, lam.params[i].type, { what: "arg" }, pos)));
        e.refs = lam.params.map((p) => p.ref);
        e.type = lam.ret ?? T.void;
      } else {
        e.args = args.map((a) => this.rv(a));
        e.type = T.void;
      }
      if (this.info) this.info.direct = true;
      return e;
    }
    if (callee.type.k === "callback") {
      e.kind = "fnvalue";
      e.args = e.args.map((a) => this.rv(this.expr(a, scope)));
      e.type = T.void;
      if (this.info) this.info.direct = true;
      return e;
    }
    if (callee.k === "id") this.fail(pos, `'${callee.name}' cannot be used as a function`);
    this.fail(pos, `expression cannot be used as a function`);
  }

  /** Picks the best overload, or fails with gcc's message. */
  pickOverload(cands, args, pos, name, display) {
    const viable = cands.filter((f) => {
      const need = f.params.filter((p) => !p.defExpr).length;
      return args.length >= need && (args.length <= f.params.length || f.variadic);
    });
    if (!viable.length) {
      if (cands.length === 1) {
        const f = cands[0];
        const few = args.length < f.params.filter((p) => !p.defExpr).length;
        if (f.cls || f.struct) {
          this.fail(pos, `no matching function for call to '${display}(${args.map((a) => argTypeName(a)).join(", ")})'`);
        }
        this.fail(pos, `too ${few ? "few" : "many"} arguments to function '${f.sig}'`);
      }
      this.fail(pos, `no matching function for call to '${display}(${args.map((a) => argTypeName(a)).join(", ")})'`);
    }
    let best = null, bestScore = -1, tie = false;
    for (const f of viable) {
      let score = 0;
      let ok = true;
      for (let i = 0; i < args.length && i < f.params.length; i++) {
        const p = f.params[i];
        const a = args[i];
        const at = a.type.k === "arr" && p.type.k !== "arr" ? ptr(a.type.of) : a.type;
        let r;
        if (p.ref) r = (a.lv || p.type.cnst) && (same(unconst(at), unconst(p.type)) || (isArith(at) && isArith(p.type) && p.type.cnst)) ? "exact" : null;
        else if (p.type.k === "ptr" && isInt(at) && a.cv === 0) r = "convert";
        else if (p.type.k === "String" && at.k === "class" && at.cls?.impl?.prototype?.toString && at.cls.name === "IPAddress") r = "convert";
        else r = convertRank(at, p.type);
        if (r === null) { ok = false; break; }
        score += r === "exact" ? 3 : r === "promote" ? 2 : 1;
      }
      if (!ok) continue;
      score = score * 4 - Math.max(0, f.params.length - args.length);
      if (score > bestScore) { best = f; bestScore = score; tie = false; }
      else if (score === bestScore) tie = true;
    }
    if (!best) {
      if (viable.length === 1 && !viable[0].cls && !viable[0].struct) return viable[0]; // convertArgs reports why
      this.fail(pos, `no matching function for call to '${display}(${args.map((a) => argTypeName(a)).join(", ")})'`);
    }
    void tie;
    return best;
  }

  /** Converts call arguments to the parameter types and adds defaults. */
  convertArgs(fn, args, pos) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      const p = fn.params[i];
      const a = args[i];
      if (!p) { // variadic extra argument
        const v = this.rv(a);
        if (v.type.k === "String") {
          // Passing a String to printf-style functions: allowed by the simulator.
        }
        if (v.type.k === "void") this.fail(pos, "invalid use of void expression");
        out.push(v);
        continue;
      }
      if (p.ref) {
        if (!a.lv && !p.type.cnst) this.fail(a.pos ?? pos, `cannot bind non-const lvalue reference of type '${typeName(p.type)}&' to an rvalue of type '${typeName(a.type)}'`);
        if (!a.lv) { out.push(this.conv(this.rv(a), p.type, { what: "arg", n: i + 1, fn }, pos)); out[i].refTemp = true; continue; }
        out.push(a);
        continue;
      }
      out.push(this.conv(a, p.type, { what: "arg", n: i + 1, fn }, pos));
    }
    for (let i = args.length; i < fn.params.length; i++) {
      const p = fn.params[i];
      if (!p.defExpr) break;
      if (!p.defChecked) p.defChecked = this.conv(this.expr(p.defExpr, this.global), p.type, { what: "init" }, pos);
      out.push(p.defChecked);
    }
    return out;
  }

  nativeMethodCall(e, obj, cls, name, scope, isStatic, arrow) {
    const T = this.T;
    const pos = e.pos;
    if (obj && !isStatic) {
      e.obj = obj;
      e.arrow = arrow;
    }
    const args = e.args.map((a) => this.expr(a, scope));
    if (cls.printable && (name === "print" || name === "println")) return this.printCall(e, obj, cls, name, args);
    if (cls.printable && name === "printf") {
      if (this.T.avr) this.noMember({ k: "class", cls, name: cls.name }, { name, pos });
      if (!args.length || !isCStr(this.rv(args[0]).type)) this.fail(pos, `no matching function for call to '${cls.name}::printf(${args.map(argTypeName).join(", ")})'`);
      e.kind = "printf";
      e.args = args.map((a) => this.rv(a));
      e.type = T.uint;
      return e;
    }
    const list = (isStatic ? cls.statics.get(name) : cls.methods.get(name)) || cls.statics.get(name);
    if (!list) this.noMember({ k: "class", cls, name: cls.name }, { name, pos });
    const fn = this.pickOverload(list, args, pos, name, `${cls.name}::${name}`);
    e.args = this.convertArgs(fn, args, pos);
    e.callee = fn;
    e.kind = fn.isStatic ? "static" : "method";
    e.cls = cls;
    e.name = name;
    e.type = fn.ret;
    e.lv = false;
    if (!fn.native) this.unsupported(`'${cls.name}.${name}()'`, pos);
    if (fn.gen && this.info) this.info.direct = true;
    return e;
  }

  structMethodCall(e, obj, st, name, scope, arrow) {
    const args = e.args.map((a) => this.expr(a, scope));
    const list = st.methods.get(name);
    const fn = this.pickOverload(list, args, e.pos, name, `${st.name}::${name}`);
    e.args = this.convertArgs(fn, args, e.pos);
    e.callee = fn;
    e.kind = "structmethod";
    e.obj = obj;
    e.arrow = arrow || obj.type.k === "ptr";
    e.type = fn.ret;
    if (this.info) this.info.calls.add(fn);
    return e;
  }

  printCall(e, obj, cls, name, args) {
    const T = this.T;
    e.kind = "print";
    e.obj = obj;
    e.ln = name === "println";
    e.type = T.uint;
    if (args.length > 2) this.fail(e.pos, `no matching function for call to '${cls.name}::${name}(${args.map(argTypeName).join(", ")})'`);
    const out = args.map((a) => this.rv(a));
    if (out[0]) {
      const t = out[0].type;
      const ok = isArith(t) || t.k === "String" || isCStr(t) || (t.k === "class" && t.cls?.impl?.prototype?.toString) ||
        (t.k === "ptr" && t.to.k === "struct" && t.to.name === "tm" && !T.avr);
      if (!ok || t.k === "void") {
        this.fail(e.pos, `no matching function for call to '${cls.name}::${name}(${args.map(argTypeName).join(", ")})'`);
      }
      if (out[1] && !(isArith(out[1].type) || (t.k === "ptr" && isCStr(out[1].type)))) {
        this.fail(e.pos, `no matching function for call to '${cls.name}::${name}(${args.map(argTypeName).join(", ")})'`);
      }
      if (out[1] && (t.k === "String" || isCStr(t))) {
        this.fail(e.pos, `no matching function for call to '${cls.name}::${name}(${args.map(argTypeName).join(", ")})'`);
      }
    }
    e.args = out;
    return e;
  }

  stringCall(e, ref, scope) {
    const T = this.T;
    const spec = STRING_METHODS[ref.name];
    const args = e.args.map((a) => this.rv(this.expr(a, scope)));
    const [min, max] = spec.arity;
    if (args.length < min || args.length > max) {
      this.fail(e.pos, `no matching function for call to 'String::${ref.name}(${args.map(argTypeName).join(", ")})'`);
    }
    args.forEach((a, i) => {
      const want = spec.args[i];
      const t = a.type;
      const ok = want === "num" ? isArith(t) : want === "text" ? t.k === "String" || isCStr(t) : want === "textchar" ? t.k === "String" || isCStr(t) || isArith(t) : want === "any" ? (isArith(t) || t.k === "String" || isCStr(t)) : want === "buf" ? t.k === "ptr" && isCharish(t.to) : true;
      if (!ok) this.fail(e.pos, `no matching function for call to 'String::${ref.name}(${args.map(argTypeName).join(", ")})'`);
    });
    e.kind = "string";
    e.obj = ref.obj.a;
    e.name = ref.name;
    e.args = args;
    e.type = spec.ret === "String" ? T.String : spec.ret === "void" ? T.void : spec.ret === "cstr" ? T.cstr : T[spec.ret];
    e.mut = !!spec.mut;
    e.lv = false;
    return e;
  }

  // ---------------------------------------------------------------- conversions

  /**
   * Implicit conversion of e to type `to`, with gcc's errors.
   * ctx: { what: "init" | "assign" | "return" | "arg", n, fn }
   */
  conv(e, to, ctx = {}, pos = e.pos) {
    const T = this.T;
    if (to.k === "arr" && e.type.k === "arr") return e;
    e = this.rv(e);
    const from = e.type;
    if (same(from, to) && !(from.k === "arr")) {
      if (from.k === "ptr" && from.to.cnst && !to.to.cnst && to.to.k !== "void") {
        if (!(e.k === "cast" && e.a?.k === "str")) this.fail(pos, `invalid conversion from '${typeName(from)}' to '${typeName(to)}' [-fpermissive]`);
      }
      return e;
    }
    if (from.k === "void") this.fail(pos, `void value not ignored as it ought to be`);
    const where = () => {
      switch (ctx.what) {
        case "init": return " in initialization";
        case "assign": return " in assignment";
        case "return": return " in return";
        case "arg": return ctx.fn ? ` for argument '${ctx.n}' to '${ctx.fn.sig}'` : "";
        default: return "";
      }
    };
    const mk = () => {
      const c = { k: "cast", a: e, type: to, implicit: true, pos: e.pos };
      if (e.cv !== undefined && isArith(to) && isArith(from)) c.cv = wrapper(to)(isInt(to) && from.k === "float" ? Math.trunc(e.cv) : e.cv);
      return c;
    };
    if (to.k === "callback") {
      if (from.k === "fn" || from.k === "callback") return { k: "cast", a: e, type: to, implicit: true, pos: e.pos, fnval: true };
      this.fail(pos, `invalid conversion from '${typeName(from)}' to 'callback'`);
    }
    if (from.k === "fn") {
      if (from.sym && !from.lambda) this.fail(pos, `invalid use of non-static member function or function name '${from.sym.name}'`);
      this.fail(pos, `cannot convert '<lambda>' to '${typeName(to)}'${where()}`);
    }
    if (isArith(to) && isArith(from)) {
      if (to.k === "enum" && !same(from, to)) this.fail(pos, `invalid conversion from '${typeName(from)}' to '${to.name}' [-fpermissive]`);
      return mk();
    }
    if (to.k === "bool" && (from.k === "ptr" || from.k === "null")) return mk();
    if (to.k === "ptr") {
      if (from.k === "null") return mk();
      if (isInt(from) && e.cv === 0) return { k: "num", v: null, cv: null, type: to, pos: e.pos };
      if (from.k === "ptr") {
        if (to.to.k === "void" || same(unconst(from.to), unconst(to.to)) || (isCharish(from.to) && isCharish(to.to))) {
          if (from.to.cnst && !to.to.cnst && !(e.k === "cast" && e.a?.k === "str")) {
            this.fail(pos, `invalid conversion from '${typeName(from)}' to '${typeName(to)}' [-fpermissive]`);
          }
          return mk();
        }
        if (to.to.k === "class" && from.to.k === "class") {
          if (from.to.cls === to.to.cls || from.to.cls.bases.includes(to.to.name)) return mk();
        }
        this.fail(pos, `cannot convert '${typeName(from)}' to '${typeName(to)}'${where()}`);
      }
      if (isArith(from)) this.fail(pos, `invalid conversion from '${typeNameAka(from)}' to '${typeName(to)}' [-fpermissive]`);
      this.fail(pos, `cannot convert '${typeName(from)}' to '${typeName(to)}'${where()}`);
    }
    if (to.k === "String") {
      if (from.k === "String") return e;
      if (isCStr(from)) return mk();
      if (from.k === "class" && from.cls?.impl?.prototype?.toString) return mk();
      this.fail(pos, `conversion from '${typeNameAka(from)}' to non-scalar type 'String' requested`);
    }
    if (isArith(to)) {
      if (from.k === "ptr" || from.k === "null") {
        if (to.k === "bool") return mk();
        this.fail(pos, `invalid conversion from '${typeName(from)}' to '${typeNameAka(to)}' [-fpermissive]`);
      }
      this.fail(pos, `cannot convert '${typeName(from)}' to '${typeNameAka(to)}'${where()}`);
    }
    if (to.k === "struct" || to.k === "class") {
      if (from.k === to.k && from.name === to.name) return e;
      this.fail(pos, `conversion from '${typeName(from)}' to non-scalar type '${typeName(to)}' requested`);
    }
    if (to.k === "fn") return e;
    this.fail(pos, `cannot convert '${typeName(from)}' to '${typeName(to)}'${where()}`);
  }

  // ---------------------------------------------------------------- link + yields

  linkCheck() {
    const need = (name) => {
      const sym = this.global.names.get(name);
      const fn = sym?.kind === "func" && sym.overloads.find((o) => o.params.length === 0 && o.body);
      if (!fn) this.errors.push(new CompileError(0, 0, `undefined reference to \`${name}'`));
    };
    need("setup");
    need("loop");
    // Functions that are called but never written.
    const called = new Set();
    for (const info of this.fns) for (const f of info.calls) called.add(f);
    for (const f of this.initCalls || []) called.add(f);
    for (const f of called) {
      if (!f.body && !f.sys) {
        this.errors.push(new CompileError(0, 0, `undefined reference to \`${f.name}(${f.params.map((p) => typeName(p.type)).join(", ")})'`));
      }
    }
  }

  yieldAnalysis() {
    // A function yields if it has a loop, waits (delay...), or calls one that does.
    // Recursive functions also yield, so a runaway recursion can be stopped.
    for (const info of this.fns) info.yields = info.direct;
    let changed = true;
    while (changed) {
      changed = false;
      for (const info of this.fns) {
        if (info.yields) continue;
        for (const f of info.calls) {
          if (f.info?.yields) { info.yields = true; changed = true; break; }
        }
      }
    }
    for (const info of this.fns) {
      if (info.yields) continue;
      // Recursion: can this function reach itself?
      const seen = new Set();
      const stack = [...info.calls];
      while (stack.length) {
        const f = stack.pop();
        if (!f.info || seen.has(f.info)) continue;
        if (f.info === info) { info.yields = true; info.recursive = true; break; }
        seen.add(f.info);
        stack.push(...f.info.calls);
      }
    }
    // Recursive ones make their callers yield too.
    changed = true;
    while (changed) {
      changed = false;
      for (const info of this.fns) {
        if (info.yields) continue;
        for (const f of info.calls) {
          if (f.info?.yields) { info.yields = true; changed = true; break; }
        }
      }
    }
    for (const info of this.fns) {
      // Mark cycles for the stack-depth check.
      const seen = new Set();
      const stack = [...info.calls];
      while (stack.length) {
        const f = stack.pop();
        if (!f.info || seen.has(f.info)) continue;
        if (f.info === info) { info.recursive = true; break; }
        seen.add(f.info);
        stack.push(...f.info.calls);
      }
    }
  }
}

function typeNameAka(t) {
  if (t.alias && t.alias !== t.name) return `${t.alias} {aka ${t.name}}`;
  return typeName(t);
}

function argTypeName(a) {
  if (a.k === "str") return typeName(a.type);
  return typeName(a.type) + (a.lv && a.type.k !== "arr" ? "&" : "");
}

/** A short text for an expression, for messages. */
export function exprText(e) {
  if (!e) return "";
  switch (e.k) {
    case "id": return e.name;
    case "num": return e.raw ?? String(e.v);
    case "str": return '"' + String.fromCharCode(...e.bytes) + '"';
    case "member": return exprText(e.a) + (e.arrow ? "->" : ".") + e.name;
    case "index": return exprText(e.a) + "[" + exprText(e.i) + "]";
    case "call": return exprText(e.fn) + "(...)";
    case "cast": return exprText(e.a);
    case "un": return e.op + exprText(e.a);
    default: return "...";
  }
}

export { isScalar };
