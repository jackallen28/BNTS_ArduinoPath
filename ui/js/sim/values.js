// Run-time values shared by the code generator, the runtime and the
// libraries: pointers, C strings, number formatting like Arduino's Print.
//
// Text inside the simulator is a "byte string": a JS string whose characters
// are bytes 0..255 (UTF-8 encoded), so String.length() matches the board.

/** A pointer: an array (or frame) and an index into it. */
export class Ptr {
  constructor(a, i) {
    this.a = a;
    this.i = i;
  }
}

/** A problem while the sketch runs (shown to the student). */
export class SimError extends Error {
  constructor(message, kind = "runtime") {
    super(message);
    this.kind = kind;
    this.sim = true;
  }
}

/** Reads a C string (up to the 0 byte) as a byte string. */
export function cstr(p) {
  if (p == null) return "";
  if (typeof p === "string") return p;
  const a = p.a, n = a.length;
  let s = "";
  for (let i = p.i; i < n; i++) {
    const b = a[i] & 255;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/** A new char array holding a byte string and its 0 byte. */
export function charArray(s, size = s.length + 1) {
  const a = new Int8Array(Math.max(size, s.length + 1));
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/** Writes a byte string into a char buffer (Ptr) with its 0 byte. */
export function writeCStr(p, s, max = Infinity) {
  if (p == null) throw new SimError("Your code used a text buffer that points to nothing (NULL).");
  const a = p.a;
  const n = Math.min(s.length, max - 1);
  if (p.i + n >= a.length) {
    throw new SimError(`The text "${toText(s).slice(0, 30)}" is too long for its char array (it holds ${a.length - p.i - 1} letters).`);
  }
  for (let k = 0; k < n; k++) a[p.i + k] = s.charCodeAt(k);
  if (max > 0) a[p.i + n] = 0;
  return p;
}

const enc = new TextEncoder();
/** JS text → byte string (UTF-8). */
export function fromText(text) {
  const b = enc.encode(String(text));
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** Byte string → JS text (UTF-8 decoded, bad bytes become �). */
export function toText(s) {
  if (!/[\x80-\xff]/.test(s)) return s;
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return new TextDecoder().decode(b);
}

const DIGITS = "0123456789ABCDEF";

/** Arduino Print::printNumber: an unsigned number in a base (uppercase). */
function printNumber(n, base) {
  if (base < 2) base = 10;
  if (n === 0) return "0";
  let s = "";
  while (n > 0) {
    s = DIGITS[n % base] + s;
    n = Math.floor(n / base);
  }
  return s;
}

/**
 * Print::print for an integer of type t, in a base (DEC, HEX, OCT, BIN).
 * Negative numbers in other bases print as 32-bit unsigned, like the board.
 */
export function printInt(v, base, t) {
  if (base === 0) return String.fromCharCode(v & 255);
  if (base === 10 || base == null) return String(v);
  if (v < 0) v = t && t.bits > 32 ? Number(BigInt.asUintN(64, BigInt(v))) : v >>> 0;
  return printNumber(v, base);
}

/** Print::printFloat: Arduino's own rounding, 2 decimals by default. */
export function printFloat(number, digits = 2, f32 = false) {
  const R = f32 ? Math.fround : (x) => x;
  if (number !== number) return "nan";
  if (number === Infinity || number === -Infinity) return "inf";
  if (number > 4294967040.0 || number < -4294967040.0) return "ovf";
  let s = "";
  if (number < 0) { s = "-"; number = -number; }
  let rounding = 0.5;
  for (let i = 0; i < digits; i++) rounding = R(rounding / 10);
  number = R(number + rounding);
  const intPart = Math.floor(number);
  let rem = R(number - intPart);
  s += String(intPart);
  if (digits > 0) s += ".";
  while (digits-- > 0) {
    rem = R(rem * 10);
    const d = Math.floor(rem);
    s += d;
    rem = R(rem - d);
  }
  return s;
}

/** String(n, base) uses itoa: lowercase, and a minus sign only in base 10. */
export function itoa(v, base, bits = 32) {
  if (base === 10 || base == null) return String(v);
  if (v < 0) v = bits >= 64 ? Number(BigInt.asUintN(64, BigInt(v))) : bits === 16 ? v & 0xffff : bits === 8 ? v & 0xff : v >>> 0;
  return v.toString(base < 2 || base > 36 ? 10 : base);
}

/** dtostrf(value, width, prec): right-aligned in width (left if width < 0). */
export function dtostrf(v, width, prec) {
  let s;
  if (v !== v) s = "nan";
  else if (!Number.isFinite(v)) s = v < 0 ? "-inf" : "inf";
  else s = roundFixed(v, prec);
  const w = Math.abs(width);
  if (s.length < w) s = width < 0 ? s.padEnd(w) : s.padStart(w);
  return s;
}

function roundFixed(v, prec) {
  prec = Math.max(0, Math.min(prec, 20));
  const s = v.toFixed(prec);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

/** The value of a byte string's leading integer, like atol. */
export function atol(s) {
  const m = /^[\s]*([+-]?\d+)/.exec(s);
  if (!m) return 0;
  return Number(BigInt.asIntN(32, BigInt(m[1])));
}

/** The value of a byte string's leading number, like atof. */
export function atof(s) {
  const m = /^\s*([+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf(?:inity)?|nan))/i.exec(s);
  if (!m) return 0;
  const t = m[1].toLowerCase();
  if (t.endsWith("nan")) return NaN;
  if (t.includes("inf")) return t.startsWith("-") ? -Infinity : Infinity;
  return parseFloat(m[1]);
}

/** ASCII-only upper / lower case (Arduino's String changes only a-z / A-Z). */
export const upper = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 32));
export const lower = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/**
 * printf-style formatting (sprintf, snprintf, Serial.printf).
 * args: [{ v, t }] with the value and its C type. avr: %f prints "?" like avr-libc.
 */
export function format(fmt, args, { avr = false } = {}) {
  let out = "", ai = 0;
  const next = () => args[ai++] ?? { v: 0, t: { k: "int", bits: 16, signed: true } };
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== "%") { out += c; continue; }
    const m = /^%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|j|t|L)?([diouxXcsfFeEgGp%])/.exec(fmt.slice(i));
    if (!m) { out += c; continue; }
    i += m[0].length - 1;
    let [, flags, width, prec, len, conv] = m;
    if (conv === "%") { out += "%"; continue; }
    if (width === "*") width = next().v;
    if (prec === "*") prec = next().v;
    width = width == null ? 0 : Number(width);
    prec = prec == null ? null : Number(prec);
    const left = flags.includes("-") || width < 0;
    width = Math.abs(width);
    const a = next();
    let v = a.v, s, sign = "";
    const intBits = len === "ll" ? 64 : len === "l" || len === "z" ? 32 : avr ? 16 : 32;
    switch (conv) {
      case "d": case "i": {
        v = typeof v === "number" ? v : Number(v) || 0;
        v = Math.trunc(v);
        if (intBits === 16) v = (v << 16) >> 16;
        else if (intBits === 32) v |= 0;
        if (v < 0) { sign = "-"; v = -v; }
        else if (flags.includes("+")) sign = "+";
        else if (flags.includes(" ")) sign = " ";
        s = String(v);
        if (prec != null) s = s.padStart(prec, "0");
        break;
      }
      case "u": case "x": case "X": case "o": {
        v = Math.trunc(typeof v === "number" ? v : Number(v) || 0);
        if (intBits === 16) v &= 0xffff;
        else if (intBits === 32) v >>>= 0;
        s = v.toString(conv === "o" ? 8 : conv === "u" ? 10 : 16);
        if (conv === "X") s = s.toUpperCase();
        if (prec != null) s = s.padStart(prec, "0");
        if (flags.includes("#") && v !== 0 && conv !== "u") s = (conv === "o" ? "0" : conv === "x" ? "0x" : "0X") + s;
        break;
      }
      case "c": s = String.fromCharCode(v & 255); break;
      case "s": {
        s = typeof v === "string" ? v : cstr(v);
        if (prec != null) s = s.slice(0, prec);
        break;
      }
      case "p": s = "0x" + (Math.random() * 0xffff | 0).toString(16); break;
      default: { // f F e E g G
        if (avr) { s = "?"; break; }
        v = Number(v);
        const p = prec == null ? 6 : prec;
        if (v !== v) s = "nan";
        else if (!Number.isFinite(v)) s = "inf";
        else if (conv === "f" || conv === "F") s = Math.abs(v).toFixed(p);
        else if (conv === "e" || conv === "E") s = Math.abs(v).toExponential(p).replace(/e([+-])(\d)$/, "e$10$2");
        else s = String(Number(Math.abs(v).toPrecision(p || 1)));
        if (conv === "E" || conv === "G") s = s.toUpperCase();
        if (v < 0 || Object.is(v, -0)) sign = "-";
        else if (flags.includes("+")) sign = "+";
        else if (flags.includes(" ")) sign = " ";
      }
    }
    let body = sign + s;
    if (body.length < width) {
      if (left) body = body.padEnd(width);
      else if (flags.includes("0") && conv !== "s" && conv !== "c" && !(prec != null && "diouxX".includes(conv))) body = sign + s.padStart(width - sign.length, "0");
      else body = body.padStart(width);
    }
    out += body;
  }
  return out;
}
