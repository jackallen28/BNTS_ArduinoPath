// The Serial Monitor and Serial Plotter, in a Vista console window style,
// shared by the simulator and real boards; plus an Output tab for compiler
// and upload messages.

import { h, icon } from "../dom.js";
import { PlotData } from "../plotter.js";

const MAX_CHARS = 200_000;
const COLOURS = ["#2fd4dc", "#f2c94c", "#eb5757", "#6fcf97", "#bb6bd9", "#f2994a"];

/**
 * @param {object} o
 * @param {(text: string) => void} o.onSend   the student pressed Send
 * @param {(baud: number) => void} [o.onBaud] the speed changed (real boards)
 */
export function serialConsole({ onSend, onBaud = () => {} }) {
  const out = h("pre", { class: "console-out code", "aria-live": "polite", "aria-label": "Serial Monitor output", tabindex: "0" });
  const input = h("input", { class: "input code console-in", "aria-label": "Text to send", placeholder: "Type a message for the board, then press Enter", autocomplete: "off" });
  const ending = h("select", { class: "select", "aria-label": "Line ending" },
    h("option", { value: "\n", text: "New line" }),
    h("option", { value: "", text: "No line ending" }),
    h("option", { value: "\r\n", text: "Both NL & CR" }));
  const baud = h("select", { class: "select", "aria-label": "Speed (baud)", onchange: () => onBaud(Number(baud.value)) },
    [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400].map((b) =>
      h("option", { value: String(b), text: `${b} baud`, selected: b === 9600 || null })));
  const autoscroll = h("input", { type: "checkbox", checked: true });
  const status = h("span", { class: "console-status", text: "" });
  const canvas = h("canvas", { class: "plot-canvas", "aria-label": "Serial Plotter graph", role: "img" });
  const legend = h("div", { class: "plot-legend" });
  const output = h("pre", { class: "console-out output code", "aria-label": "Compiler and upload messages", tabindex: "0" });

  const send = () => {
    const text = input.value;
    input.value = "";
    onSend(text + ending.value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  });

  const tabs = ["Serial Monitor", "Serial Plotter", "Output"];
  const panes = [
    h("div", { class: "console-pane" }, out,
      h("div", { class: "console-bar" }, input, ending, h("button", { class: "btn", type: "button", onclick: send }, "Send"))),
    h("div", { class: "console-pane plot", hidden: true }, canvas, legend),
    h("div", { class: "console-pane", hidden: true }, output),
  ];
  const tabButtons = tabs.map((name, i) => h("button", {
    class: "tab", type: "button", role: "tab", "aria-selected": i === 0 ? "true" : "false",
    onclick: () => select(i),
  }, name));
  let current = 0;
  function select(i) {
    current = i;
    tabButtons.forEach((b, j) => b.setAttribute("aria-selected", String(i === j)));
    panes.forEach((p, j) => { p.hidden = i !== j; });
    if (i === 1) draw();
  }

  const el = h("section", { class: "console", "aria-label": "Serial Monitor" },
    h("div", { class: "console-head" },
      h("div", { class: "tabs", role: "tablist" }, tabButtons),
      status,
      h("label", { class: "console-opt" }, autoscroll, " Scroll"),
      baud,
      h("button", { class: "btn small", type: "button", title: "Clear", onclick: () => clear() }, "Clear")),
    panes);

  // Text arrives in pieces; draw at most once a frame.
  let pending = "";
  let partial = "";
  let frame = 0;
  const plot = new PlotData(300);
  function append(text) {
    pending += text;
    partial += text;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop();
    for (const l of lines) plot.add(l);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function flush() {
    frame = 0;
    if (!pending) return;
    let text = out.textContent + pending.replace(/\r(?!\n)/g, "");
    pending = "";
    if (text.length > MAX_CHARS) text = text.slice(text.length - MAX_CHARS * 0.8);
    out.textContent = text;
    if (autoscroll.checked) out.scrollTop = out.scrollHeight;
    if (current === 1) draw();
  }
  function clear() {
    pending = partial = "";
    out.textContent = "";
    plot.clear();
    draw();
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const ht = rect.height;
    ctx.fillStyle = "#0c0c0c";
    ctx.fillRect(0, 0, w, ht);
    const { min, max } = plot.range();
    const left = 44;
    ctx.strokeStyle = "#2a2a2a";
    ctx.fillStyle = "#9a9a9a";
    ctx.font = "11px Consolas, monospace";
    for (let i = 0; i <= 4; i++) {
      const y = 8 + (ht - 16) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      const v = max - (max - min) * (i / 4);
      ctx.fillText(Math.abs(v) >= 1000 ? v.toFixed(0) : String(+v.toFixed(2)), 2, y + 4);
    }
    let k = 0;
    legend.replaceChildren();
    for (const [label, data] of plot.series) {
      const colour = COLOURS[k++ % COLOURS.length];
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      data.forEach((v, i) => {
        if (v == null) {
          started = false;
          return;
        }
        const x = left + (w - left) * (i / Math.max(1, plot.max - 1));
        const y = 8 + (ht - 16) * ((max - v) / (max - min));
        if (started) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        started = true;
      });
      ctx.stroke();
      const swatch = h("span", { class: "plot-swatch" });
      swatch.style.background = colour; // set from script: the CSP blocks style="" attributes
      legend.append(h("span", { class: "plot-key" }, swatch, label));
    }
    if (!plot.series.size) {
      ctx.fillStyle = "#7a7a7a";
      ctx.fillText("Print numbers with Serial.println() to draw a graph.", left + 8, ht / 2);
    }
  }

  return {
    el,
    append,
    clear,
    /** Compiler / upload messages for the Output tab. */
    setOutput(text) {
      output.textContent = text;
      output.scrollTop = output.scrollHeight;
    },
    showOutput() { select(2); },
    showMonitor() { select(0); },
    setStatus(text, kind = "") {
      status.textContent = text;
      status.className = `console-status ${kind}`;
    },
    /** Real boards choose a speed; the simulator doesn't need one. */
    setBaudVisible(show) { baud.hidden = !show; },
    get baud() { return Number(baud.value); },
    set baud(b) { baud.value = String(b); },
    focus() { input.focus(); },
    destroy() { if (frame) cancelAnimationFrame(frame); },
  };
}
