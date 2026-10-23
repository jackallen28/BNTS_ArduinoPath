// The run panel / Wiring Wizard developer page (bench-demo.html): pick a
// project, board and step, run the step's model answer, open the wizard.
// ?project=&board=&step= choose; ?wizard=1 opens the wizard straight away.

import { createRunPanel } from "./widgets/runpanel.js";
import { openWiringWizard } from "./wizard.js";
import { expandPins } from "./sim/pins.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

async function main() {
  const cat = await (await fetch("api/catalogue")).json();
  const boards = cat.boards;
  for (const p of cat.projects) $("project").append(new Option(p.title, p.id));
  for (const b of boards) $("board").append(new Option(b.name, b.id));
  $("project").value = params.get("project") || "blink-traffic-lights";
  $("board").value = params.get("board") || "uno";
  let project = null, board = null, rp = null;

  async function load() {
    project = await (await fetch(`api/projects/${encodeURIComponent($("project").value)}`)).json();
    board = boards.find((b) => b.id === $("board").value);
    $("step").replaceChildren(...project.steps.map((s, i) => new Option(`${i + 1}. ${s.title}`, String(i))));
    $("step").value = params.get("step") || "0";
    showCode();
    rp?.destroy();
    rp = createRunPanel({
      board, project, circuit: project.circuit,
      onRuntimeError: (err) => { $("log").textContent = `Runtime clue on line ${err.line}: ${err.message}`; },
    });
    $("panel").replaceChildren(rp.el, rp.console.el);
    window.rp = rp;
    await rp.ready;
    document.body.dataset.ready = `${project.id}:${board.id}`;
  }
  function step() { return project.steps[Number($("step").value) || 0]; }
  function showCode() { $("code").value = expandPins(step().demo || "", project, board); }

  async function run(goal) {
    const res = await rp.run($("code").value, goal ? { events: step().sim_events || [], label: "Watching the goal" } : {});
    $("log").textContent = res.ok ? (goal ? "Watching the goal." : "Running.") :
      res.unsupported ? res.message : `Clue: line ${res.errors?.[0]?.line}: ${res.errors?.[0]?.message}`;
  }
  $("project").addEventListener("change", load);
  $("board").addEventListener("change", load);
  $("step").addEventListener("change", showCode);
  $("run").addEventListener("click", () => run(false));
  $("goal").addEventListener("click", () => run(true));
  $("stop").addEventListener("click", () => rp.stop());
  $("wizard").addEventListener("click", () => openWizard());

  function openWizard() {
    rp.stop();
    openWiringWizard({
      project, board,
      save: params.get("save") === "1" ? undefined : async () => {}, // the demo page has no student logged in
      onDone: (r) => { $("log").textContent = `Wiring Wizard done: ${JSON.stringify(r)}`; document.body.dataset.wizard = "done"; },
      onClose: () => { if (document.body.dataset.wizard !== "done") document.body.dataset.wizard = "closed"; },
    });
  }
  await load();
  if (params.get("wizard") === "1") openWizard();
}

main().catch((e) => {
  document.body.append(Object.assign(document.createElement("pre"), { textContent: String(e.stack || e) }));
  console.error(e);
});
