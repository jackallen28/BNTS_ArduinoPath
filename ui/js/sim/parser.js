// The parser: preprocessed tokens → an AST of the Arduino C++ subset.
// Syntax errors are worded like gcc's (the Coach's errors database matches
// them). Type names must be known while parsing (C++ needs that), so the
// parser keeps a table of them: built-in words, typedefs, structs, enums and
// library classes from the included headers.

import { CompileError } from "./preprocess.js";
import { describeToken } from "./lexer.js";
import { suggest } from "./suggest.js";

const BASE_WORDS = new Set(["void", "bool", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "auto", "wchar_t", "char16_t", "char32_t"]);
const QUALIFIERS = new Set(["const", "volatile", "static", "extern", "inline", "register", "constexpr", "mutable", "explicit", "virtual", "friend", "typename"]);
const STATEMENT_WORDS = new Set(["if", "else", "while", "do", "for", "switch", "case", "default", "break", "continue", "return", "goto", "try", "catch", "throw"]);
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>="]);
const BIN_PREC = {
  "*": 13, "/": 13, "%": 13, "+": 12, "-": 12, "<<": 11, ">>": 11,
  "<": 10, "<=": 10, ">": 10, ">=": 10, "==": 9, "!=": 9,
  "&": 8, "^": 7, "|": 6, "&&": 5, "||": 4,
};
const CLOSERS = new Set([";", ")", "]", "}", ">"]);

export class Unsupported extends Error {
  constructor(what, tok) {
    super(what);
    this.unsupported = true;
    this.what = what;
    this.line = tok?.line ?? 0;
    this.col = tok?.col ?? 0;
  }
}

const posOf = (tok) => ({ line: tok.line, col: tok.col, sys: !!tok.sys });

/**
 * Parses preprocessed tokens.
 * @param {object[]} tokens from preprocess()
 * @param {object} [opts]
 * @param {Set<string>} [opts.typeNames] extra type names known before parsing
 * @returns {{ items: object[], errors: CompileError[] }}
 */
export function parse(tokens, opts = {}) {
  return new Parser(tokens, opts).unit();
}

class Parser {
  constructor(tokens, { typeNames = new Set() } = {}) {
    this.toks = tokens;
    this.p = 0;
    this.types = new Map(); // name → "typedef" | "struct" | "enum" | "class"
    for (const n of typeNames) this.types.set(n, "typedef");
    this.classMembers = new Map(); // class name → Set of nested type / constant names
    this.errors = [];
    this.inSys = false;
  }

  // ---- token helpers ----
  get tok() { return this.toks[this.p]; }
  peek(k = 1) { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  next() { const t = this.toks[this.p]; if (this.p < this.toks.length - 1) this.p++; return t; }
  prev() { return this.toks[this.p - 1]; }
  isOp(v, t = this.tok) { return t.t === "op" && t.v === v; }
  isId(v, t = this.tok) { return t.t === "id" && (v === undefined || t.v === v); }
  eat(v) { if (this.isOp(v)) { this.next(); return true; } return false; }
  eatId(v) { if (this.isId(v)) { this.next(); return true; } return false; }

  /** "expected X before Y", placed the way gcc places it. */
  errExpected(what, tok = this.tok, { atToken = false } = {}) {
    const d = describeToken(tok);
    const msg = d ? `expected ${what} before ${d}` : `expected ${what} at end of input`;
    const prev = this.toks[this.p - 1];
    const single = /^'.'$/.test(what) && CLOSERS.has(what[1]);
    if (!atToken && single && prev && tok === this.tok && (prev.endLine !== tok.line || tok.t === "eof")) {
      return new CompileError(prev.endLine, prev.endCol + 1, msg);
    }
    return new CompileError(tok.line, tok.col, msg);
  }
  expect(v) {
    if (this.isOp(v)) return this.next();
    throw this.errExpected(`'${v}'`);
  }
  err(tok, msg) { return new CompileError(tok.line, tok.col, msg); }
  unsupported(what, tok = this.tok) { return new Unsupported(what, tok); }

  isTypeName(name) { return BASE_WORDS.has(name) || this.types.has(name); }

  /** Could a declaration start here? */
  isDeclStart() {
    const t = this.tok;
    if (t.t !== "id") return false;
    if (BASE_WORDS.has(t.v) || QUALIFIERS.has(t.v)) return true;
    if (t.v === "struct" || t.v === "enum" || t.v === "union" || t.v === "class" || t.v === "typedef") return true;
    if (this.types.has(t.v)) {
      const n = this.peek();
      // `String(x)` and `Type::member` start expressions.
      // Class::Type name is a declaration; Class::CONSTANT starts an expression.
      if (this.isOp("::", n)) return this.peek(2).t === "id" && (this.peek(3).t === "id" || this.isOp("*", this.peek(3)));
      if (this.isOp("(", n) || this.isOp(".", n) || this.isOp("{", n)) return false;
      return true;
    }
    return false;
  }

  // ---- the translation unit ----
  unit() {
    const items = [];
    while (this.tok.t !== "eof") {
      try {
        this.topLevel(items);
      } catch (e) {
        if (e instanceof CompileError) {
          this.errors.push(e);
          break;
        }
        throw e;
      }
    }
    return { items, errors: this.errors, types: this.types };
  }

  topLevel(items) {
    const t = this.tok;
    this.inSys = !!t.sys;
    if (this.eat(";")) return;
    if (t.t === "id") {
      if (t.v === "template") throw this.unsupported("templates", t);
      if (t.v === "namespace") throw this.unsupported("namespaces", t);
      if (t.v === "using") { // using namespace std; is harmless
        while (!this.isOp(";") && this.tok.t !== "eof") this.next();
        this.eat(";");
        return;
      }
      if (t.v === "extern" && this.peek().t === "str") { // extern "C" { ... }
        this.next(); this.next();
        if (this.eat("{")) {
          while (!this.isOp("}") && this.tok.t !== "eof") this.topLevel(items);
          this.expect("}");
        }
        return;
      }
      if (STATEMENT_WORDS.has(t.v)) throw this.err(t, `expected unqualified-id before '${t.v}'`);
      if (!this.isDeclStart()) {
        const n = this.peek();
        if (this.isOp("(", n) && !this.types.has(t.v)) {
          throw this.err(n, "expected constructor, destructor, or type conversion before '(' token");
        }
        if (this.isOp("::", n) && !this.types.has(t.v)) throw this.unsupported("namespaces and '::'", t);
        throw this.err(t, `'${t.v}' does not name a type${this.didYouMeanType(t.v)}`);
      }
      this.declaration(items, "global");
      return;
    }
    if (this.isOp("}")) throw this.err(t, "expected declaration before '}' token");
    const d = describeToken(t);
    throw this.err(t, `expected unqualified-id before ${d ?? "end of input"}`);
  }

  didYouMeanType(name) {
    const s = suggest(name, [...this.types.keys(), ...BASE_WORDS].filter((n) => n !== "wchar_t" && n !== "char16_t" && n !== "char32_t"));
    return s ? `; did you mean '${s}'?` : "";
  }

  // ---- declarations ----

  /** decl-specifiers: qualifiers and a base type. Returns { base, flags, def }. */
  declSpecs(ctx) {
    const flags = {};
    const words = [];
    let name = null, def = null, nameTok = null;
    const start = this.tok;
    for (;;) {
      const t = this.tok;
      if (t.t !== "id") break;
      if (QUALIFIERS.has(t.v)) {
        if (t.v === "virtual" && !t.sys) throw this.unsupported("virtual functions", t);
        if (t.v === "friend" && !t.sys) throw this.unsupported("friend declarations", t);
        flags[t.v] = true;
        this.next();
        continue;
      }
      if (BASE_WORDS.has(t.v) && !name) {
        words.push(t.v);
        this.next();
        continue;
      }
      if ((t.v === "struct" || t.v === "class" || t.v === "union" || t.v === "enum") && !name && !words.length) {
        if (t.v === "union") throw this.unsupported("unions", t);
        this.next();
        const isEnum = t.v === "enum";
        let scoped = false;
        if (isEnum && (this.isId("class") || this.isId("struct"))) { this.next(); scoped = true; }
        let tag = null;
        if (this.tok.t === "id" && !this.isOp("{", this.tok)) { tag = this.next().v; }
        if (isEnum) {
          let base = null;
          if (this.eat(":")) base = this.declSpecs("param").base;
          if (this.isOp("{")) {
            def = this.enumBody(tag, scoped, base, t);
            name = def.name;
          } else {
            if (!tag) throw this.errExpected("identifier");
            name = tag;
            if (!this.types.has(tag)) this.types.set(tag, "enum");
          }
          nameTok = t;
          continue;
        }
        if (tag && !this.types.has(tag)) this.types.set(tag, "struct");
        const bases = [];
        if (this.isOp(":") && this.peek().t === "id") {
          if (!t.sys) throw this.unsupported("classes that inherit from other classes", this.tok);
          this.next();
          do {
            while (this.isId("public") || this.isId("private") || this.isId("protected") || this.isId("virtual")) this.next();
            bases.push(this.next().v);
          } while (this.eat(","));
        }
        if (this.isOp("{")) {
          def = this.structBody(tag, t.v === "class", t);
          def.bases = bases;
          name = def.name;
        } else {
          if (!tag) throw this.errExpected("identifier");
          name = tag;
        }
        nameTok = t;
        continue;
      }
      if (!name && !words.length && this.types.has(t.v)) {
        // A class member type: MD_MAX72XX::moduleType_t
        if (this.isOp("::", this.peek()) && this.peek(2).t === "id") {
          const cls = t.v;
          this.next(); this.next();
          const member = this.next().v;
          name = this.types.has(member) ? member : `${cls}::${member}`;
          nameTok = t;
          continue;
        }
        name = t.v;
        nameTok = t;
        this.next();
        continue;
      }
      break;
    }
    if (!name && !words.length) {
      if (flags.const || flags.static || flags.unsigned) return null;
      return null;
    }
    const base = { k: "tbase", words, name, cnst: !!flags.const, pos: posOf(nameTok || start), def };
    return { base, flags, def, start };
  }

  structBody(tag, isClass, kwTok) {
    const name = tag || `__anon${this.p}`;
    this.types.set(name, isClass && this.inSys ? "class" : "struct");
    this.expect("{");
    const fields = [], methods = [], enums = [], ctors = [];
    let access = isClass ? "private" : "public";
    const members = new Set();
    this.classMembers.set(name, members);
    while (!this.isOp("}")) {
      if (this.tok.t === "eof") throw this.errExpected("'}'");
      if (this.eat(";")) continue;
      if ((this.isId("public") || this.isId("private") || this.isId("protected")) && this.isOp(":", this.peek())) {
        access = this.next().v;
        this.next();
        continue;
      }
      const t = this.tok;
      if (this.isId("template")) throw this.unsupported("templates", t);
      if (this.isId("operator") || (this.isDeclStart() && this.isOp("operator", this.peek()))) {
        // operator overloads: skip in headers, unsupported in sketches
        if (!t.sys) throw this.unsupported("operator overloading", t);
        this.skipMember();
        continue;
      }
      // Constructor / destructor: Name( ... )
      if ((this.isId(name) || (this.isOp("~") && this.isId(name, this.peek()))) && (this.isOp("(", this.peek()) || this.isOp("(", this.peek(2)))) {
        const dtor = this.eat("~");
        const nt = this.next();
        const params = this.paramList();
        if (this.isOp(":")) { // initialiser list
          if (!t.sys) {
            this.next();
            const inits = [];
            do {
              const fn = this.next();
              this.expect("(");
              const args = this.isOp(")") ? [] : this.argList();
              this.expect(")");
              inits.push({ name: fn.v, args, pos: posOf(fn) });
            } while (this.eat(","));
            const body = this.block();
            ctors.push({ k: "ctor", name, params, body, inits, dtor, pos: posOf(nt), access });
            continue;
          }
        }
        let body = null;
        if (this.isOp("{")) body = this.block();
        else this.expect(";");
        if (!dtor) ctors.push({ k: "ctor", name, params, body, inits: [], pos: posOf(nt), access, sys: !!nt.sys });
        continue;
      }
      if (this.isId("enum")) {
        const specs = this.declSpecs("member");
        if (specs.def) {
          enums.push(specs.def);
          for (const it of specs.def.items) members.add(it.name);
          members.add(specs.def.name);
        }
        this.expect(";");
        continue;
      }
      if (this.isId("typedef")) {
        const td = [];
        this.typedef(td);
        for (const d of td) { members.add(d.name); this.types.set(d.name, "typedef"); }
        enums.push(...td);
        continue;
      }
      const specs = this.declSpecs("member");
      if (!specs) throw this.errExpected("unqualified-id");
      if (specs.def && specs.def.k === "enum") enums.push(specs.def);
      let ended = false;
      do {
        const d = this.declarator(specs.base, "member");
        if (d.fn) {
          ended = true;
          let isConst = false;
          if (this.eatId("const")) isConst = true;
          while (this.isId("override") || this.isId("noexcept")) this.next();
          let body = null;
          if (this.isOp("{")) body = this.block();
          else if (this.eat("=")) { this.next(); this.expect(";"); } // = 0 / = default
          else this.expect(";");
          methods.push({ k: "func", name: d.name, ret: d.type.ret, params: d.type.params, body, pos: d.pos, isStatic: !!specs.flags.static, isConst, access, sys: !!t.sys, variadic: d.type.variadic });
          break;
        }
        let init = null;
        if (this.eat("=")) init = this.initializer();
        else if (this.isOp("{")) init = this.initializer();
        fields.push({ name: d.name, type: d.type, init, pos: d.pos, isStatic: !!specs.flags.static, cnst: !!specs.flags.const || !!specs.flags.constexpr, access });
        members.add(d.name);
      } while (this.eat(","));
      if (ended) continue;
      this.expect(";");
    }
    this.next(); // }
    return { k: "struct", name, isClass, fields, methods, ctors, enums, pos: posOf(kwTok), sys: !!kwTok.sys, anon: !tag };
  }

  skipMember() {
    let depth = 0;
    while (this.tok.t !== "eof") {
      if (this.isOp("{")) depth++;
      if (this.isOp("}")) { if (depth === 0) return; depth--; if (depth === 0) { this.next(); return; } }
      if (this.isOp(";") && depth === 0) { this.next(); return; }
      this.next();
    }
  }

  enumBody(tag, scoped, base, kwTok) {
    const name = tag || `__enum${this.p}`;
    this.types.set(name, "enum");
    this.expect("{");
    const items = [];
    while (!this.isOp("}")) {
      const t = this.tok;
      if (t.t !== "id") throw this.errExpected("identifier");
      this.next();
      let value = null;
      if (this.eat("=")) value = this.assignExpr();
      items.push({ name: t.v, value, pos: posOf(t) });
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { k: "enum", name, scoped, base, items, pos: posOf(kwTok), anon: !tag };
  }

  typedef(items) {
    const kw = this.next(); // typedef
    const specs = this.declSpecs("typedef");
    if (!specs) throw this.errExpected("type-specifier");
    if (specs.def) items.push(specs.def);
    do {
      if (this.isOp("(")) throw this.unsupported("function pointer types", this.tok);
      const d = this.declarator(specs.base, "typedef");
      this.types.set(d.name, "typedef");
      items.push({ k: "typedef", name: d.name, type: d.type, pos: d.pos });
    } while (this.eat(","));
    this.expect(";");
    void kw;
  }

  /**
   * A declaration: specs then declarators. Pushes nodes onto `items`.
   * ctx: "global" | "local" | "for"
   */
  declaration(items, ctx) {
    if (this.isId("typedef")) return this.typedef(items);
    const start = this.tok;
    const specs = this.declSpecs(ctx);
    if (!specs) throw this.errExpected("unqualified-id");
    if (specs.def) items.push(specs.def);
    if (this.isOp(";")) {
      this.next();
      return;
    }
    const decls = [];
    for (;;) {
      if (this.tok.t !== "id" && !this.isOp("*") && !this.isOp("&") && !this.isOp("(")) {
        if (this.tok.t === "num") throw this.err(this.tok, "expected unqualified-id before numeric constant");
        if (this.tok.t === "str") throw this.err(this.tok, "expected unqualified-id before string constant");
        if (this.isOp("::") || this.isOp("<")) throw this.unsupported(this.isOp("<") ? "templates" : "namespaces and '::'", this.tok);
        throw this.errExpected("unqualified-id", this.tok, { atToken: true });
      }
      const d = this.declarator(specs.base, ctx);
      if (d.fn) {
        let isConst = false;
        if (this.eatId("const")) isConst = true;
        const fnode = { k: "func", name: d.name, ret: d.type.ret, params: d.type.params, body: null, pos: d.pos, sys: !!start.sys, isStatic: !!specs.flags.static, variadic: d.type.variadic, isConst, cls: d.cls };
        if (this.isOp("{")) {
          if (ctx !== "global") {
            this.errors.push(this.err(this.tok, "a function-definition is not allowed here before '{' token"));
            this.block();
            return;
          }
          fnode.body = this.block();
          items.push(fnode);
          return;
        }
        if (ctx === "global" || ctx === "local") {
          if (this.isOp(";") || this.isOp(",")) {
            items.push(fnode);
            if (this.eat(",")) continue;
            this.next();
            return;
          }
          throw this.err(this.tok, `expected initializer before ${describeToken(this.tok) ?? "end of input"}`);
        }
      }
      let init = null, ctorArgs = null;
      if (this.isOp("=")) {
        this.next();
        init = this.initializer();
      } else if (this.isOp("(") && ctx !== "for") {
        const lp = this.next();
        ctorArgs = this.isOp(")") ? [] : this.argList();
        this.expect(")");
        ctorArgs.pos = posOf(lp);
      } else if (this.isOp("{")) {
        init = this.initializer();
      }
      decls.push({ name: d.name, type: d.type, init, ctorArgs, pos: d.pos });
      if (ctx === "for" && this.isOp(":")) {
        items.push({ k: "var", specs: specs.flags, base: specs.base, decls, pos: posOf(start), sys: !!start.sys });
        return;
      }
      if (this.eat(",")) continue;
      if (ctx === "for") break;
      if (!this.isOp(";")) {
        if (ctx === "global" || ctx === "local") throw this.err(this.tok, `expected ',' or ';' before ${describeToken(this.tok) ?? "end of input"}`);
      }
      this.expect(";");
      break;
    }
    items.push({ k: "var", specs: specs.flags, base: specs.base, decls, pos: posOf(start), sys: !!start.sys });
  }

  /**
   * A declarator: pointers, references, a name, array sizes or a parameter list.
   * Returns { name, type, pos, fn? } where type wraps `base`.
   */
  declarator(base, ctx) {
    let type = base;
    let ref = false;
    for (;;) {
      if (this.eat("*")) {
        const cnst = this.eatId("const");
        type = { k: "tptr", to: type, cnst };
        continue;
      }
      if (this.isOp("&") || this.isOp("&&")) { this.next(); ref = true; continue; }
      if (this.isId("const") || this.isId("volatile")) { this.next(); continue; }
      break;
    }
    if (this.isOp("(") && (this.isOp("*", this.peek()) || this.isOp("&", this.peek()))) {
      throw this.unsupported("function pointers", this.tok);
    }
    let name = null, nameTok = this.tok, cls = null;
    const nameEnds = (t) => t.t === "op" && [",", ")", "[", "=", ";"].includes(t.v);
    if ((this.tok.t === "id" && !this.isTypeName(this.tok.v)) || (this.tok.t === "id" && ctx !== "param" && !BASE_WORDS.has(this.tok.v)) ||
        (this.tok.t === "id" && !BASE_WORDS.has(this.tok.v) && nameEnds(this.peek()))) {
      nameTok = this.next();
      name = nameTok.v;
      if (this.isOp("::") && this.peek().t === "id") { // Class::method definition
        if (!nameTok.sys) throw this.unsupported("class methods defined outside the class", nameTok);
        this.next();
        cls = name;
        name = this.next().v;
      }
      if (name === "operator") throw this.unsupported("operator overloading", nameTok);
    } else if (ctx !== "param" && ctx !== "cast") {
      if (this.tok.t === "num") throw this.err(this.tok, "expected unqualified-id before numeric constant");
      throw this.errExpected("unqualified-id", this.tok, { atToken: true });
    }
    const dims = [];
    while (this.isOp("[")) {
      this.next();
      if (this.isOp("]")) { dims.push(null); this.next(); continue; }
      dims.push(this.expr());
      this.expect("]");
    }
    for (let k = dims.length - 1; k >= 0; k--) type = { k: "tarr", of: type, size: dims[k] };
    if (ref) type = { k: "tref", to: type };
    if (this.isOp("(") && name && (ctx === "global" || ctx === "member" || ctx === "local" || ctx === "typedef") && this.looksLikeParams()) {
      const params = this.paramList();
      return { name, type: { k: "tfn", ret: type, params, variadic: params.variadic }, pos: posOf(nameTok), fn: true, cls };
    }
    return { name, type, pos: posOf(nameTok) };
  }

  /** After a name, is "(" a parameter list (a function) rather than constructor arguments? */
  looksLikeParams() {
    const n = this.peek();
    if (this.isOp(")", n)) {
      return true; // int f(); declares a function (the most vexing parse)
    }
    if (n.t === "id" && (this.isTypeName(n.v) || QUALIFIERS.has(n.v) || n.v === "struct" || n.v === "enum")) {
      // Type::CONSTANT is an argument, not a parameter.
      if (this.isOp("::", this.peek(2)) || this.isOp("(", this.peek(2))) return false;
      return true;
    }
    if (this.isOp("...", n)) return true;
    return false;
  }

  paramList() {
    this.expect("(");
    const params = [];
    if (this.isId("void") && this.isOp(")", this.peek())) { this.next(); }
    while (!this.isOp(")")) {
      if (this.isOp("...")) {
        this.next();
        params.variadic = true;
        if (!this.tok.sys && !this.inSys) throw this.unsupported("functions with '...' parameters", this.prev());
        break;
      }
      const t = this.tok;
      const specs = this.declSpecs("param");
      if (!specs) {
        if (t.t === "id") throw this.err(t, `'${t.v}' has not been declared${this.didYouMeanType(t.v)}`);
        throw this.errExpected("primary-expression", t, { atToken: true });
      }
      const d = this.declarator(specs.base, "param");
      if (this.isOp("(")) throw this.unsupported("function pointers", this.tok);
      let def = null;
      if (this.eat("=")) def = this.assignExpr();
      params.push({ name: d.name, type: d.type, def, pos: d.pos, cnst: !!specs.flags.const });
      if (!this.eat(",")) break;
    }
    this.expect(")");
    return params;
  }

  initializer() {
    if (this.isOp("{")) {
      const lb = this.next();
      const items = [];
      while (!this.isOp("}")) {
        if (this.isOp(".")) { // designated initialiser .x = 1
          this.next();
          const nm = this.next();
          this.expect("=");
          items.push({ ...this.initializer(), designator: nm.v });
        } else items.push(this.initializer());
        if (!this.eat(",")) break;
      }
      this.expect("}");
      return { k: "init", items, pos: posOf(lb) };
    }
    return this.assignExpr();
  }

  // ---- statements ----
  block() {
    const lb = this.expect("{");
    const body = [];
    while (!this.isOp("}")) {
      if (this.tok.t === "eof") {
        const last = this.prev() ?? this.tok;
        throw new CompileError(last.line, last.col, "expected '}' at end of input");
      }
      this.statement(body);
    }
    this.next();
    return { k: "block", body, pos: posOf(lb) };
  }

  /** Parses one statement and pushes it (declarations may push several nodes). */
  statement(out) {
    const t = this.tok;
    const pos = posOf(t);
    if (this.isOp("{")) { out.push(this.block()); return; }
    if (this.eat(";")) { out.push({ k: "empty", pos }); return; }
    if (t.t === "id") {
      switch (t.v) {
        case "if": {
          this.next();
          this.expectParenOpen();
          const c = this.condition();
          this.expect(")");
          const then = this.subStatement();
          let els = null;
          if (this.eatId("else")) els = this.subStatement();
          out.push({ k: "if", c, then, els, pos });
          return;
        }
        case "else": throw this.err(t, "'else' without a previous 'if'");
        case "while": {
          this.next();
          this.expectParenOpen();
          const c = this.condition();
          this.expect(")");
          out.push({ k: "while", c, body: this.subStatement(), pos });
          return;
        }
        case "do": {
          this.next();
          const body = this.subStatement();
          if (!this.isId("while")) throw this.errExpected("'while'", this.tok, { atToken: true });
          this.next();
          this.expectParenOpen();
          const c = this.expr();
          this.expect(")");
          this.expect(";");
          out.push({ k: "do", c, body, pos });
          return;
        }
        case "for": return out.push(this.forStatement(pos));
        case "switch": {
          this.next();
          this.expectParenOpen();
          const e = this.expr();
          this.expect(")");
          out.push({ k: "switch", e, body: this.subStatement(), pos });
          return;
        }
        case "case": {
          this.next();
          const v = this.condExpr();
          if (this.isOp("...")) throw this.unsupported("case ranges", this.tok);
          this.expect(":");
          out.push({ k: "case", v, pos });
          return;
        }
        case "default":
          if (this.isOp(":", this.peek())) {
            this.next(); this.next();
            out.push({ k: "default", pos });
            return;
          }
          break;
        case "break": this.next(); this.expect(";"); out.push({ k: "break", pos }); return;
        case "continue": this.next(); this.expect(";"); out.push({ k: "continue", pos }); return;
        case "return": {
          this.next();
          let e = null;
          if (!this.isOp(";")) e = this.isOp("{") ? this.initializer() : this.expr();
          this.expect(";");
          out.push({ k: "return", e, pos });
          return;
        }
        case "goto": throw this.unsupported("goto", t);
        case "try": case "catch": case "throw": throw this.unsupported("exceptions (try / catch / throw)", t);
        case "asm": case "__asm__": case "__asm": throw this.unsupported("inline assembly (asm)", t);
        case "template": throw this.unsupported("templates", t);
        case "delete": throw this.unsupported("new and delete", t);
      }
      if (this.isOp(":", this.peek()) && !STATEMENT_WORDS.has(t.v)) throw this.unsupported("labels and goto", t);
      if (this.isId("typedef") || this.isDeclStart()) {
        this.declaration(out, "local");
        return;
      }
      // An unknown name followed by a name: a type that doesn't exist.
      const n = this.peek();
      if (!this.isTypeName(t.v) && n.t === "id" && !STATEMENT_WORDS.has(n.v)) {
        const n2 = this.peek(2);
        if (this.isOp(";", n2) || this.isOp("=", n2) || this.isOp("(", n2) || this.isOp("[", n2) || this.isOp(",", n2)) {
          throw this.err(t, `'${t.v}' was not declared in this scope${this.didYouMeanType(t.v)}`);
        }
      }
    }
    const e = this.expr();
    if (!this.isOp(";")) throw this.errExpected("';'");
    this.next();
    out.push({ k: "expr", e, pos });
  }

  expectParenOpen() {
    if (!this.isOp("(")) throw this.errExpected("'('", this.tok, { atToken: true });
    this.next();
  }

  /** A condition: an expression, or a declaration like `if (int x = f())`. */
  condition() {
    if (this.isDeclStart()) {
      const items = [];
      const specs = this.declSpecs("local");
      const d = this.declarator(specs.base, "local");
      this.expect("=");
      const init = this.assignExpr();
      items.push({ name: d.name, type: d.type, init, pos: d.pos });
      return { k: "declcond", specs: specs.flags, decls: items, pos: d.pos };
    }
    return this.expr();
  }

  /** The body of if / while / for: one statement, as a block if it declares. */
  subStatement() {
    const out = [];
    this.statement(out);
    if (out.length === 1) return out[0];
    return { k: "block", body: out, pos: out[0]?.pos ?? posOf(this.tok) };
  }

  forStatement(pos) {
    this.next();
    this.expectParenOpen();
    let init = null;
    if (this.isOp(";")) this.next();
    else if (this.isDeclStart()) {
      const items = [];
      this.declaration(items, "for");
      const decl = items[items.length - 1];
      if (this.isOp(":")) { // range-based for
        this.next();
        const range = this.expr();
        this.expect(")");
        return { k: "forrange", decl, range, body: this.subStatement(), pos };
      }
      this.expect(";");
      init = { k: "block", body: items, pos, noScope: true };
    } else {
      init = { k: "expr", e: this.expr(), pos: posOf(this.tok) };
      this.expect(";");
    }
    const c = this.isOp(";") ? null : this.expr();
    this.expect(";");
    const step = this.isOp(")") ? null : this.expr();
    this.expect(")");
    return { k: "for", init, c, step, body: this.subStatement(), pos };
  }

  // ---- expressions ----
  expr() {
    let e = this.assignExpr();
    while (this.isOp(",")) {
      const t = this.next();
      e = { k: "comma", a: e, b: this.assignExpr(), pos: posOf(t) };
    }
    return e;
  }

  argList() {
    const args = [this.isOp("{") ? this.initializer() : this.assignExpr()];
    while (this.eat(",")) args.push(this.isOp("{") ? this.initializer() : this.assignExpr());
    return args;
  }

  assignExpr() {
    const left = this.condExpr();
    if (this.tok.t === "op" && ASSIGN_OPS.has(this.tok.v)) {
      const t = this.next();
      const right = this.isOp("{") ? this.initializer() : this.assignExpr();
      return { k: "assign", op: t.v, a: left, b: right, pos: posOf(t) };
    }
    return left;
  }

  condExpr() {
    const c = this.binExpr(4);
    if (this.isOp("?")) {
      const t = this.next();
      const a = this.expr();
      if (!this.isOp(":")) throw this.errExpected("':'");
      this.next();
      const b = this.assignExpr();
      return { k: "cond", c, a, b, pos: posOf(t) };
    }
    return c;
  }

  binExpr(minPrec) {
    let left = this.unary();
    for (;;) {
      const t = this.tok;
      const prec = t.t === "op" ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < minPrec) return left;
      this.next();
      const right = this.binExpr(prec + 1);
      left = { k: "bin", op: t.v, a: left, b: right, pos: posOf(t) };
    }
  }

  unary() {
    const t = this.tok;
    if (t.t === "op") {
      switch (t.v) {
        case "++": case "--":
          this.next();
          return { k: "pre", op: t.v, a: this.unary(), pos: posOf(t) };
        case "+": case "-": case "!": case "~": case "*": case "&":
          this.next();
          return { k: "un", op: t.v, a: this.unary(), pos: posOf(t) };
        case "(":
          if (this.isCastAhead()) {
            this.next();
            const type = this.typeId();
            this.expect(")");
            if (this.isOp("{")) return this.postfix({ k: "compound", type, init: this.initializer(), pos: posOf(t) });
            return { k: "cast", type, a: this.unary(), pos: posOf(t), style: "c" };
          }
          break;
      }
    }
    if (t.t === "id") {
      if (t.v === "sizeof") {
        this.next();
        if (this.isOp("(") && this.isTypeAt(this.peek())) {
          this.next();
          const type = this.typeId();
          this.expect(")");
          return { k: "sizeof", type, pos: posOf(t) };
        }
        return { k: "sizeof", e: this.unary(), pos: posOf(t) };
      }
      if (t.v === "new" || t.v === "delete") throw this.unsupported("new and delete", t);
      if (t.v === "throw") throw this.unsupported("exceptions (try / catch / throw)", t);
    }
    return this.postfix(this.primary());
  }

  /** Is "(" the start of a C-style cast? */
  isCastAhead() {
    const n = this.peek();
    if (!this.isTypeAt(n)) return false;
    // (Type)x, (Type*)x, (unsigned long)x; but not (Serial) or a call like (String(x))
    if (n.v in { String: 1 } && this.isOp("(", this.peek(2))) return false;
    if (this.types.has(n.v) && (this.isOp("(", this.peek(2)) || this.isOp("::", this.peek(2)) || this.isOp(".", this.peek(2)))) return false;
    return true;
  }

  isTypeAt(t) {
    if (t.t !== "id") return false;
    return BASE_WORDS.has(t.v) || this.types.has(t.v) || t.v === "const" || t.v === "struct" || t.v === "enum" || t.v === "volatile";
  }

  /** A type in a cast or sizeof: specs plus abstract pointer declarators. */
  typeId() {
    const specs = this.declSpecs("cast");
    if (!specs) throw this.errExpected("type-specifier");
    let type = specs.base;
    for (;;) {
      if (this.eat("*")) { type = { k: "tptr", to: type, cnst: this.eatId("const") }; continue; }
      if (this.isOp("&")) { this.next(); type = { k: "tref", to: type }; continue; }
      break;
    }
    while (this.isOp("[")) {
      this.next();
      const size = this.isOp("]") ? null : this.expr();
      this.expect("]");
      type = { k: "tarr", of: type, size };
    }
    return type;
  }

  primary() {
    const t = this.tok;
    const pos = posOf(t);
    switch (t.t) {
      case "num":
        this.next();
        return { k: "num", v: t.v, num: t.num, raw: t.raw, pos };
      case "chr":
        this.next();
        return { k: "chr", v: t.v, multi: !!t.multi, pos };
      case "str": {
        const bytes = [...t.v];
        this.next();
        while (this.tok.t === "str") bytes.push(...this.next().v);
        return { k: "str", bytes, pos };
      }
      case "id": {
        const v = t.v;
        if (v === "true" || v === "false") { this.next(); return { k: "bool", v: v === "true" ? 1 : 0, pos }; }
        if (v === "nullptr") { this.next(); return { k: "nullptr", pos }; }
        if (v === "this") { this.next(); return { k: "this", pos }; }
        if (v === "static_cast" || v === "const_cast" || v === "reinterpret_cast" || v === "dynamic_cast") {
          this.next();
          if (v === "reinterpret_cast" || v === "dynamic_cast") throw this.unsupported(v, t);
          this.expect("<");
          const type = this.typeId();
          this.expect(">");
          this.expect("(");
          const a = this.expr();
          this.expect(")");
          return { k: "cast", type, a, pos, style: v };
        }
        if (BASE_WORDS.has(v) || (this.types.has(v) && !this.isOp("::", this.peek()))) {
          // Functional cast or constructor call: int(x), String(5), Servo()
          const type = this.typeIdSimple();
          if (this.isOp("(")) {
            const lp = this.next();
            const args = this.isOp(")") ? [] : this.argList();
            this.expect(")");
            return { k: "construct", type, args, pos, lpos: posOf(lp) };
          }
          if (this.isOp("{")) {
            const init = this.initializer();
            return { k: "construct", type, args: init.items, brace: true, pos };
          }
          throw this.errExpected("primary-expression", this.tok, { atToken: true });
        }
        if (STATEMENT_WORDS.has(v) || QUALIFIERS.has(v) || v === "struct" || v === "enum" || v === "typedef") {
          throw this.err(t, `expected primary-expression before '${v}'`);
        }
        this.next();
        if (this.isOp("::")) {
          // Scoped names: Enum::VALUE, Class::CONSTANT, Class::staticMethod
          this.next();
          const m = this.tok;
          if (m.t !== "id") throw this.errExpected("unqualified-id", m, { atToken: true });
          this.next();
          if (v === "std") throw this.unsupported("the C++ standard library (std::)", t);
          return { k: "scope", scope: v, name: m.v, pos };
        }
        return { k: "id", name: v, pos };
      }
      case "op": {
        if (t.v === "(") {
          this.next();
          const e = this.expr();
          if (!this.isOp(")")) throw this.errExpected("')'");
          this.next();
          return { k: "paren", e, pos };
        }
        if (t.v === "[") return this.lambda();
        if (t.v === "::") { this.next(); return this.primary(); }
        throw this.err(t, `expected primary-expression before '${t.v}' token`);
      }
      case "eof":
        throw new CompileError(t.line, t.col, "expected primary-expression at end of input");
    }
    throw this.err(t, "expected primary-expression");
  }

  typeIdSimple() {
    const specs = this.declSpecs("cast");
    return specs.base;
  }

  lambda() {
    const lb = this.next(); // [
    const captures = [];
    while (!this.isOp("]")) {
      captures.push(this.next().v);
      if (this.tok.t === "eof") throw this.errExpected("']'");
    }
    this.next();
    let params = [];
    if (this.isOp("(")) params = this.paramList();
    while (this.isId("mutable") || this.isId("noexcept")) this.next();
    let ret = null;
    if (this.eat("->")) ret = this.typeId();
    const body = this.block();
    return { k: "lambda", captures, params, ret, body, pos: posOf(lb) };
  }

  postfix(e) {
    for (;;) {
      const t = this.tok;
      if (this.isOp("[")) {
        this.next();
        const i = this.expr();
        this.expect("]");
        e = { k: "index", a: e, i, pos: posOf(t) };
        continue;
      }
      if (this.isOp("(")) {
        this.next();
        const args = this.isOp(")") ? [] : this.argList();
        if (!this.isOp(")")) throw this.errExpected("')'");
        this.next();
        e = { k: "call", fn: e, args, pos: e.pos, lpos: posOf(t) };
        continue;
      }
      if (this.isOp(".") || this.isOp("->")) {
        this.next();
        const m = this.tok;
        if (m.t !== "id") throw this.errExpected("unqualified-id", m, { atToken: true });
        this.next();
        e = { k: "member", a: e, name: m.v, arrow: t.v === "->", pos: posOf(m), opPos: posOf(t) };
        continue;
      }
      if (this.isOp("++") || this.isOp("--")) {
        this.next();
        e = { k: "post", op: t.v, a: e, pos: posOf(t) };
        continue;
      }
      return e;
    }
  }
}
