// The step-by-step guide's logic, apart from the page: what a step shows at
// each help level, its starter code, the checklist rows (simulator or real
// board), blanks left in the code, and the Serial Monitor speed. Pure
// (tested in Node); the workspace shows what it decides.

import { evaluate, stripComments } from "./sim/checks.js";
import { expandPins } from "./sim/pins.js";

/** Checks only the simulator can see. On a real board the student ticks "I saw it happen" instead. */
export const SIM_ONLY = new Set(["pin_seen", "pwm_seen", "tone_seen", "servo_angle", "display_text", "neopixel_lit", "runs"]);

const GOAL_LINE = /^\s*\*\*(Your task|Goal):\*\*/i;

/**
 * A step's text split into the goal line ("**Your task:** ..." or
 * "**Goal:** ...") and the explanation before it.
 * @returns {{goal: string, body: string}}
 */
export function splitText(text) {
  const paras = String(text ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const i = paras.findIndex((p) => GOAL_LINE.test(p));
  if (i < 0) return { goal: "", body: paras.join("\n\n").trim() };
  return {
    goal: paras.slice(i).join("\n\n").trim(),
    body: paras.slice(0, i).join("\n\n").trim(),
  };
}

/**
 * Should the explanation be shown straight away? Advanced students see the
 * goal first ("tutorial off") and open the explanation if they want it.
 */
export function showExplanation(level, support) {
  if (level === "advanced") return false;
  if (level === "moderate" && support === "brief") return false;
  return true;
}

/**
 * The code a step starts with for this board, or null to keep the
 * student's code ("keep" steps, or steps without a starter).
 */
export function starterFor(step, project, board) {
  if (!step || step.starter == null || step.starter_mode === "keep") return null;
  return expandPins(step.starter, project, board);
}

/** The step's model answer for this board (Watch the goal, and checking content). */
export function demoFor(step, project, board) {
  return expandPins(step?.demo ?? "", project, board);
}

/** Line numbers (from 1) that still have a ___ blank, ignoring comments. */
export function blanks(code) {
  const lines = stripComments(code).split("\n");
  const out = [];
  lines.forEach((l, i) => { if (/(^|[^\w])___+([^\w]|$)/.test(l) || /\b___\b/.test(l)) out.push(i + 1); });
  return out;
}

/** The speed in Serial.begin(...), for the real Serial Monitor (9600 if none). */
export function baudOf(code) {
  const m = /\bSerial\s*\.\s*begin\s*\(\s*(\d{3,7})\b/.exec(stripComments(code));
  return m ? Number(m[1]) : 9600;
}

/** The simulator's compile errors as compiler diagnostics, for the Coach. */
export function simDiagnostics(errors) {
  return (errors ?? []).map((e) => ({ file: "sketch.ino", line: e.line ?? 0, col: e.col ?? 0, severity: e.severity ?? "error", message: e.message ?? "" }));
}

/**
 * The checklist for a step.
 * mode "sim": after a Run in the simulator (result = the run panel's result).
 * mode "board": after an Upload (result = { serial, ok, errors } from the
 * compiler and the real Serial Monitor); checks only the simulator can see
 * become "I saw it happen" ticks.
 * @returns {{label, ok, type, tick: boolean, ticked: boolean}[]}
 *   tick: the row has an "I saw it happen" box.
 */
export function checklist(step, { code, board, project, result, runs = 0, confirmed = new Set(), mode = "sim" }) {
  const checks = step?.checks ?? [];
  const conf = confirmed instanceof Set ? confirmed : new Set(confirmed);
  const evaluated = evaluate(checks, { code, board, project, result, runs, confirmed: conf });
  return checks.map((c, i) => {
    const label = evaluated[i].label;
    const tick = c.type === "confirm" || (mode === "board" && SIM_ONLY.has(c.type));
    const ticked = tick && conf.has(label);
    const ok = tick && mode === "board" && SIM_ONLY.has(c.type) ? ticked : evaluated[i].ok;
    return { label, ok, type: c.type, tick, ticked };
  });
}

/** Is the step done? Every row passes. */
export function allDone(rows) {
  return rows.length > 0 && rows.every((r) => r.ok);
}

/** The first row that isn't done yet and isn't a tick (for the Coach's "check keeps failing"). */
export function firstFailing(rows) {
  return rows.find((r) => !r.ok && !r.tick)?.label ?? null;
}

/** Can a student skip steps and jump to the challenge? (Advanced only.) */
export function canSkip(level) {
  return level === "advanced";
}

/** The step to open: where they were, or the first one not done. */
export function openingStep(progress, stepCount) {
  if (stepCount === 0) return 0;
  const saved = Number.isInteger(progress?.step) ? progress.step : 0;
  return Math.max(0, Math.min(saved, stepCount - 1));
}

/**
 * The baud rate the simulator's console should show and a guess at the
 * board's line ending, from the code.
 */
export function serialSettings(code) {
  return { baud: baudOf(code) };
}
