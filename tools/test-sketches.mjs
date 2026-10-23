// Writes every project's Wiring Wizard test program, for every board the
// project lists, as JSON: [{ project, board, code }]. CI compiles them all
// with the real tools (internal/arduino, TestRealBundle), so a test program
// never meets a real board for the first time in a classroom.
//   node tools/test-sketches.mjs out.json
import { writeFileSync } from "node:fs";
import { Bench } from "../ui/js/bench.js";
import { defaultResolvePin, pinOverrides } from "../ui/js/circuit/netlist.js";
import { testSketch } from "../ui/js/wiring-test.js";
import { catalogue, boards, projects, supports } from "../tests/js/circuit/helpers.js";

const out = process.argv[2];
if (!out) {
  console.error("usage: node tools/test-sketches.mjs out.json");
  process.exit(2);
}
const parts = catalogue();
const list = [];
for (const p of projects()) {
  if (!p.circuit?.parts?.length) continue;
  for (const b of boards().filter((x) => supports(p, x))) {
    const bench = new Bench({ board: b, circuit: p.circuit, parts, pins: defaultResolvePin(b, pinOverrides(p.pins, b)) });
    const { code } = testSketch(bench.testParts(), b);
    list.push({ project: p.id, board: b.id, code });
  }
}
writeFileSync(out, JSON.stringify(list, null, 1));
console.log(`${list.length} test programs written to ${out}`);
