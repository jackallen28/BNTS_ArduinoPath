// C++ types for one board: sizes, conversions and gcc-style names.
//
// A type is a plain object:
//   { k: "void" } | { k: "bool" } | { k: "int", bits, signed, rank, char? }
//   { k: "float", bits } | { k: "String" } | { k: "ptr", to, cnst }
//   { k: "arr", of, n } | { k: "struct", name, fields } | { k: "enum", name }
//   { k: "class", name, cls } | { k: "fn", ret, params } | { k: "null" }
// Integer values are JS numbers kept inside their type's range; 64-bit
// integers are approximated with JS numbers.

const intType = (bits, signed, name, rank, extra) => ({ k: "int", bits, signed, name, rank, ...extra });

/** Builds the basic types for a board (int is 16 bits on AVR, 32 on ESP). */
export function makeTypes(board) {
  const avr = (board.int_bits ?? 16) === 16;
  const intBits = avr ? 16 : 32;
  const T = {
    avr,
    intBits,
    ptrSize: avr ? 2 : 4,
    void: { k: "void", name: "void" },
    bool: { k: "bool", name: "bool", bits: 8 },
    char: intType(8, true, "char", 1, { char: true }),
    schar: intType(8, true, "signed char", 1),
    uchar: intType(8, false, "unsigned char", 1),
    short: intType(16, true, "short int", 2),
    ushort: intType(16, false, "short unsigned int", 2),
    int: intType(intBits, true, "int", 3),
    uint: intType(intBits, false, "unsigned int", 3),
    long: intType(32, true, "long int", 4),
    ulong: intType(32, false, "long unsigned int", 4),
    llong: intType(64, true, "long long int", 5),
    ullong: intType(64, false, "long long unsigned int", 5),
    float: { k: "float", bits: 32, name: "float" },
    double: { k: "float", bits: avr ? 32 : 64, name: "double", dbl: true },
    String: { k: "String", name: "String" },
    null: { k: "null", name: "std::nullptr_t" },
    callback: { k: "callback", name: "callback" },
  };
  T.cstr = ptr(constOf(T.char));
  return T;
}

export const ptr = (to, cnst = false) => ({ k: "ptr", to, cnst });
export const arr = (of, n) => ({ k: "arr", of, n });
export const constOf = (t) => (t.cnst ? t : { ...t, cnst: true });
export const unconst = (t) => {
  if (!t.cnst) return t;
  const c = { ...t };
  delete c.cnst;
  return c;
};

export const isInt = (t) => t.k === "int" || t.k === "bool" || t.k === "enum";
export const isArith = (t) => isInt(t) || t.k === "float";
export const isPtrLike = (t) => t.k === "ptr" || t.k === "arr" || t.k === "null";
export const isScalar = (t) => isArith(t) || t.k === "ptr" || t.k === "null";

/** Same type, ignoring const at the top level. */
export function same(a, b) {
  if (a === b) return true;
  if (!a || !b || a.k !== b.k) return false;
  switch (a.k) {
    case "int": return a.bits === b.bits && a.signed === b.signed && !!a.char === !!b.char && a.rank === b.rank;
    case "float": return a.bits === b.bits && !!a.dbl === !!b.dbl;
    case "ptr": return same(a.to, b.to);
    case "arr": return same(a.of, b.of) && (a.n == null || b.n == null || a.n === b.n);
    case "struct": case "enum": case "class": return a.name === b.name;
    default: return true;
  }
}

/** gcc's name for a type: "int", "const char*", "long unsigned int", "char [6]". */
export function typeName(t) {
  if (!t) return "?";
  const c = t.cnst ? "const " : "";
  switch (t.k) {
    case "ptr": {
      if (t.to.k === "fn") return `${typeName(t.to.ret)} (*)(${t.to.params.map(typeName).join(", ")})`;
      return `${typeName(t.to)}*${t.cnst ? " const" : ""}`;
    }
    case "arr": {
      let dims = "", x = t;
      while (x.k === "arr") { dims += `[${x.n ?? ""}]`; x = x.of; }
      return `${typeName(x)} ${dims}`;
    }
    case "struct": return c + (t.name || "<anonymous struct>");
    case "enum": return c + t.name;
    case "class": return c + t.name;
    case "fn": return `${typeName(t.ret)}(${t.params.map(typeName).join(", ")})`;
    default: return c + (t.alias || t.name);
  }
}

/** The C++ "class X" form for member errors: 'class String', 'class HardwareSerial'. */
export function className(t) {
  if (t.k === "String") return "class String";
  if (t.k === "struct") return `struct ${t.name}`;
  if (t.k === "class") return `class ${t.name}`;
  return typeName(t);
}

/** sizeof(t) in bytes. */
export function sizeOf(t, T) {
  switch (t.k) {
    case "bool": return 1;
    case "int": return t.bits / 8;
    case "enum": return T.intBits / 8;
    case "float": return t.bits / 8;
    case "ptr": case "null": return T.ptrSize;
    case "String": return T.avr ? 6 : 12;
    case "arr": return (t.n ?? 0) * sizeOf(t.of, T);
    case "struct": {
      let size = 0, maxAlign = 1;
      for (const f of t.fields) {
        const s = sizeOf(f.type, T);
        const a = T.avr ? 1 : Math.min(4, alignOf(f.type, T));
        maxAlign = Math.max(maxAlign, a);
        size = Math.ceil(size / a) * a + s;
      }
      return Math.max(1, Math.ceil(size / maxAlign) * maxAlign);
    }
    case "class": return t.cls?.size ?? (T.avr ? 4 : 8);
    default: return 1;
  }
}

function alignOf(t, T) {
  if (t.k === "arr") return alignOf(t.of, T);
  if (t.k === "struct") return Math.max(1, ...t.fields.map((f) => alignOf(f.type, T)));
  return Math.min(8, sizeOf(t, T));
}

/** Integer promotion (char, short, bool, enum → int or unsigned int). */
export function promote(t, T) {
  if (t.k === "bool" || t.k === "enum") return T.int;
  if (t.k !== "int") return t;
  if (t.rank >= 3) return t;
  const fits = t.signed ? t.bits <= T.intBits : t.bits < T.intBits;
  return fits ? T.int : T.uint;
}

/** The usual arithmetic conversions: the common type of a binary operation. */
export function common(a, b, T) {
  if (a.k === "float" || b.k === "float") {
    if (a.k !== "float") return b;
    if (b.k !== "float") return a;
    if (a.bits !== b.bits) return a.bits > b.bits ? a : b;
    return a.dbl ? a : b;
  }
  a = promote(a, T);
  b = promote(b, T);
  if (a.signed === b.signed) return a.rank >= b.rank ? a : b;
  const u = a.signed ? b : a, s = a.signed ? a : b;
  if (u.rank >= s.rank) return u;
  if (s.bits > u.bits) return s;
  return unsignedOf(s, T);
}

export function unsignedOf(t, T) {
  if (t.rank === 3) return T.uint;
  if (t.rank === 4) return T.ulong;
  if (t.rank === 5) return T.ullong;
  if (t.rank === 2) return T.ushort;
  return T.uchar;
}

/** A function that keeps a number inside an arithmetic type's range. */
export function wrapper(t) {
  if (t.k === "bool") return toBool01;
  if (t.k === "float") return t.bits === 32 ? Math.fround : num64;
  if (t.k === "enum") return wrap32;
  if (t.k !== "int") return ident;
  switch (t.bits) {
    case 8: return t.signed ? wrapS8 : wrapU8;
    case 16: return t.signed ? wrapS16 : wrapU16;
    case 32: return t.signed ? wrap32 : wrapU32;
    default: return t.signed ? wrapS64 : wrapU64;
  }
}

const ident = (v) => v;
const num64 = (v) => +v;
export const toBool01 = (v) => (v !== 0 && v === v) || v !== v ? 1 : 0; // NaN is true in C
export const wrapS8 = (v) => (v << 24) >> 24;
export const wrapU8 = (v) => v & 255;
export const wrapS16 = (v) => (v << 16) >> 16;
export const wrapU16 = (v) => v & 65535;
export const wrap32 = (v) => v | 0;
export const wrapU32 = (v) => v >>> 0;
export function wrapS64(v) {
  v = Math.trunc(v);
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) < 2 ** 53) return v;
  return Number(BigInt.asIntN(64, BigInt(v)));
}
export function wrapU64(v) {
  v = Math.trunc(v);
  if (!Number.isFinite(v)) return 0;
  if (v >= 0 && v < 2 ** 53) return v;
  return Number(BigInt.asUintN(64, BigInt(v)));
}

/** The range of an integer type. */
export function intRange(t) {
  if (t.k === "bool") return [0, 1];
  if (t.signed) return [-(2 ** (t.bits - 1)), 2 ** (t.bits - 1) - 1];
  return [0, 2 ** t.bits - 1];
}

/** Does every value of integer type a fit in integer type b? */
export function fitsIn(a, b) {
  const [alo, ahi] = intRange(a), [blo, bhi] = intRange(b);
  return alo >= blo && ahi <= bhi;
}

/** The zero value of a type (for globals, statics and new array cells). */
export function zeroOf(t) {
  switch (t.k) {
    case "String": return "";
    case "ptr": case "null": case "callback": return null;
    default: return 0;
  }
}

/** Is a value of type `from` implicitly convertible to `to`? → "exact" | "promote" | "convert" | null */
export function convertRank(from, to) {
  if (same(from, to)) return "exact";
  if (to.k === "callback") return from.k === "fn" || from.k === "callback" ? "exact" : null;
  if (isArith(from) && isArith(to)) {
    if (to.k === "enum") return null;
    if (from.k === "float" && to.k === "float") return to.bits >= from.bits ? "promote" : "convert";
    if (isInt(from) && isInt(to) && to.k === "int" && to.rank === 3 && (from.k === "bool" || from.k === "enum" || from.rank < 3)) return "promote";
    return "convert";
  }
  if (to.k === "String") {
    if (from.k === "String") return "exact";
    if ((from.k === "ptr" || from.k === "arr") && charLike(from.k === "ptr" ? from.to : from.of)) return "convert";
    return null;
  }
  if (to.k === "ptr") {
    if (from.k === "null") return "convert";
    if (from.k === "arr" && (same(from.of, to.to) || to.to.k === "void" || looseChar(from.of, to.to))) return "exact";
    if (from.k === "ptr" && (same(from.to, to.to) || to.to.k === "void" || looseChar(from.to, to.to))) {
      if (from.to.cnst && !to.to.cnst) return null;
      return "exact";
    }
    if (to.to.k === "class" && from.k === "class" && from.name === to.to.name) return "exact";
    return null;
  }
  if (to.k === "bool" && (from.k === "ptr" || from.k === "null")) return "convert";
  if (to.k === "struct" && from.k === "struct") return from.name === to.name ? "exact" : null;
  if (to.k === "class" && from.k === "class") return from.name === to.name ? "exact" : null;
  return null;
}

const charLike = (t) => t.k === "int" && t.bits === 8;
const looseChar = (a, b) => charLike(a) && charLike(b);
