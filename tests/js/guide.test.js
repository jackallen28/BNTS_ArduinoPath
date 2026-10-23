import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { splitText, showExplanation, starterFor, demoFor, blanks, baudOf, simDiagnostics, checklist, allDone, firstFailing, openingStep } from "../../ui/js/guide.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../../content/${p}`, import.meta.url), "utf8"));
const uno = read("boards/uno.json");
const nodemcu = read("boards/nodemcu.json");

test("splitText finds the goal line", () => {
  const { goal, body } = splitText("LEDs need a resistor.\n\nThe long leg is +.\n\n**Your task:** make it blink.");
  assert.equal(goal, "**Your task:** make it blink.");
  assert.equal(body, "LEDs need a resistor.\n\nThe long leg is +.");
  assert.deepEqual(splitText("**Goal:** a race."), { goal: "**Goal:** a race.", body: "" });
  assert.deepEqual(splitText("Just text."), { goal: "", body: "Just text." });
});

test("advanced students see the goal first", () => {
  assert.equal(showExplanation("beginner", "brief"), true);
  assert.equal(showExplanation("moderate", "guided"), true);
  assert.equal(showExplanation("moderate", "brief"), false);
  assert.equal(showExplanation("advanced", "guided"), false);
});

test("starter code has the board's pins, and keep steps keep the code", () => {
  const project = read("projects/blink-traffic-lights.json");
  const s = starterFor(project.steps[0], project, uno);
  assert.ok(s && !s.includes("{{pins}}"), s);
  assert.match(s, /Pins for your Arduino Uno/);
  assert.equal(starterFor({ ...project.steps[0], starter_mode: "keep" }, project, uno), null);
  assert.equal(starterFor({ title: "x" }, project, uno), null);
  assert.ok(!demoFor(project.steps[0], project, nodemcu).includes("{{pins}}"));
});

test("blanks are found, comments ignored", () => {
  assert.deepEqual(blanks("int a = ___;\n// fill in ___ here\nfoo(___, 2);\nint my___name;"), [1, 3]);
  assert.deepEqual(blanks("void setup() {}"), []);
});

test("baudOf reads Serial.begin", () => {
  assert.equal(baudOf("void setup() { Serial.begin(115200); }"), 115200);
  assert.equal(baudOf("// Serial.begin(115200);\nvoid setup() {}"), 9600);
});

test("simulator errors become diagnostics", () => {
  assert.deepEqual(simDiagnostics([{ line: 3, col: 5, message: "expected ';' before '}' token" }]),
    [{ file: "sketch.ino", line: 3, col: 5, severity: "error", message: "expected ';' before '}' token" }]);
});

test("checklist: simulator and real board", () => {
  const step = { checks: [
    { type: "code_contains", label: "Uses delay", text: "delay(" },
    { type: "pin_seen", label: "The LED turns on", pin: "13", value: "HIGH" },
    { type: "confirm", label: "I saw it blink" },
  ] };
  const code = "void loop(){ digitalWrite(13, HIGH); delay(500); }";
  const result = { ok: true, events: [{ type: "digital", pin: 13, value: 1 }], serial: "" };
  let rows = checklist(step, { code, board: uno, result, mode: "sim" });
  assert.deepEqual(rows.map((r) => [r.ok, r.tick]), [[true, false], [true, false], [false, true]]);
  assert.equal(allDone(rows), false);
  assert.equal(firstFailing(rows), null);
  rows = checklist(step, { code, board: uno, result, confirmed: new Set(["I saw it blink"]) });
  assert.equal(allDone(rows), true);

  // On a real board the simulator-only check becomes a tick.
  rows = checklist(step, { code, board: uno, result: { ok: true, serial: "" }, mode: "board" });
  assert.deepEqual(rows.map((r) => [r.ok, r.tick]), [[true, false], [false, true], [false, true]]);
  rows = checklist(step, { code, board: uno, result: { ok: true, serial: "" }, mode: "board", confirmed: new Set(["The LED turns on", "I saw it blink"]) });
  assert.equal(allDone(rows), true);
});

test("every project step's model answer passes its own automatic code checks", () => {
  for (const f of readdirSync(new URL("../../content/projects/", import.meta.url))) {
    const project = read(`projects/${f}`);
    project.steps.forEach((step, i) => {
      const code = demoFor(step, project, uno);
      const rows = checklist(step, { code, board: uno, project, result: null });
      for (const [j, c] of step.checks.entries()) {
        if (["code_contains", "code_regex", "uses_function"].includes(c.type)) {
          assert.ok(rows[j].ok, `${project.id} step ${i + 1}: "${c.label}" fails on the model answer`);
        }
      }
      assert.deepEqual(blanks(code), [], `${project.id} step ${i + 1}: the model answer has blanks`);
      if (step.starter && step.starter_mode !== "keep") {
        const starter = starterFor(step, project, uno);
        if (step.support === "scaffolded") assert.notEqual(starter.trim(), code.trim(), `${project.id} step ${i + 1}: a scaffolded step's starter is already the answer`);
      }
    });
  }
});

test("openingStep stays in range", () => {
  assert.equal(openingStep({ step: 2 }, 4), 2);
  assert.equal(openingStep({ step: 9 }, 4), 3);
  assert.equal(openingStep(null, 4), 0);
  assert.equal(openingStep({ step: 1 }, 0), 0);
});
