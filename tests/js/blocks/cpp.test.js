// Block coding: every project's starters and model answers turn into blocks
// and back into C++ that still does the job (the demo passes its checks),
// keeps its ___ blanks, and doesn't change on a second trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, boards } from "../sim/helpers.js";
import { toBlocks, toCode } from "../../../ui/js/blocks/cpp.js";
import { expandPins, projectSuits } from "../../../ui/js/sim/pins.js";
import { stripComments } from "../../../ui/js/sim/checks.js";
import { runHeadless } from "../../../ui/js/sim/headless.js";
import { evaluate, isAutomatic } from "../../../ui/js/sim/checks.js";

const CLOCK = Date.UTC(2026, 9, 22, 3, 4, 5);
/** The failed automatic checks when `code` runs with the step's events (as content-demos.test.js). */
function checkStep(project, step, board, code) {
  const result = runHeadless(code, { board, project, ms: step.sim_ms ?? 5000, events: step.sim_events ?? [], clock: CLOCK });
  if (!result.ok) return [`doesn't run: ${result.message ?? JSON.stringify(result.errors)}`];
  return evaluate((step.checks ?? []).filter(isAutomatic), { code, board, project, result }).filter((c) => !c.ok).map((c) => `check failed: ${c.label}`);
}

const projects = fs.readdirSync(path.join(ROOT, "content/projects")).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "content/projects", f), "utf8")));
const blankCount = (code) => (stripComments(code).match(/\b___\b/g) || []).length;
const allBlocks = (state) => {
  const out = [];
  const walk = (b) => {
    if (!b) return;
    out.push(b);
    for (const i of Object.values(b.inputs || {})) { walk(i.block); walk(i.shadow); }
    walk(b.next?.block);
  };
  state.blocks.blocks.forEach(walk);
  return out;
};

for (const project of projects) {
  const board = Object.values(boards).find((b) => b.id === "uno" && projectSuits(project, b)) ?? Object.values(boards).find((b) => projectSuits(project, b));
  test(`${project.id}: every step's code survives the trip to blocks and back`, () => {
    project.steps.forEach((step, i) => {
      for (const which of ["starter", "demo"]) {
        if (!step[which]) continue;
        const code = expandPins(step[which], project, board);
        const once = toCode(toBlocks(code), { project, board });
        assert.equal(toCode(toBlocks(once), { project, board }), once, `step ${i + 1} ${which}: a second trip changes nothing`);
        assert.equal(blankCount(once), blankCount(code), `step ${i + 1} ${which}: the blanks are kept`);
        if (which === "demo") {
          assert.deepEqual(checkStep(project, step, board, once), [], `step ${i + 1}: the blocks' code passes the checks`);
        }
      }
    });
  });
}

test("the Smart Bin is all friendly blocks (no grey C++ code blocks)", () => {
  const bin = projects.find((p) => p.id === "smart-bin");
  const board = boards.uno ?? Object.values(boards).find((b) => b.id === "uno");
  for (const step of bin.steps) {
    for (const code of [step.starter, step.demo]) {
      const types = allBlocks(toBlocks(expandPins(code, bin, board))).map((b) => b.type);
      assert.ok(!types.some((t) => t.startsWith("ap_raw")), `${step.title}: ${types.join(", ")}`);
    }
  }
});

test("a blank is an empty socket, and an empty socket is a blank", () => {
  const state = toBlocks("void loop() {\n  delay(___);\n}\n");
  const delay = state.blocks.blocks[0].inputs.DO.block;
  assert.equal(delay.type, "ap_delay");
  assert.equal(delay.inputs?.MS, undefined);
  assert.match(toCode(state), /delay\(___\);/);
});

test("unusual C++ is kept as it was, in a C++ code block", () => {
  const code = "void loop() {\n  int x = a ? 1 : 2;\n  switch (x) {\n    case 1: break;\n  }\n}\n";
  const out = toCode(toBlocks(code));
  assert.match(out, /int x = a \? 1 : 2;/);
  assert.match(out, /switch \(x\) \{\n    case 1: break;\n  \}/);
});

test("brackets are kept where the maths needs them", () => {
  const out = toCode(toBlocks("void loop() {\n  x = (a + b) * c;\n  y = a - (b - c);\n  z = a * b + c;\n}\n"));
  assert.match(out, /x = \(a \+ b\) \* c;/);
  assert.match(out, /y = a - \(b - c\);/);
  assert.match(out, /z = a \* b \+ c;/);
});
