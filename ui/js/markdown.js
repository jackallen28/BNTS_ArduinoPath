// A small, safe Markdown for step instructions and hints: paragraphs,
// **bold**, *italics*, `code`, bullet and numbered lists, and ``` code
// blocks. parse() is pure (tested in Node); render() builds DOM nodes from
// text, never HTML, so content can't inject anything into the page.

/** Splits a line into text, **strong**, *em* and `code` pieces. */
export function inline(text) {
  const out = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("`")) out.push({ type: "code", text: t.slice(1, -1) });
    else if (t.startsWith("**")) out.push({ type: "strong", text: t.slice(2, -2) });
    else out.push({ type: "em", text: t.slice(1, -1) });
    last = m.index + t.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/**
 * Text → blocks: { type: "p", inlines } | { type: "ul"|"ol", items: [inlines] }
 * | { type: "code", text }.
 */
export function parse(text) {
  const blocks = [];
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let para = [];
  let list = null;
  const endPara = () => {
    if (para.length) blocks.push({ type: "p", inlines: inline(para.join(" ")) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      endPara();
      endList();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      endPara();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        endList();
        list = { type, items: [] };
      }
      list.items.push(inline((bullet || numbered)[1]));
      continue;
    }
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/** Builds DOM nodes for text (in the browser). */
export function render(text, h) {
  const inl = (pieces) => pieces.map((p) =>
    p.type === "text" ? p.text : h(p.type === "code" ? "code" : p.type === "strong" ? "strong" : "em", { text: p.text }));
  return parse(text).map((b) => {
    if (b.type === "p") return h("p", {}, inl(b.inlines));
    if (b.type === "code") return h("pre", { class: "code-block" }, h("code", { text: b.text }));
    return h(b.type, {}, b.items.map((it) => h("li", {}, inl(it))));
  });
}
