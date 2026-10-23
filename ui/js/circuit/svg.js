// Small SVG helpers shared by the breadboard and schematic views.

const NS = "http://www.w3.org/2000/svg";

/** Makes an SVG element: svgEl("circle", { cx: 1, r: 2 }, child...). */
export function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
}


// ---------- art templates (each SVG parsed once per page) ----------

const templates = new Map();
let defsHolder = null;

/** Puts a part's <defs> (gradients...) into one hidden SVG shared by every view. */
export function sharedDefs() {
  if (defsHolder?.isConnected) return defsHolder;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  defsHolder = document.createElementNS(NS, "defs");
  svg.append(defsHolder);
  document.body.prepend(svg);
  return defsHolder;
}

/** The drawable content of an SVG (a <g>), parsed once and cloned for each use. */
export function artContent(key, svgText) {
  let t = templates.get(key);
  if (!t || !t.defsLive?.isConnected) {
    const doc = new DOMParser().parseFromString(svgText || "<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml");
    const root = doc.documentElement;
    const holder = sharedDefs();
    let defsLive = null;
    for (const d of [...root.children].filter((c) => c.localName === "defs")) {
      defsLive = holder.appendChild(document.importNode(d, true));
      d.remove();
    }
    const g = document.createElementNS(NS, "g");
    for (const c of [...root.children]) g.append(document.importNode(c, true));
    t = { g, defsLive: defsLive || holder };
    templates.set(key, t);
  }
  return t.g.cloneNode(true);
}

