// A simple code editor: a text area with a line-number gutter and a glassy
// current-line highlight, in the style of a Vista-era IDE. (CodeMirror,
// vendored, replaces this when the Coach and syntax colours arrive.)
//
// Tab indents. Press Escape first to Tab out of the editor.

import { h } from "../dom.js";

const INDENT = "  ";

export function codeEditor({ value = "", onChange = () => {}, onCursor = () => {}, label = "Code" } = {}) {
  const gutter = h("div", { class: "editor-gutter", "aria-hidden": "true" });
  const line = h("div", { class: "editor-line", "aria-hidden": "true" });
  const area = h("textarea", {
    class: "editor-text code",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    wrap: "off",
    "aria-label": label,
  });
  area.value = value;
  const el = h("div", { class: "editor" }, gutter, h("div", { class: "editor-main" }, line, area));
  let escaped = false;
  let lineCount = 0;

  function cursor() {
    const before = area.value.slice(0, area.selectionStart);
    const row = before.split("\n").length;
    const col = before.length - before.lastIndexOf("\n");
    return { row, col };
  }

  function refresh() {
    const n = area.value.split("\n").length;
    if (n !== lineCount) {
      lineCount = n;
      gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
    }
    const { row, col } = cursor();
    const lh = parseFloat(getComputedStyle(area).lineHeight) || 18;
    const pad = parseFloat(getComputedStyle(area).paddingTop) || 0;
    line.style.transform = `translateY(${pad + (row - 1) * lh - area.scrollTop}px)`;
    line.style.height = `${lh}px`;
    gutter.scrollTop = area.scrollTop;
    onCursor(row, col);
  }

  function insert(text) {
    // execCommand keeps the browser's undo history; setRangeText is the fallback.
    if (!document.execCommand("insertText", false, text)) {
      area.setRangeText(text, area.selectionStart, area.selectionEnd, "end");
      area.dispatchEvent(new Event("input"));
    }
  }

  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      escaped = true;
      return;
    }
    if (e.key === "Tab" && !escaped && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const start = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
      if (e.shiftKey) {
        if (area.value.startsWith(INDENT, start)) {
          area.setSelectionRange(start, start + INDENT.length);
          insert("");
        }
      } else {
        insert(INDENT);
      }
      return;
    }
    escaped = false;
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      // Keep the indent of the line, and indent one more after a "{".
      const start = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
      const current = area.value.slice(start, area.selectionStart);
      let indent = current.match(/^[ \t]*/)[0];
      if (/\{\s*$/.test(current)) indent += INDENT;
      e.preventDefault();
      insert("\n" + indent);
    } else if (e.key === "}" && !e.ctrlKey && !e.altKey) {
      // Outdent a closing brace typed on an empty, indented line.
      const start = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
      const current = area.value.slice(start, area.selectionStart);
      if (/^[ \t]+$/.test(current) && current.endsWith(INDENT) && area.selectionStart === area.selectionEnd) {
        e.preventDefault();
        area.setSelectionRange(area.selectionStart - INDENT.length, area.selectionStart);
        insert("}");
      }
    }
  });
  area.addEventListener("input", () => { refresh(); onChange(area.value); });
  for (const ev of ["click", "keyup", "select", "focus"]) area.addEventListener(ev, refresh);
  area.addEventListener("scroll", refresh);
  requestAnimationFrame(refresh);

  return {
    el,
    get value() { return area.value; },
    set value(v) { area.value = v; refresh(); },
    focus() { area.focus(); },
    /** Puts the cursor at the start of a line (from 1) and scrolls to it. */
    goToLine(n) {
      const lines = area.value.split("\n");
      const row = Math.max(1, Math.min(n, lines.length));
      const at = lines.slice(0, row - 1).reduce((sum, l) => sum + l.length + 1, 0);
      area.focus();
      area.setSelectionRange(at, at + lines[row - 1].length);
      const lh = parseFloat(getComputedStyle(area).lineHeight) || 18;
      area.scrollTop = Math.max(0, (row - 4) * lh);
      refresh();
    },
  };
}
