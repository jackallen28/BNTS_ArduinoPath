// The Coach's errors database lookups: turns a compiler message (from the
// real compiler or the simulator, worded the same) or an upload failure
// into a plain-English explanation from content/errors.json. Mirrors
// content.MatchError and arduino.CoachText in the Go code.

const compiled = new WeakMap();

function regex(entry) {
  let re = compiled.get(entry);
  if (re === undefined) {
    try {
      re = new RegExp(entry.pattern, "i");
    } catch {
      re = null;
    }
    compiled.set(entry, re);
  }
  return re;
}

/**
 * The text to match for a compile: the first error in the sketch (or
 * anywhere) and the notes right after it.
 * @param {{file: string, line?: number, severity: string, message: string}[]} diagnostics
 */
export function coachText(diagnostics) {
  const isSketch = (d) => d.file === "sketch.ino";
  let first = diagnostics.findIndex((d) => d.severity === "error" && isSketch(d));
  if (first < 0) first = diagnostics.findIndex((d) => d.severity === "error");
  if (first < 0) return "";
  const parts = [diagnostics[first].message];
  for (const d of diagnostics.slice(first + 1)) {
    if (d.severity !== "note") break;
    parts.push(d.message);
  }
  return parts.join("\n");
}

/**
 * The first entry of a kind whose pattern matches, and its groups.
 * @param {object[]} errors  the errors database (catalogue.errors)
 * @param {"compile"|"upload"|"runtime"} kind
 * @param {string} text
 * @returns {{entry: object, groups: string[]} | null}
 */
export function match(errors, kind, text) {
  for (const entry of errors ?? []) {
    if (entry.kind !== kind) continue;
    const re = regex(entry);
    const m = re && re.exec(text);
    if (m) return { entry, groups: m.slice(1).map((g) => g ?? "") };
  }
  return null;
}

/** Puts a match's groups into {1}, {2}... */
export function fillIn(text, groups) {
  return text.replace(/\{(\d)\}/g, (all, n) => groups[n - 1] ?? all);
}

/**
 * Everything the Coach shows for a clue: title, explanation, hints, the
 * technical note, and the line it's about.
 * @returns {{id, title, explain, hints: string[], tech, line?: number, message: string} | null}
 */
export function explain(errors, kind, { diagnostics = [], output = "" } = {}) {
  const text = kind === "compile" && diagnostics.length ? coachText(diagnostics) : output;
  const found = match(errors, kind, text || output);
  if (!found) return null;
  const { entry, groups } = found;
  const first = diagnostics.find((d) => d.severity === "error" && d.file === "sketch.ino") ?? diagnostics.find((d) => d.severity === "error");
  return {
    id: entry.id,
    title: fillIn(entry.title, groups),
    explain: fillIn(entry.explain, groups),
    hints: entry.hints.map((h) => fillIn(h, groups)),
    tech: fillIn(entry.tech, groups),
    line: first?.file === "sketch.ino" ? first.line : undefined,
    message: (text || output).split("\n")[0],
  };
}
