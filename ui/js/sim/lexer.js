// The lexer: turns Arduino C++ source text into tokens.
//
// Each token: { t, v, line, col, endLine, endCol, pos, end, lline, bol, file }
//   t = "id" | "num" | "str" | "chr" | "op" | "bad" | "eof"
//   lline = the logical line (backslash-newline joins lines), for directives
//   bol = the first token on its logical line
// Problems that gcc reports (stray characters, unterminated strings) become
// "bad" tokens with a message, so the preprocessor only reports them when
// they are in code that is compiled.

const OPS = [
  ">>=", "<<=", "...", "->*",
  "::", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "##", ".*",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "&", "|", "^", "~", "?", ":",
  ";", ",", ".", "(", ")", "[", "]", "{", "}", "#",
];

const ESCAPES = { n: 10, t: 9, r: 13, "0": 0, "\\": 92, "'": 39, '"': 34, "?": 63, a: 7, b: 8, f: 12, v: 11, e: 27 };

const isIdStart = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
const isIdChar = (c) => isIdStart(c) || (c >= "0" && c <= "9");
const isDigit = (c) => c >= "0" && c <= "9";

/** UTF-8 bytes of one character code point. */
export function utf8(cp) {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

/** gcc's way of naming a stray byte: '\342' for bytes over 127. */
function strayName(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 32 || cp === 127) return "\\" + cp.toString(8);
  if (cp < 128) return ch;
  return "\\" + utf8(cp)[0].toString(8);
}

/**
 * Splits source text into tokens.
 * @param {string} src
 * @param {string} [file] a header name for library headers (tokens get sys: true)
 * @returns {object[]} tokens, ending with an "eof" token
 */
export function lex(src, file = "") {
  const toks = [];
  let i = 0, line = 1, col = 1, lline = 1, bol = true;
  const n = src.length;
  const sys = !!file;

  const adv = (k = 1) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
      i++;
    }
  };

  const push = (t, v, sl, sc, spos, extra) => {
    const tok = { t, v, line: sl, col: sc, endLine: line, endCol: col - 1, pos: spos, end: i, lline, bol };
    if (sys) { tok.sys = true; tok.file = file; }
    if (extra) Object.assign(tok, extra);
    toks.push(tok);
    bol = false;
    return tok;
  };

  while (i < n) {
    const c = src[i];
    // Line continuation: joins the logical line.
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) {
      adv(src[i + 1] === "\r" ? 3 : 2);
      continue;
    }
    if (c === "\n") { adv(); lline++; bol = true; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { adv(); continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") {
        if (src[i] === "\\" && src[i + 1] === "\n") adv(); // continued comment
        adv();
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const sl = line, sc = col, sp = i;
      adv(2);
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") lline++;
        adv();
      }
      if (i >= n) { push("bad", "", sl, sc, sp, { msg: "unterminated comment" }); break; }
      adv(2);
      continue;
    }
    const sl = line, sc = col, sp = i;
    if (isIdStart(c)) {
      // Raw string literal R"( ... )"
      if ((c === "R" || ((c === "u" || c === "L" || c === "U") && src[i + 1] === "R")) && src[i + (c === "R" ? 1 : 2)] === '"') {
        const q = i + (c === "R" ? 1 : 2);
        const open = src.indexOf("(", q);
        const delim = src.slice(q + 1, open);
        const close = src.indexOf(")" + delim + '"', open);
        if (open < 0 || close < 0) { adv(); push("bad", "", sl, sc, sp, { msg: 'missing terminating " character' }); continue; }
        const text = src.slice(open + 1, close);
        const startLine = line;
        adv(close + delim.length + 2 - i);
        lline += line - startLine;
        push("str", textBytes(text), sl, sc, sp);
        continue;
      }
      let j = i;
      while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      // String / char prefixes we don't support (u8"", L"") are read as plain.
      if ((word === "u8" || word === "L" || word === "u" || word === "U") && (src[j] === '"' || src[j] === "'")) {
        adv(j - i);
        continue;
      }
      adv(j - i);
      push("id", word, sl, sc, sp);
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(src[i + 1]))) {
      const m = /^(0[xX][0-9a-fA-F']+|0[bB][01']+|(?:[0-9][0-9']*\.?[0-9']*|\.[0-9][0-9']*)(?:[eE][+-]?[0-9]+)?)([a-zA-Z_][a-zA-Z0-9_]*)?/.exec(src.slice(i, i + 80));
      const body = m[1], suffix = (m[2] || "");
      adv(m[0].length);
      const num = parseNumber(body, suffix);
      if (num.bad) push("bad", "", sl, sc, sp, { msg: num.bad });
      else push("num", num.v, sl, sc, sp, { num, raw: m[0] });
      continue;
    }
    if (c === '"') {
      const r = readQuoted('"');
      if (r.bad) { skipLine(); push("bad", "", sl, sc, sp, { msg: 'missing terminating " character' }); continue; }
      push("str", r.bytes, sl, sc, sp);
      continue;
    }
    if (c === "'") {
      const r = readQuoted("'");
      if (r.bad) { skipLine(); push("bad", "", sl, sc, sp, { msg: "missing terminating ' character" }); continue; }
      if (r.bytes.length === 0) { push("bad", "", sl, sc, sp, { msg: "empty character constant" }); continue; }
      // Multi-character constants are ints (gcc warns); one byte is a char.
      let v = 0;
      for (const b of r.bytes) v = ((v << 8) | b) >>> 0;
      if (r.bytes.length === 1) v = r.bytes[0] > 127 ? r.bytes[0] - 256 : r.bytes[0];
      else v = v | 0;
      push("chr", v, sl, sc, sp, { multi: r.bytes.length > 1 });
      continue;
    }
    let op = null;
    for (const o of OPS) {
      if (src.startsWith(o, i)) { op = o; break; }
    }
    if (op) {
      adv(op.length);
      push("op", op, sl, sc, sp);
      continue;
    }
    // Anything else is a stray character (smart quotes, @, `, ...).
    const ch = String.fromCodePoint(src.codePointAt(i));
    adv(ch.length);
    push("bad", "", sl, sc, sp, { msg: `stray '${strayName(ch)}' in program` });
  }
  const eof = { t: "eof", v: "", line, col, endLine: line, endCol: col, pos: n, end: n, lline: lline + 1, bol: true };
  if (sys) { eof.sys = true; eof.file = file; }
  toks.push(eof);
  return toks;

  function skipLine() {
    while (i < n && src[i] !== "\n") adv();
  }

  // Reads a "..." or '...' literal starting at i. Returns { bytes } or { bad }.
  function readQuoted(q) {
    const bytes = [];
    let j = i + 1;
    while (j < n && src[j] !== q) {
      const ch = src[j];
      if (ch === "\n") return { bad: true };
      if (ch === "\\") {
        const e = src[j + 1];
        if (e === "\n") { j += 2; continue; }
        if (e === "x" || e === "X") {
          let k = j + 2, v = 0, digits = 0;
          while (k < n && /[0-9a-fA-F]/.test(src[k])) { v = v * 16 + parseInt(src[k], 16); k++; digits++; }
          bytes.push(v & 255);
          j = digits ? k : j + 2;
          continue;
        }
        if (e >= "0" && e <= "7") {
          let k = j + 1, v = 0, digits = 0;
          while (k < n && digits < 3 && src[k] >= "0" && src[k] <= "7") { v = v * 8 + (src.charCodeAt(k) - 48); k++; digits++; }
          bytes.push(v & 255);
          j = k;
          continue;
        }
        if (e === "u" || e === "U") {
          const len = e === "u" ? 4 : 8;
          const hex = src.slice(j + 2, j + 2 + len);
          bytes.push(...utf8(parseInt(hex, 16) || 0));
          j += 2 + len;
          continue;
        }
        bytes.push(e in ESCAPES ? ESCAPES[e] : e.charCodeAt(0));
        j += 2;
        continue;
      }
      const cp = src.codePointAt(j);
      bytes.push(...utf8(cp));
      j += cp > 0xffff ? 2 : 1;
    }
    if (j >= n) return { bad: true };
    adv(j + 1 - i);
    return { bytes };
  }
}

function textBytes(text) {
  const out = [];
  for (const ch of text) out.push(...utf8(ch.codePointAt(0)));
  return out;
}

/** Parses a C++ number literal: { v, float, base, unsigned, long, f } or { bad }. */
export function parseNumber(body, suffix) {
  const s = body.replace(/'/g, "");
  const suf = suffix.toLowerCase();
  if (/^0[xX]/.test(s) || /^0[bB]/.test(s) || !/[.eE]/.test(s)) {
    if (!/^(u|l|ul|lu|ll|ull|llu|)$/.test(suf)) return { bad: `invalid suffix "${suffix}" on integer constant` };
    let base = 10, digits = s;
    if (/^0[xX]/.test(s)) { base = 16; digits = s.slice(2); }
    else if (/^0[bB]/.test(s)) { base = 2; digits = s.slice(2); }
    else if (s.length > 1 && s[0] === "0") {
      base = 8; digits = s.slice(1);
      if (/[89]/.test(digits)) return { bad: `invalid digit "${digits.match(/[89]/)[0]}" in octal constant` };
    }
    const v = digits === "" ? 0 : parseInt(digits, base);
    return { v, float: false, base, unsigned: suf.includes("u"), long: suf.includes("ll") ? 2 : suf.includes("l") ? 1 : 0 };
  }
  if (!/^(f|l|)$/.test(suf)) return { bad: `invalid suffix "${suffix}" on floating constant` };
  return { v: parseFloat(s), float: true, f: suf === "f" };
}

/** How gcc names a token in "expected X before Y" messages. */
export function describeToken(tok) {
  switch (tok.t) {
    case "eof": return null;
    case "id": return `'${tok.v}'`;
    case "num": return "numeric constant";
    case "str": return "string constant";
    case "chr": return "character constant";
    case "op": return `'${tok.v}' token`;
    default: return "token";
  }
}
