// The Blocks view: Blockly (vendored in ui/vendor/blockly, Apache-2.0),
// loaded the first time a student picks Blocks. Under the blocks, the C++
// they make, so students see how blocks and text match up.
//
//   const view = await blocksView({ project, board, onChange: (code, state) => ... });
//   view.show(code, savedState)   // the code as blocks (savedState keeps their layout)
//   view.el                        // put it on the page

import { h } from "../dom.js";
import { toBlocks, toCode } from "./cpp.js";
import { defineBlocks, toolbox } from "./defs.js";
import { pinPlan, rolesIn } from "../sim/pins.js";

let loading = null;

function script(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} didn't load`));
    document.head.append(s);
  });
}

/** Loads Blockly once (about 1 MB, so not until a student picks Blocks). */
export function loadBlockly() {
  if (!loading) {
    loading = (async () => {
      if (!document.querySelector("link[data-blockly]")) {
        document.head.append(h("link", { rel: "stylesheet", href: "/vendor/blockly/blockly.css", "data-blockly": "" }));
      }
      await script("/vendor/blockly/blockly.min.js");
      await script("/vendor/blockly/en.js");
      const Blockly = globalThis.Blockly;
      // The renderer's CSS is in blockly.css already: don't add a <style> (the CSP refuses it).
      Blockly.blockRendering.ConstantProvider.prototype.injectCSS_ = () => {};
      // Connection highlights start hidden by blockly.css, not by a style="" the CSP refuses.
      Blockly.blockRendering.PathObject.prototype.addConnectionHighlight = function (conn, path, offset, rtl) {
        const transform = `translate(${offset.x}, ${offset.y})${rtl ? " scale(-1 1)" : ""}`;
        let el = this.connectionHighlights.get(conn);
        if (el) {
          el.setAttribute("d", path);
          el.setAttribute("transform", transform);
          return el;
        }
        el = Blockly.utils.dom.createSvgElement(Blockly.utils.Svg.PATH, { id: conn.id, class: "blocklyHighlightedConnectionPath", d: path, transform }, this.svgRoot);
        this.connectionHighlights.set(conn, el);
        return el;
      };
      defineBlocks(Blockly);
      return globalThis.Blockly;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** Names a toolbox offers: the project's pins, the code's variables and servos. */
export function namesIn(code, project, board) {
  const plan = project && board ? pinPlan(project, board) : {};
  const fromCircuit = (project?.circuit?.wires || []).flatMap((w) => [w.from, w.to]).filter((e) => /^pin:/.test(e || "")).map((e) => e.slice(4));
  const pins = [...new Set([...fromCircuit, ...rolesIn(code, plan)])];
  const variables = [...new Set([...code.matchAll(/\b(?:int|long|float|double|bool|byte|String|unsigned long)\s+(\w+)\s*=/g)].map((m) => m[1]))];
  const servos = [...new Set([...code.matchAll(/\bServo\s+(\w+)\s*;/g)].map((m) => m[1]))];
  return { pins, variables, servos };
}

export async function blocksView({ project = null, board = null, onChange = () => {} } = {}) {
  const Blockly = await loadBlockly();
  const area = h("div", { class: "blocks-area", role: "application", "aria-label": "Blocks: drag blocks from the list on the left" });
  const codeOut = h("pre", { class: "blocks-code code", "aria-label": "Your blocks as C++ code" });
  const el = h("div", { class: "blocks-view" },
    area,
    h("details", { class: "blocks-code-box", open: "" },
      h("summary", { text: "Your blocks as C++ code (what goes on the board)" }),
      codeOut));

  const theme = Blockly.Theme.defineTheme("arduinopath", {
    base: Blockly.Themes.Classic,
    fontStyle: { family: '"Segoe UI", Tahoma, sans-serif', size: 11 },
    componentStyles: { workspaceBackgroundColour: "#fbfcfe", toolboxBackgroundColour: "#eef3f9", flyoutBackgroundColour: "#e4ebf3", flyoutOpacity: 0.96, scrollbarColour: "#a7b9cd" },
    startHats: true,
  });
  let ws = null;
  let quiet = 0; // > 0 while the view itself is loading blocks
  let timer = 0;
  let names = { pins: [], variables: [], servos: [] };

  function create() {
    ws = Blockly.inject(area, {
      toolbox: toolbox(names),
      renderer: "zelos",
      theme,
      css: false, // the CSS is ui/vendor/blockly/blockly.css (ArduinoPath's CSP allows no inline styles)
      media: "/vendor/blockly/media/",
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2, minScale: 0.4 },
      move: { scrollbars: true, drag: true, wheel: true },
      grid: { spacing: 24, length: 2, colour: "#dfe6ee", snap: false },
    });
    ws.addChangeListener((e) => {
      if (quiet || e.isUiEvent) return;
      clearTimeout(timer);
      timer = setTimeout(emit, 120);
    });
    new ResizeObserver(() => { if (ws && area.offsetWidth) Blockly.svgResize(ws); }).observe(area);
  }

  function state() { return Blockly.serialization.workspaces.save(ws); }

  function emit() {
    const st = state();
    const code = toCode(st, { project, board });
    codeOut.textContent = code;
    const next = namesIn(code, project, board);
    if (JSON.stringify(next) !== JSON.stringify(names)) { names = next; ws.updateToolbox(toolbox(names)); }
    onChange(code, st);
  }

  /** Shows `code` as blocks. A saved layout is used when it still makes the same code. */
  function show(code, saved = null) {
    if (!ws) create();
    names = namesIn(code, project, board);
    ws.updateToolbox(toolbox(names));
    const same = saved && toCode(saved, { project, board }) === code;
    quiet++;
    try {
      Blockly.Events.disable();
      ws.clear();
      Blockly.serialization.workspaces.load(same ? saved : toBlocks(code), ws);
      if (!same) ws.cleanUp();
    } finally {
      Blockly.Events.enable();
      quiet--;
    }
    ws.scrollCenter();
    codeOut.textContent = toCode(state(), { project, board });
    return codeOut.textContent;
  }

  return {
    el,
    show,
    /** The blocks' C++ now. */
    code: () => (ws ? toCode(state(), { project, board }) : ""),
    resize() { if (ws) Blockly.svgResize(ws); },
    destroy() { clearTimeout(timer); ws?.dispose(); ws = null; },
  };
}
