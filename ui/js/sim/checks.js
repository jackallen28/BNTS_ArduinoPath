// A step's checklist (docs/design.md §5). evaluate() says which checks pass
// after a Run in the simulator (or an Upload: code checks, compiles and the
// student's "I saw it happen" ticks).

import { resolvePin } from "./pins.js";

/** The code without comments (strings are kept). */
export function stripComments(code) {
  return String(code || "").replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? (m.startsWith("/*") ? m.replace(/[^\n]/g, " ") : ""));
}

/** Spaces only where they matter, so "digitalWrite(13,HIGH)" matches "digitalWrite(13, HIGH)". */
const squash = (s) => s.replace(/\s+/g, " ").replace(/ ?([^\w\s]) ?/g, "$1").trim();

const TYPE_WORDS = /(?:void|int|long|float|double|bool|boolean|char|byte|String|short|unsigned|word|auto|size_t|u?int\d+_t)\s*[*&]?\s*$/;

/** Does the code call a function (not just define it)? */
function callsFunction(code, name) {
  const re = new RegExp(`(^|[^\\w.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`, "g");
  const reMember = new RegExp(`[.>]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`);
  if (reMember.test(code)) return true;
  for (const m of code.matchAll(re)) {
    const before = code.slice(0, m.index + m[1].length);
    if (!TYPE_WORDS.test(before)) return true;
  }
  return false;
}

const isAutomatic = (c) => c.type !== "confirm" && c.type !== "run_count";

/**
 * Evaluates a step's checks.
 * @param {object[]} checks
 * @param {object} ctx
 * @param {string} ctx.code the student's code
 * @param {object} ctx.board
 * @param {object} [ctx.project] for pin roles
 * @param {object} [ctx.result] a run result: { ok, errors, events, serial, stopped_at_ms } (runHeadless, or a trace from the bench)
 * @param {number} [ctx.runs] how many times the student has run this step
 * @param {string[]|Set<string>} [ctx.confirmed] labels the student ticked
 * @returns {{ ok: boolean, label: string, type: string }[]}
 */
export function evaluate(checks, { code = "", board, project = null, result = null, runs = 0, confirmed = [] } = {}) {
  const clean = stripComments(code);
  const events = result?.events ?? [];
  const serial = String(result?.serial ?? events.filter((e) => e.type === "serial" && !e.port).map((e) => e.text).join("")).replace(/\r\n/g, "\n");
  const conf = confirmed instanceof Set ? confirmed : new Set(confirmed || []);
  const pinNum = (p) => (p == null ? null : resolvePin(p, board, project)?.number ?? (/^\d+$/.test(String(p)) ? Number(p) : NaN));
  const ran = !!result && result.ok !== false && !events.some((e) => e.type === "error");
  return (checks || []).map((c) => {
    let ok = false;
    try {
      ok = one(c);
    } catch {
      ok = false;
    }
    return { ok, label: c.label ?? c.text ?? c.type, type: c.type };
  });

  function one(c) {
    switch (c.type) {
      case "code_contains": return clean.includes(c.text) || squash(clean).includes(squash(c.text));
      case "code_regex": return regex(c).test(clean);
      case "uses_function": return callsFunction(clean, c.name);
      case "compiles": return !!result && !(result.errors || []).some((e) => e.kind !== "runtime") && !result.unsupported && (result.ok !== false || (result.errors || []).every((e) => e.kind === "runtime"));
      case "runs": return ran && (result.stopped_at_ms ?? 0) >= (c.ms ?? 0);
      case "serial_contains": return serial.includes(c.text);
      case "serial_regex": return regex(c).test(serial);
      case "pin_seen": {
        const pin = pinNum(c.pin);
        const want = String(c.value ?? "HIGH").toUpperCase() === "LOW" || c.value === 0 ? 0 : 1;
        let n = 0;
        for (const e of events) {
          if (e.pin !== pin) continue;
          if (e.type === "digital" && e.value === want) n++;
          else if (e.type === "pwm" && ((want === 1 && e.value >= (board?.pwm_max ?? 255)) || (want === 0 && e.value === 0))) n++;
        }
        return n >= (c.times ?? 1);
      }
      case "pwm_seen": {
        const pin = pinNum(c.pin);
        return events.some((e) => e.type === "pwm" && (pin == null || e.pin === pin) && e.value >= (c.min ?? 0) && e.value <= (c.max ?? Infinity));
      }
      case "tone_seen": {
        const pin = pinNum(c.pin);
        return events.some((e) => e.type === "tone" && (pin == null || e.pin === pin) && e.freq >= (c.min_hz ?? 0) && e.freq <= (c.max_hz ?? Infinity));
      }
      case "servo_angle": {
        const pin = pinNum(c.pin);
        const tol = c.tolerance ?? 5;
        return events.some((e) => e.type === "servo" && (pin == null || e.pin === pin) && Math.abs(e.angle - c.angle) <= tol);
      }
      case "display_text": {
        const want = squashSpaces(c.text);
        return events.some((e) => e.type === "display_text" && squashSpaces(e.text).includes(want));
      }
      case "neopixel_lit": {
        const pin = pinNum(c.pin);
        return events.some((e) => e.type === "neopixel" && (pin == null || e.pin === pin) &&
          e.pixels.filter((p) => p[0] || p[1] || p[2]).length >= (c.count ?? 1));
      }
      case "run_count": return runs >= (c.min ?? 1);
      case "confirm": return conf.has(c.label) || (c.text != null && conf.has(c.text));
      default: return false;
    }
  }
}

/**
 * A check's pattern as a JS RegExp. Patterns are shared with the Go side,
 * so a leading RE2 flag group like (?i) or (?s) becomes a JS flag.
 */
export function regex(c) {
  let pattern = String(c.pattern ?? "");
  let flags = c.flags || "";
  const m = /^\(\?([imsU]+)\)/.exec(pattern);
  if (m) {
    pattern = pattern.slice(m[0].length);
    for (const f of m[1].replace("U", "")) if (!flags.includes(f)) flags += f;
  }
  return new RegExp(pattern, flags);
}

const squashSpaces = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export { isAutomatic };
