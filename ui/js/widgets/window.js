// Vista window chrome: the main app window, dialogs, message boxes and
// balloon tips.

import { h, icon } from "../dom.js";

/**
 * The main window, filling the browser. The title bar, toolbar and status
 * bar stay put while the page scrolls underneath, so the mouse wheel works
 * like on any website.
 */
export function appWindow({ title, toolbar = [], body, status = [], className = "" }) {
  return h("div", { class: ["window", "app-window", className] },
    h("header", { class: "app-chrome" },
      h("div", { class: "titlebar" },
        icon("app", "app-icon"),
        h("span", { class: "title", text: title ? `${title} - ArduinoPath` : "ArduinoPath" })),
      h("nav", { class: "toolbar", "aria-label": "Toolbar" }, toolbar)),
    h("div", { class: "window-body" }, body),
    h("footer", { class: "statusbar", role: "status" }, status));
}

/** A toolbar button with an icon. */
export function tool(iconName, label, onclick, { disabled = false, title, id } = {}) {
  return h("button", { class: "tool", type: "button", onclick, disabled, title, id },
    icon(iconName), h("span", { text: label }));
}

export function separator() {
  return h("span", { class: "separator", role: "separator" });
}

export function spacer() {
  return h("span", { class: "spacer" });
}

let openDialogs = 0;
const dialogStack = []; // only the top dialog answers Escape and Tab

/**
 * Opens a modal dialog. Returns { el, body, close(result) } and a promise
 * (`result`) that resolves with the value passed to close().
 * Escape and the red ✕ close it with `undefined`.
 */
export function openDialog({ title, content = [], buttons = [], wide = false, iconName = "app", onOpen }) {
  const previous = document.activeElement;
  let resolve;
  const result = new Promise((r) => (resolve = r));
  const titleId = `dlg-title-${++openDialogs}`;

  const body = h("div", { class: "window-body" }, content,
    buttons.length ? h("div", { class: "dialog-buttons" }, buttons) : null);
  const win = h("div", { class: ["window", "dialog", wide && "wide"], role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
    h("div", { class: "titlebar" },
      icon(iconName, "app-icon"),
      h("span", { class: "title", id: titleId, text: title }),
      h("div", { class: "caption-buttons" },
        h("button", { class: "caption-close", type: "button", "aria-label": "Close", title: "Close", onclick: () => close(undefined) }, "✕"))),
    body);
  const backdrop = h("div", { class: "modal-backdrop" }, win);

  const me = {};
  function onKey(e) {
    if (dialogStack[dialogStack.length - 1] !== me) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      close(undefined);
    } else if (e.key === "Tab") {
      trapFocus(e, win);
    }
  }

  function close(value) {
    const i = dialogStack.indexOf(me);
    if (i < 0) return;
    dialogStack.splice(i, 1);
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    if (previous && previous.focus) previous.focus();
    resolve(value);
  }

  dialogStack.push(me);
  document.addEventListener("keydown", onKey, true);
  document.getElementById("modal-root").append(backdrop);
  const first = win.querySelector("[autofocus]") || win.querySelector(".dialog-buttons .default") ||
    win.querySelector("button:not(.caption-close), input, select, textarea, a[href]");
  (first || win).focus();
  if (onOpen) onOpen({ el: win, body, close });
  return { el: win, body, close, result };
}

function trapFocus(e, root) {
  const items = [...root.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** A Vista-style message box. Resolves with the id of the button pressed. */
export function messageBox({ title = "ArduinoPath", instruction, text, kind = "info", buttons = [{ id: "ok", label: "OK", default: true }] }) {
  let dlg;
  const btns = buttons.map((b) => h("button", {
    class: ["btn", b.default && "default"],
    type: "button",
    onclick: () => dlg.close(b.id),
  }, b.label));
  const iconName = { info: "about", warn: "warn", error: "error", question: "about" }[kind] || "about";
  dlg = openDialog({
    title,
    buttons: btns,
    content: h("div", { class: "message-box" },
      icon(iconName, "icon-32"),
      h("div", {},
        instruction ? h("div", { class: "instruction", text: instruction }) : null,
        [].concat(text || []).map((t) => (t instanceof Node ? t : h("p", { text: t }))))),
  });
  return dlg.result.then((v) => v ?? buttons.find((b) => b.cancel)?.id ?? buttons[buttons.length - 1].id);
}

/** Shows a balloon tip under an element. Returns a function that removes it. */
export function balloon(target, { title, text, iconName = "about", timeout = 8000 }) {
  const tip = h("div", { class: "balloon", role: "status" },
    title ? h("div", { class: "balloon-title" }, icon(iconName), h("span", { text: title })) : null,
    h("div", { text }));
  document.body.append(tip);
  const r = target.getBoundingClientRect();
  tip.style.left = `${Math.max(8, r.left + window.scrollX + r.width / 2 - 30)}px`;
  tip.style.top = `${r.bottom + window.scrollY + 10}px`;
  const remove = () => tip.remove();
  if (timeout) setTimeout(remove, timeout);
  tip.addEventListener("click", remove);
  return remove;
}
