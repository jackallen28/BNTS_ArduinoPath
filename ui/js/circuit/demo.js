// The circuit demo page: the sample circuit on any board, step by step,
// with a pretend simulation so every kind of drawn behaviour shows.

import { drawBreadboard, drawSchematic, loadCircuitParts } from "./render.js";
import { validateCircuit, defaultResolvePin, pinOverrides } from "./netlist.js";
import { stepCount } from "./layout.js";
import { demoCircuit } from "./demo-circuit.js";
import { glyph } from "./font5x7.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

async function main() {
  const cat = await (await fetch("api/catalogue")).json();
  const boards = cat.boards;
  const select = $("board");
  for (const b of boards) select.append(new Option(b.name, b.id));
  select.value = params.get("board") || "uno";
  // ?project=<id> draws a project's circuit instead of the sample.
  let circuit = demoCircuit, project = null;
  if (params.get("project")) {
    project = await (await fetch(`api/projects/${encodeURIComponent(params.get("project"))}`)).json();
    circuit = project.circuit;
    document.title = `${project.title}: circuit`;
  }
  const steps = stepCount(circuit) || 1;
  let step = params.has("step") ? +params.get("step") : 1;
  let all = params.get("all") === "1";
  let views = [];
  let timer = null;
  let pot = 0.5, pressed = false;

  async function show() {
    for (const v of views) v.destroy();
    clearInterval(timer);
    const board = boards.find((b) => b.id === select.value);
    const parts = await loadCircuitParts(circuit, board);
    const pins = defaultResolvePin(board, pinOverrides(project?.pins, board));
    const opts = { board, circuit, parts, pins, step, showAll: all, names: cat.parts };
    const bb = drawBreadboard($("breadboard"), opts);
    const sch = drawSchematic($("schematic"), opts);
    views = [bb, sch];
    bb.onControl((id, control, value) => {
      $("control-log").textContent = `${id}: ${control} = ${JSON.stringify(value)}`;
      if (control === "position") pot = value;
      if (id === "b1" && control === "press") pressed = value;
    });
    const problems = validateCircuit(circuit, board, parts, pins);
    $("problems").replaceChildren(...(problems.length ? problems : [{ level: "ok", message: "No problems found." }])
      .map((p) => Object.assign(document.createElement("li"), { className: p.level, textContent: p.message })));
    updateStep();
    // A pretend sketch: traffic lights, the knob turns the servo, the OLED shows a bar.
    let t = 0;
    const tick = () => {
      if (!$("live").checked) return;
      t++;
      const phase = Math.floor(t / 6) % 3;
      const oled = new Uint8Array(128 * 64 / 8);
      const bar = Math.round(pot * 120);
      for (let x = 4; x < 4 + bar; x++) for (const page of [5, 6]) oled[x + page * 128] = 0xff;
      for (let x = 0; x < 128; x++) { oled[x] |= 1; oled[x + 7 * 128] |= 0x80; }
      for (let p = 0; p < 8; p++) { oled[p * 128] = 0xff; oled[127 + p * 128] = 0xff; }
      drawText(oled, 8, 12, pressed ? "PRESSED!" : `KNOB ${Math.round(pot * 100)}%`);
      bb.setState({
        led: { red: phase === 0 ? 1 : 0, yellow: phase === 1 ? 1 : 0, green: phase === 2 ? 1 : 0 },
        servo: { servo: Math.round(pot * 180) },
        oled: { oled },
        button: {},
      });
    };
    tick();
    timer = setInterval(tick, 120);
    window.cpDemo = { bb, sch, parts, board, problems };
    document.body.dataset.ready = select.value;
  }

  function updateStep() {
    const title = project?.wiring_steps?.[step - 1]?.title;
    $("step-label").textContent = all ? "The whole circuit" : `Step ${step} of ${steps}${title ? `: ${title}` : ""}`;
    $("prev").disabled = all || step <= 1;
    $("next").disabled = all || step >= steps;
    $("all").setAttribute("aria-pressed", String(all));
    for (const v of views) { v.setStep(step); v.setShowAll(all); }
  }
  $("prev").addEventListener("click", () => { step = Math.max(1, step - 1); updateStep(); });
  $("next").addEventListener("click", () => { step = Math.min(steps, step + 1); updateStep(); });
  $("all").addEventListener("click", () => { all = !all; updateStep(); });
  select.addEventListener("change", show);
  await show();
}

// Text on the OLED buffer with the 5×7 font, twice the size.
function drawText(buf, x0, y0, text) {
  let x = x0;
  for (const ch of text) {
    for (const col of glyph(ch)) {
      for (let y = 0; y < 7; y++) {
        if (!(col & (1 << y))) continue;
        for (let sx = 0; sx < 2; sx++) for (let sy = 0; sy < 2; sy++) {
          const px = x + sx, py = y0 + y * 2 + sy;
          if (px < 128) buf[px + (py >> 3) * 128] |= 1 << (py & 7);
        }
      }
      x += 2;
    }
    x += 2;
  }
}

main().catch((e) => {
  document.body.append(Object.assign(document.createElement("pre"), { textContent: String(e.stack || e) }));
  console.error(e);
});
