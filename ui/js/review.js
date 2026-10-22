// The code review for Advanced students, after each step: magic numbers,
// repeated code, delay() blocking a loop that reads inputs, unclear names,
// and global state. Suggestions, never errors. Pure (tested in Node).

/** The code with comments and the insides of strings blanked out (same lines and columns). */
export function stripCode(code) {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) { out += code[i] === "\n" ? "\n" : " "; i++; }
      if (i < code.length) { out += "  "; i += 2; }
    } else if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < code.length && code[i] !== c && code[i] !== "\n") {
        if (code[i] === "\\" && i + 1 < code.length) { out += "  "; i += 2; continue; }
        out += " ";
        i++;
      }
      if (i < code.length && code[i] === c) { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const lineOf = (code, index) => code.slice(0, index).split("\n").length;

const PIN_CALLS = /\b(pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|noTone|attach)\s*\(\s*(\d+)\b/g;

/** The body of a function (between its braces), and where it starts. */
function functionBody(code, name) {
  const m = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*\\)\\s*\\{`).exec(code);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return { text: code.slice(m.index + m[0].length, i), start: m.index + m[0].length };
  }
  return null;
}

/**
 * Suggestions for tidier code.
 * @returns {{ id: string, title: string, text: string, line?: number }[]}
 */
export function review(code) {
  const src = stripCode(code);
  const found = [];

  // Magic numbers: pins written as numbers instead of names.
  const pins = [...src.matchAll(PIN_CALLS)];
  if (pins.length) {
    found.push({
      id: "magic-pin",
      title: "Name your pins",
      text: `Line ${lineOf(src, pins[0].index)} uses pin ${pins[0][2]} as a plain number. Give it a name at the top, like #define LED_PIN ${pins[0][2]}, so your code says what the pin is for and you only change it in one place.`,
      line: lineOf(src, pins[0].index),
    });
  }

  // The same delay/number many times.
  const delays = [...src.matchAll(/\bdelay\s*\(\s*(\d{3,})\s*\)/g)];
  const counts = {};
  for (const d of delays) counts[d[1]] = (counts[d[1]] || 0) + 1;
  const repeated = Object.entries(counts).find(([, n]) => n >= 3);
  if (repeated) {
    found.push({
      id: "magic-number",
      title: "Give that number a name",
      text: `delay(${repeated[0]}) appears ${repeated[1]} times. A constant like const int WAIT_MS = ${repeated[0]}; makes it easy to change them all at once.`,
    });
  }

  // Repeated code: the same line three or more times.
  const lines = src.split("\n").map((l) => l.trim());
  const seen = new Map();
  lines.forEach((l, i) => {
    if (l.length < 12 || /^[{}]|^#|^(int|long|float|bool|const|byte|String|unsigned)\b/.test(l)) return;
    if (!seen.has(l)) seen.set(l, []);
    seen.get(l).push(i + 1);
  });
  for (const [l, at] of seen) {
    if (at.length >= 3) {
      found.push({
        id: "repeated-code",
        title: "Repeated code",
        text: `"${code.split("\n")[at[0] - 1].trim()}" is written ${at.length} times. Could a for loop, an array or your own function do it once?`,
        line: at[0],
      });
      break;
    }
  }

  // delay() blocking a loop that reads inputs.
  const loop = functionBody(src, "loop");
  if (loop && /\b(digitalRead|analogRead|Serial\.available)\s*\(/.test(loop.text)) {
    const long = [...loop.text.matchAll(/\bdelay\s*\(\s*(\d+)\s*\)/g)].find((d) => Number(d[1]) >= 500);
    if (long) {
      found.push({
        id: "blocking-delay",
        title: "delay() makes the board stop listening",
        text: `During delay(${long[1]}) the board can't notice a button or sensor. Try timing with millis() instead, so loop() keeps checking the inputs.`,
        line: lineOf(src, loop.start + long.index),
      });
    }
  }

  // Unclear names: one-letter variables outside for loops.
  const decl = /\b(?:int|long|float|double|bool|boolean|byte|char|String|unsigned\s+long|unsigned\s+int)\s+([A-Za-z_]\w*)\s*(?:=|;|\[)/g;
  for (const m of src.matchAll(decl)) {
    const name = m[1];
    const before = src.slice(Math.max(0, m.index - 6), m.index);
    if (name.length === 1 && !/for\s*\(\s*$/.test(before)) {
      found.push({
        id: "short-name",
        title: "A clearer name",
        text: `The variable ${name} (line ${lineOf(src, m.index)}) could have a name that says what it holds, like buttonState or brightness. (i and j are fine in for loops.)`,
        line: lineOf(src, m.index),
      });
      break;
    }
  }

  // Lots of global variables.
  let depth = 0;
  const globals = [];
  for (const [i, raw] of src.split("\n").entries()) {
    const l = raw.trim();
    if (depth === 0 && /^(?!const\b|#|static\s+const\b)(?:static\s+)?(?:unsigned\s+)?(int|long|float|double|bool|boolean|byte|char|String)\s+\w+[^(]*;$/.test(l)) globals.push(i + 1);
    for (const ch of raw) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
  }
  if (globals.length > 6) {
    found.push({
      id: "global-state",
      title: "Lots of global variables",
      text: `Your sketch has ${globals.length} variables outside any function. Ones that are only used inside one function can be made inside it, which makes the code easier to follow.`,
      line: globals[0],
    });
  }
  return found;
}
