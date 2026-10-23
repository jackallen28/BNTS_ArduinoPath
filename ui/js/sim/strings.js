// Arduino's String class. A String value is a byte string (see values.js),
// which gives it value semantics for free. Methods that change the String
// return [newValue, result].
//
// arity: [min, max] arguments; args: what each argument may be
//   "num" a number, "text" a String or C string, "textchar" text or a char,
//   "any" anything printable (concat), "buf" a char array.

import { upper, lower, atol, atof } from "./values.js";

const strcmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const STRING_METHODS = {
  length: { arity: [0, 0], args: [], ret: "uint", impl: (s) => s.length },
  charAt: { arity: [1, 1], args: ["num"], ret: "char", impl: (s, i) => (i < s.length ? signed8(s.charCodeAt(i)) : 0) },
  setCharAt: { arity: [2, 2], args: ["num", "num"], ret: "void", mut: true, impl: (s, i, c) => [i < s.length ? s.slice(0, i) + String.fromCharCode(c & 255) + s.slice(i + 1) : s] },
  substring: {
    arity: [1, 2], args: ["num", "num"], ret: "String",
    impl: (s, from, to = s.length) => {
      if (from > to) [from, to] = [to, from];
      if (from >= s.length) return "";
      return s.slice(from, Math.min(to, s.length));
    },
  },
  indexOf: { arity: [1, 2], args: ["textchar", "num"], ret: "int", impl: (s, f, from = 0) => (from >= s.length ? -1 : s.indexOf(f, from)) },
  lastIndexOf: {
    arity: [1, 2], args: ["textchar", "num"], ret: "int",
    impl: (s, f, from = s.length - 1) => (from < 0 ? -1 : s.lastIndexOf(f, from)),
  },
  toInt: { arity: [0, 0], args: [], ret: "long", impl: (s) => atol(s) },
  toFloat: { arity: [0, 0], args: [], ret: "float", impl: (s) => Math.fround(atof(s)) },
  toDouble: { arity: [0, 0], args: [], ret: "double", impl: (s) => atof(s) },
  toUpperCase: { arity: [0, 0], args: [], ret: "void", mut: true, impl: (s) => [upper(s)] },
  toLowerCase: { arity: [0, 0], args: [], ret: "void", mut: true, impl: (s) => [lower(s)] },
  trim: { arity: [0, 0], args: [], ret: "void", mut: true, impl: (s) => [s.replace(/^[\s]+|[\s]+$/g, "")] },
  equals: { arity: [1, 1], args: ["text"], ret: "bool", impl: (s, t) => (s === t ? 1 : 0) },
  equalsIgnoreCase: { arity: [1, 1], args: ["text"], ret: "bool", impl: (s, t) => (lower(s) === lower(t) ? 1 : 0) },
  compareTo: { arity: [1, 1], args: ["text"], ret: "int", impl: (s, t) => strcmp(s, t) },
  startsWith: { arity: [1, 2], args: ["text", "num"], ret: "bool", impl: (s, t, off = 0) => (s.startsWith(t, off) ? 1 : 0) },
  endsWith: { arity: [1, 1], args: ["text"], ret: "bool", impl: (s, t) => (s.endsWith(t) ? 1 : 0) },
  replace: { arity: [2, 2], args: ["textchar", "textchar"], ret: "void", mut: true, impl: (s, f, r) => [f === "" ? s : s.split(f).join(r)] },
  remove: {
    arity: [1, 2], args: ["num", "num"], ret: "void", mut: true,
    impl: (s, i, n = s.length) => [i >= s.length ? s : s.slice(0, i) + s.slice(Math.min(s.length, i + n))],
  },
  concat: { arity: [1, 1], args: ["any"], ret: "bool", mut: true, impl: (s, t) => [s + t, 1] },
  c_str: { arity: [0, 0], args: [], ret: "cstr", impl: null },
  reserve: { arity: [1, 1], args: ["num"], ret: "bool", impl: () => 1 },
  isEmpty: { arity: [0, 0], args: [], ret: "bool", impl: (s) => (s.length === 0 ? 1 : 0) },
  getBytes: { arity: [2, 3], args: ["buf", "num", "num"], ret: "void", impl: null },
  toCharArray: { arity: [2, 3], args: ["buf", "num", "num"], ret: "void", impl: null },
};

function signed8(b) {
  return b > 127 ? b - 256 : b;
}

export { strcmp };
