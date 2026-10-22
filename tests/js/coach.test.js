import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coachText, match, explain, fillIn } from "../../ui/js/coach.js";

const db = JSON.parse(readFileSync(new URL("../../content/errors.json", import.meta.url), "utf8")).errors;

test("every recorded example output maps to its own entry", () => {
  for (const e of db) {
    if (!e.example_output) continue;
    assert.equal(match(db, e.kind, e.example_output)?.entry.id, e.id, e.id);
  }
});

test("each kind ends with a catch-all", () => {
  assert.equal(match(db, "compile", "zzz")?.entry.id, "compile-other");
  assert.equal(match(db, "upload", "zzz")?.entry.id, "upload-other");
});

test("old and new gcc spelling suggestions", () => {
  const diags = [
    { file: "sketch.ino", line: 6, col: 3, severity: "error", message: "'digitalwrite' was not declared in this scope" },
    { file: "sketch.ino", line: 6, col: 3, severity: "note", message: "suggested alternative: 'digitalWrite'" },
  ];
  assert.equal(coachText(diags), "'digitalwrite' was not declared in this scope\nsuggested alternative: 'digitalWrite'");
  const old = explain(db, "compile", { diagnostics: diags });
  assert.equal(old.id, "misspelt-function");
  assert.match(old.explain, /It thinks you meant digitalWrite/);
  assert.equal(old.line, 6);
  const gcc12 = explain(db, "compile", { diagnostics: [{ file: "sketch.ino", line: 2, severity: "error", message: "'digitalwrite' was not declared in this scope; did you mean 'digitalWrite'?" }] });
  assert.equal(gcc12.id, "misspelt-function");
  assert.equal(gcc12.title, "A spelling clue: digitalwrite");
});

test("specific clues before general ones", () => {
  const ids = (msg) => match(db, "compile", msg)?.entry.id;
  assert.equal(ids("'ledPin' was not declared in this scope"), "not-declared");
  assert.equal(ids("expected ';' before '}' token"), "missing-semicolon");
  assert.equal(ids("expected '}' at end of input"), "missing-close-brace");
  assert.equal(ids("expected declaration before '}' token"), "extra-brace");
  assert.equal(ids("expected constructor, destructor, or type conversion before '(' token"), "code-outside-function");
  assert.equal(ids("undefined reference to `setup'"), "setup-missing");
  assert.equal(ids("fatal error: Servoo.h: No such file or directory"), "library-not-found");
  assert.equal(match(db, "upload", "avrdude: ser_open(): can't open device \"\\\\.\\COM7\": The system cannot find the file specified.")?.entry.id, "port-not-found");
});

test("fillIn leaves unknown groups alone", () => {
  assert.equal(fillIn("{1} and {2}", ["a"]), "a and {2}");
});

test("upload explanations use the whole output", () => {
  const e = explain(db, "upload", { output: "Connecting...\nA fatal error occurred: Failed to connect to ESP8266: Timed out waiting for packet header" });
  assert.equal(e.id, "esp-not-connecting");
  assert.equal(e.line, undefined);
});
