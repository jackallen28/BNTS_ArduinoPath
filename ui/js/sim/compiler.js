// compile(source, board): Arduino C++ → a program the runtime can run.
//
//   { ok: true, program }
//   { ok: false, errors: [{ line, col, message }] }            (worded like avr-gcc)
//   { ok: false, unsupported: true, message, line, col, errors: [] }
//
// See docs/design.md §4. No DOM: works in a Web Worker and in Node.

import { preprocess, CompileError } from "./preprocess.js";
import { parse, Unsupported } from "./parser.js";
import { check } from "./checker.js";
import { makeTypes } from "./types.js";
import { boardDefines } from "./core-header.js";
import { headerLookup, allNatives } from "./headers.js";

const MAX_ERRORS = 5;
let natives = null;

/**
 * Compiles a sketch for a board.
 * @param {string} source the sketch
 * @param {object} board a board file (content/boards/*.json)
 * @returns {{ ok: boolean, program?: object, errors?: object[], unsupported?: boolean, message?: string }}
 */
export function compile(source, board) {
  natives ||= allNatives();
  try {
    const { tokens, macros } = preprocess(String(source ?? ""), {
      header: headerLookup(board),
      defines: boardDefines(board),
      prelude: "Arduino.h",
    });
    const unit = parse(tokens, { typeNames: new Set(["String", "callback"]) });
    if (unit.errors.length) return fail(unit.errors);
    const T = makeTypes(board);
    const res = check(unit, { T, board, natives, macroNames: [...macros.keys()].filter((m) => !m.startsWith("_")) });
    if (res.unsupported) return unsupported(res.unsupported);
    if (res.errors.length) return fail(res.errors);
    res.program.natives = natives;
    return { ok: true, program: res.program };
  } catch (e) {
    if (e instanceof Unsupported) return unsupported(e);
    if (e instanceof CompileError) return fail([e]);
    if (e && e.sim && e.kind === "unsupported") return unsupported(new Unsupported(e.message, null));
    return {
      ok: false,
      errors: [{ line: 0, col: 0, message: "internal error: the simulator couldn't read this sketch. Press Upload to try the real compiler." }],
      internal: String(e && e.stack || e),
    };
  }
}

function fail(errors) {
  return {
    ok: false,
    errors: errors.slice(0, MAX_ERRORS).map((e) => ({ line: e.line, col: e.col, message: e.message })),
  };
}

function unsupported(u) {
  const message = `The simulator can't run this part of your code (${u.what ?? u.message}), but the real board can: press Upload.`;
  return { ok: false, unsupported: true, message, line: u.line ?? 0, col: u.col ?? 0, errors: [] };
}
