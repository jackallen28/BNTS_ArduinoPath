// Small helpers for building the page. Text always goes in as text nodes,
// never as HTML, so a student's name can't break the page.

const SVG = "http://www.w3.org/2000/svg";

/**
 * h("button", { class: "btn", onclick: fn, disabled: true }, "Text", child)
 * Props starting with "on" become event listeners; class, text and
 * dataset/aria-* are handled; everything else is an attribute.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
    } else if (key === "text") {
      el.textContent = value;
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (key === "value" && "value" in el) {
      el.value = value;
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** An icon from the sprite: icon("save"), icon("p-cat", "icon-48"). */
export function icon(name, cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#${/^[ip]-/.test(name) ? name : "i-" + name}`);
  svg.append(use);
  return svg;
}

/** Puts the SVG sprites into the page once, so icons can use #ids. */
export async function loadSprites(urls) {
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.position = "absolute";
  holder.style.width = "0";
  holder.style.height = "0";
  holder.style.overflow = "hidden";
  const parser = new DOMParser();
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url);
      const doc = parser.parseFromString(await res.text(), "image/svg+xml");
      const svg = doc.documentElement;
      if (svg.nodeName === "svg") holder.append(document.importNode(svg, true));
    } catch {
      // Icons are decoration: carry on without them.
    }
  }));
  document.body.prepend(holder);
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Replaces el's children, skipping null / false (unlike replaceChildren). */
export function fill(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** "Mia", "Mia and Leo", "Mia, Leo and Ava" */
export function joinNames(names) {
  if (!names || names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Saves a Blob as a download. */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
