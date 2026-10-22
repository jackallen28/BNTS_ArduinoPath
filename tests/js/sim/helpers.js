// Shared helpers for the simulator tests.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHeadless } from "../../../ui/js/sim/headless.js";
import { compile } from "../../../ui/js/sim/compiler.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const boards = Object.fromEntries(
  fs.readdirSync(path.join(ROOT, "content/boards"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const b = JSON.parse(fs.readFileSync(path.join(ROOT, "content/boards", f), "utf8"));
      return [b.id, b];
    }),
);

export const uno = boards.uno;
export const esp32 = boards.esp32;
export const nodemcu = boards.nodemcu;

/** Runs a sketch headless; throws if it doesn't compile. */
export function run(src, opts = {}) {
  const r = runHeadless(src, { board: uno, ms: 1000, clock: 1_700_000_000_000, ...opts });
  if (!r.ok && !opts.allowFail) {
    throw new Error("sketch failed: " + JSON.stringify(r.errors) + (r.message ?? ""));
  }
  return r;
}

/** Wraps statements in setup() with Serial, and returns the Serial text. */
export function out(body, opts = {}) {
  const src = `${opts.globals ?? ""}\nvoid setup() { Serial.begin(115200);\n${body}\n}\nvoid loop() { delay(1000); }`;
  return run(src, { ms: 50, ...opts }).serial;
}

/** The first compile error message (or "" when it compiles). */
export function err(src, board = uno) {
  const r = compile(src, board);
  if (r.ok) return "";
  if (r.unsupported) return "UNSUPPORTED: " + r.message;
  return r.errors[0].message;
}

/** All compile errors. */
export function errs(src, board = uno) {
  const r = compile(src, board);
  return r.ok ? [] : r.errors;
}

/** A full sketch from setup / loop bodies. */
export const sketch = (setup, loop = "", globals = "") => `${globals}\nvoid setup() {\n${setup}\n}\nvoid loop() {\n${loop}\n}\n`;
