// The Wiring Wizard (CLAUDE.md §5): meet the parts → wire it, step by step
// → test it (in the simulator, or on the real board over USB) → start
// programming. A Vista wizard dialog.
//
//   openWiringWizard({ project, board, pins, onDone, onClose, partsOnly });
//
// onDone({ confirmed: true }) runs when every part is confirmed and the
// student presses Start programming; "wiring done" is saved in the
// project's progress first ({ wiring_done: true }, merged into what's there).

import { h } from "./dom.js";
import { openDialog } from "./widgets/window.js";
import { api } from "./api.js";
import { drawBreadboard, drawSchematic, loadCircuitParts } from "./circuit/render.js";
import { artContent, svgEl } from "./circuit/svg.js";
import { defaultResolvePin, pinOverrides } from "./circuit/netlist.js";
import { fillWiringText } from "./circuit/wiring-text.js";
import { createRunPanel } from "./widgets/runpanel.js";
import { testSketch, TEST_BAUD } from "./wiring-test.js";
import { TestRows, FIXES, wizardPages } from "./wizard-rows.js";
import { compile, upload, openSerial, guessPort, portLabel } from "./realboard.js";

const SAFETY = "Unplug the USB cable before you change any wires, and plug it back in when you're done. " +
  "ESP boards use 3.3V: never connect 5V to one of their pins. LEDs always need a resistor.";

/** Saves "wiring done" for a project, keeping the rest of its progress. */
export async function saveWiringDone(projectId) {
  const list = await api.progress();
  const mine = (Array.isArray(list) ? list : list?.progress || []).find((p) => p.project_id === projectId);
  const data = { ...(mine?.data || {}), wiring_done: true };
  await api.saveProgress(projectId, data);
}

/**
 * Opens the Wiring Wizard.
 * @param {object} o
 * @param {object} o.project   the full project JSON (with circuit and wiring_steps)
 * @param {object} o.board     content/boards/<id>.json
 * @param {Function|object} [o.pins]  resolvePin, or role → code overrides (default: the project's pins)
 * @param {(r: {confirmed: true}) => void} [o.onDone]
 * @param {() => void} [o.onClose]   closed without finishing
 * @param {string[]} [o.partsOnly]   Free Play's mini wizard: just these part ids
 * @param {(projectId: string) => Promise} [o.save]  how to save "wiring done" (default: the progress API)
 * @param {object} [o.names]   part names and texts (content/parts/index.json "parts"; default: from /api/catalogue)
 * @returns {{close(): void, el: HTMLElement}}
 */
export function openWiringWizard({ project, board, pins, onDone = () => {}, onClose = () => {}, partsOnly = null, save = saveWiringDone, names = null }) {
  const resolve = typeof pins === "function" ? pins : defaultResolvePin(board, pins || pinOverrides(project.pins, board));
  const circuit = project.circuit || { breadboard: "none", parts: [], wires: [] };
  const pages = wizardPages(project, partsOnly);
  let at = 0, done = false, cleanup = [], fixFor = null, catalogue = null, info = names;
  let showAll = false, schematic = false, mode = "sim";
  let rows = null, rp = null, serial = null, testRunning = false;

  const dots = h("div", { class: "wiz-dots", "aria-hidden": "true" });
  const page = h("div", { class: "wiz-page" });
  const back = h("button", { class: "btn", type: "button", onclick: () => go(at - 1) }, "◀ Back");
  const next = h("button", { class: "btn default", type: "button", onclick: () => go(at + 1) }, "Next ▶");
  const skip = h("button", { class: "btn", type: "button", onclick: () => go(pages.findIndex((p) => p.kind !== "meet")) }, "Skip the introductions");
  const finish = h("button", { class: "btn default", type: "button", disabled: true, onclick: () => complete() }, "Start programming");
  const buttons = h("div", { class: "wiz-buttons" }, skip, h("span", { class: "spacer" }), back, next, finish);

  const dlg = openDialog({ title: `Wiring Wizard: ${project.title}`, wide: true, content: [dots, page, buttons] });
  dlg.el.classList.add("wizard");
  dlg.result.then(() => {
    teardown();
    if (!done) onClose();
  });

  function teardown() {
    for (const fn of cleanup) { try { fn(); } catch { /* already gone */ } }
    cleanup = [];
  }
  function stopTest() {
    serial?.close();
    serial = null;
    rp?.stop();
    testRunning = false;
  }

  async function ready() {
    if (!catalogue) catalogue = await loadCircuitParts(circuit, board);
    if (!info) {
      try { info = (await api.catalogue()).parts; } catch { info = {}; }
    }
  }

  function go(i) {
    if (i < 0 || i >= pages.length) return;
    if (pages[at]?.kind === "test" && i !== at) stopTest();
    if (pages[i].kind === "test") fixFor = null;
    at = i;
    render();
  }

  function renderDots() {
    dots.replaceChildren(...pages.map((p, i) => h("span", { class: ["wiz-dot", i < at && "done", i === at && "now"] })),
      h("span", { class: "wiz-dot-label", text: `${at + 1} of ${pages.length}` }));
  }

  async function render() {
    teardown();
    renderDots();
    const p = pages[at];
    back.disabled = at === 0;
    next.hidden = p.kind === "test";
    finish.hidden = p.kind !== "test";
    skip.hidden = p.kind !== "meet";
    page.replaceChildren(h("p", { class: "muted", text: "Getting things ready…" }));
    await ready();
    if (pages[at] !== p) return;
    if (p.kind === "meet") renderMeet(p);
    else if (p.kind === "wire") renderWire(p);
    else renderTest();
    (page.querySelector("h2") || page).setAttribute("tabindex", "-1");
  }

  // ----- Meet the parts -----
  function partArt(type, color) {
    const def = catalogue.types[type];
    if (!def) return null;
    const svg = svgEl("svg", { viewBox: `0 0 ${def.breadboard.width} ${def.breadboard.height}`, role: "img", "aria-label": info?.[type]?.name || type });
    const g = artContent(`part:${type}`, def.svg?.breadboard);
    if (def.colors) g.setAttribute("color", def.colors[color] || def.colors.red);
    svg.append(g);
    return svg;
  }
  function renderMeet(p) {
    const t = info?.[p.type] || {};
    const count = circuit.parts.filter((x) => x.type === p.type && (!partsOnly || partsOnly.includes(x.id))).length;
    const first = circuit.parts.find((x) => x.type === p.type);
    page.replaceChildren(
      h("h2", { text: `Meet the ${count > 1 ? t.plural || p.type : t.name || p.type}${count > 1 ? ` (you need ${count})` : ""}` }),
      h("div", { class: "wiz-meet" },
        h("div", { class: "wiz-meet-art" }, partArt(p.type, first?.color)),
        h("div", {},
          h("dl", {},
            h("dt", { text: "What it does" }), h("dd", { text: t.what || "" }),
            h("dt", { text: "Which leg is which?" }), h("dd", { text: t.legs || "" })),
          t.did_you_know ? h("div", { class: "wiz-fact" }, h("strong", { text: "Did you know? " }), t.did_you_know) : null)));
  }

  // ----- Wire it -----
  function renderWire(p) {
    const ws = project.wiring_steps[p.step - 1] || {};
    const host = h("div", { class: "wiz-drawing-host" });
    const toggle = h("button", { class: "btn small", type: "button", "aria-pressed": String(schematic),
      onclick: () => { schematic = !schematic; renderWire(p); } }, schematic ? "Show the breadboard" : "Show the schematic");
    const whole = h("button", { class: "btn small", type: "button", "aria-pressed": String(showAll),
      onclick: () => { showAll = !showAll; renderWire(p); } }, showAll ? "Show this step" : "Show the whole circuit");
    const fix = fixFor && fixFor.step === p.step ? h("div", { class: "wiz-fixit", role: "alert" },
      h("strong", { text: `Let's fix the ${fixFor.label}. Check these:` }),
      h("ul", {}, (FIXES[fixFor.type] || ["Check each wire against the drawing."]).map((s) => h("li", { text: s }))),
      h("p", { text: "When it looks right, go to Test it and press Test again." }),
      h("button", { class: "btn", type: "button", onclick: () => go(pages.findIndex((q) => q.kind === "test")) }, "Back to Test it")) : null;
    page.replaceChildren(
      h("h2", { text: `Step ${p.step}: ${ws.title || "Wiring"}` }),
      h("div", { class: "wiz-wire" },
        h("div", { class: "wiz-drawing" }, h("div", { class: "wiz-drawing-bar" }, toggle, whole), host),
        h("div", { class: "wiz-text" },
          fix,
          ...String(fillWiringText(ws.text || "", board, resolve)).split(/\n+/).map((t) => h("p", { text: t })),
          h("div", { class: "wiz-safety", role: "note" }, h("strong", { text: "⚠ Safety:" }), h("span", { text: SAFETY })))));
    const opts = { board, circuit, parts: catalogue, pins: resolve, step: p.step, showAll, names: info, controls: false };
    const view = schematic ? drawSchematic(host, opts) : drawBreadboard(host, opts);
    host.classList.add("cp-host");
    cleanup.push(() => view.destroy());
  }

  // ----- Test it -----
  function renderTest() {
    const hasParts = circuit.parts.some((p) => !p.type.startsWith("resistor") && (!partsOnly || partsOnly.includes(p.id)));
    if (!hasParts) {
      page.replaceChildren(h("h2", { text: "Nothing to test" }),
        h("p", { text: "This project has no parts to wire up. Plug your board in with its USB cable, and you're ready to start." }));
      finish.disabled = false;
      return;
    }
    if (!rp) {
      rp = createRunPanel({ board, project, circuit });
      cleanup.push(() => {}); // the run panel lives as long as the wizard
    }
    const status = h("p", { class: "wiz-status", role: "status" });
    const list = h("ul", { class: "wiz-rows", "aria-label": "Parts to test" });
    const test = h("button", { class: "btn default", type: "button" }, "Test");
    const portSel = h("select", { class: "input", "aria-label": "USB port" });
    const portRow = h("label", { class: "wiz-port", hidden: mode !== "real" }, "Port: ", portSel,
      h("button", { class: "btn small", type: "button", onclick: () => findPorts() }, "Look again"));
    const modeRadio = (value, label) => h("label", {}, h("input", { type: "radio", name: "wiz-mode", value, checked: mode === value,
      onchange: () => { stopTest(); mode = value; renderTest(); } }), ` ${label}`);
    const side = mode === "sim" ? rp.el : h("div", { class: "wiz-real" },
      h("p", { text: `Plug your ${board.short || board.name} into the laptop with its USB cable, choose its port, then press Test. ` +
        "ArduinoPath puts a test program on the board and listens to it." }), portRow);
    if (mode === "sim") rp.ready.then(() => { if (!rows) buildRows(); drawRows(); });
    page.replaceChildren(
      h("h2", { text: "Test it" }),
      h("div", { class: "wiz-mode", role: "radiogroup", "aria-label": "Test on" }, modeRadio("sim", "In the simulator"), modeRadio("real", "On my real board")),
      h("div", { class: "wiz-test" },
        h("div", {}, h("p", { text: "Press Test. Each light, sound or screen takes a turn: tick “I saw it work” when you see it. For buttons and sensors, do what the row asks." }),
          h("div", { class: "wiz-mode" }, test), status, list),
        side));
    portRow.hidden = mode !== "real";
    if (mode === "real") findPorts();

    async function findPorts() {
      try {
        const ports = await api.ports();
        const list = Array.isArray(ports) ? ports : ports?.ports || [];
        portSel.replaceChildren(...list.map((p) => new Option(portLabel(p), p.port)));
        const g = guessPort(list, board, localStorageGet("ap-port"));
        if (g) portSel.value = g;
        status.textContent = list.length ? "" : "No board found. Plug it in, then press Look again.";
      } catch (e) {
        status.textContent = e.message;
      }
    }

    function buildRows() {
      let parts = rp.bench ? rp.bench.testParts() : [];
      if (partsOnly) parts = parts.filter((p) => partsOnly.includes(p.id));
      const sketch = testSketch(parts, board);
      rows = new TestRows(sketch.rows, board.analog_max ?? 1023);
      rows.code = sketch.code;
    }

    function drawRows() {
      list.replaceChildren(...rows.rows.map((r) => {
        const mark = r.ok ? "✓" : testRunning ? "…" : r.signal || r.seen ? "?" : "✗";
        const hint = r.kind === "input"
          ? (r.ok ? "Working!" : r.prompt || "") + (r.value != null && !["dht", "keypad-4x4", "rfid-rc522"].includes(r.type) ? "" : r.value ? ` Reading: ${r.value}` : "")
          : r.ok ? "You saw it work." : r.signal ? "It's having its turn now. Did you see (or hear) it?" : "Wait for its turn, then tick the box.";
        const bar = r.level != null ? h("div", { class: "wiz-bar", "aria-hidden": "true" }, barFill(r.level)) : null;
        const confirm = r.kind === "output" ? h("label", { class: "wiz-confirm" },
          h("input", { type: "checkbox", checked: r.confirmed, onchange: (e) => { rows.confirm(r.id, e.target.checked); drawRows(); } }), " I saw it work") : null;
        const fix = !r.ok ? h("button", { class: "btn small", type: "button", onclick: () => fixIt(r) }, "Fix it") : null;
        return h("li", { class: ["wiz-row", r.ok ? "ok" : "bad"], "data-row": r.id },
          h("span", { class: "wiz-mark", "aria-hidden": "true", text: mark }),
          h("div", {}, h("div", { class: "wiz-row-name", text: r.label }), h("div", { class: "wiz-row-hint", text: hint }), bar),
          h("div", { class: "wiz-row-actions" }, confirm, fix));
      }));
      finish.disabled = !rows.allOk;
      if (rows.allOk) status.textContent = "Everything works. Great wiring! Press Start programming.";
    }
    function barFill(level) {
      const s = h("span");
      s.style.width = `${Math.round(level * 100)}%`; // CSSOM: the CSP blocks style="" attributes
      return s;
    }

    function onSerial(text) {
      const changed = rows.feed(text);
      if (changed.length || rows.hello) drawRows();
    }

    test.addEventListener("click", async () => {
      stopTest();
      if (!rows) buildRows();
      rows.restart();
      testRunning = true;
      drawRows();
      if (mode === "sim") {
        status.textContent = "Testing in the simulator. Use the controls on the drawing for buttons and sensors.";
        const off = rp.onSerial(onSerial);
        cleanup.push(off);
        const res = await rp.run(rows.code, { label: "Testing your wiring" });
        if (!res.ok) status.textContent = "The test couldn't start in the simulator.";
        testRunning = false;
        return;
      }
      const port = portSel.value;
      if (!port) { status.textContent = "Choose your board's USB port first."; testRunning = false; drawRows(); return; }
      localStorageSet("ap-port", port);
      status.className = "wiz-status";
      status.textContent = "Getting the test program ready…";
      try {
        const job = await upload(rows.code, board, "", port, (j) => {
          status.textContent = j.state === "compiling" ? "Getting the test program ready…" : j.state === "uploading" ? "Sending it to your board…" : status.textContent;
        });
        if (job.state !== "done") {
          status.className = "wiz-status bad";
          status.textContent = "The test program couldn't go onto your board. Check the USB cable and the port, then press Test again.";
          testRunning = false;
          drawRows();
          return;
        }
        status.textContent = "Listening to your board…";
        serial = openSerial(port, TEST_BAUD, {
          onData: onSerial,
          onClose: (reason) => { if (reason) status.textContent = reason; },
        });
      } catch (e) {
        status.className = "wiz-status bad";
        status.textContent = e.message;
      }
      testRunning = false;
      drawRows();
    });
  }

  function fixIt(r) {
    const part = circuit.parts.find((p) => p.id === r.id);
    fixFor = { label: r.label, type: r.type, step: part?.step };
    stopTest();
    const i = pages.findIndex((p) => p.kind === "wire" && p.step === part?.step);
    go(i >= 0 ? i : 0);
  }

  async function complete() {
    finish.disabled = true;
    try {
      if (!partsOnly) await save(project.id);
    } catch (e) {
      // The work is done even if the save fails; the wizard will just open again next time.
      console.warn("Couldn't save wiring done", e);
    }
    done = true;
    stopTest();
    rp?.destroy();
    dlg.close(true);
    onDone({ confirmed: true });
  }

  render();
  return { el: dlg.el, close: () => dlg.close(undefined) };
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
