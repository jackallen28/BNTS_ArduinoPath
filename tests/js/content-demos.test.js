// Every project step's demo (the model answer) runs in the simulator on
// every board the project lists, with the step's sim_events, and passes
// every automatic check (all but "confirm" and "run_count").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, boards } from "./sim/helpers.js";
import { runHeadless } from "../../ui/js/sim/headless.js";
import { expandPins, projectSuits } from "../../ui/js/sim/pins.js";
import { evaluate, isAutomatic } from "../../ui/js/sim/checks.js";

const CLOCK = Date.UTC(2026, 9, 22, 3, 4, 5); // a fixed laptop clock

function projectsIn(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

/** Runs one step on one board; returns the failed checks (or a compile problem). */
export function checkStep(project, step, board) {
  const code = expandPins(step.demo, project, board);
  const result = runHeadless(code, { board, project, ms: step.sim_ms ?? 5000, events: step.sim_events ?? [], clock: CLOCK });
  if (!result.ok) return [`doesn't run: ${result.message ?? JSON.stringify(result.errors)}`];
  const checks = (step.checks ?? []).filter(isAutomatic);
  return evaluate(checks, { code, board, project, result }).filter((c) => !c.ok).map((c) => `check failed: ${c.label} (${c.type})`);
}

function testProjects(projects, where) {
  for (const project of projects) {
    const suits = Object.values(boards).filter((b) => projectSuits(project, b));
    (project.steps ?? []).forEach((step, i) => {
      if (!step.demo) return;
      test(`${where}${project.id} step ${i + 1} (${step.title}): the demo passes its checks on ${suits.map((b) => b.id).join(", ")}`, () => {
        const problems = [];
        for (const board of suits) {
          for (const p of checkStep(project, step, board)) problems.push(`${board.id}: ${p}`);
        }
        assert.deepEqual(problems, []);
      });
    });
  }
}

testProjects(projectsIn(path.join(ROOT, "tests/js/fixtures")), "fixture ");
testProjects(projectsIn(path.join(ROOT, "content/projects")), "");
