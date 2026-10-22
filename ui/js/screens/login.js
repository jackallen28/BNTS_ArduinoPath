// The welcome screen, in the style of Vista's welcome screen: pick your name,
// or make a profile (first names and school). ArduinoPath runs on this
// laptop, so there's no password. "Wipe this laptop" opens the WIPE page.

import { api } from "../api.js";
import { h, icon, joinNames, clear, fill } from "../dom.js";
import { showAbout } from "../dialogs/about.js";
import { state } from "../state.js";

export function loginScreen(root, { onLoggedIn, openWipe }) {
  const stage = h("main", { class: "logon-stage", id: "main" });
  const screen = h("div", { class: "logon" },
    h("header", { class: "logon-brand" },
      icon("app", "icon-48"),
      h("div", {},
        h("div", { class: "logon-title", text: "ArduinoPath" }),
        h("div", { class: "logon-school", text: state.info?.school ?? "" }))),
    stage,
    h("footer", { class: "logon-footer" },
      h("button", { class: "logon-link", type: "button", onclick: showAbout }, icon("about"), " About ArduinoPath"),
      h("button", { class: "logon-link", type: "button", onclick: openWipe }, icon("warn"), " Wipe this laptop")),
    h("img", { class: "bnts-pixels", src: "img/bnts-pixels.svg", alt: "" }));
  clear(root).append(screen);

  let students = [];

  function show(...children) {
    fill(stage, ...children);
    const focus = stage.querySelector("[autofocus]") || stage.querySelector("button");
    if (focus) focus.focus();
  }

  function errorNote(err) {
    return h("div", { class: "logon-message", role: "alert" }, icon("warn"), h("span", { text: err.message }));
  }

  async function pickName() {
    try {
      students = await api.students();
    } catch (err) {
      show(h("h1", { text: "Welcome!" }), errorNote(err), h("button", { class: "pill", onclick: pickName }, "Try again"));
      return;
    }
    if (students.length === 0) {
      newProfile();
      return;
    }
    const message = h("div", { class: "logon-message", role: "alert", hidden: true });
    const tiles = students.map((s) =>
      h("button", { class: "tile user-tile", type: "button", onclick: () => open(s) },
        h("span", { class: "tile-frame" }, avatar(s.names)),
        h("span", { class: "tile-name", text: joinNames(s.names) }),
        h("span", { class: "tile-sub", text: s.school })));
    tiles.push(h("button", { class: "tile new-tile", type: "button", onclick: newProfile },
      h("span", { class: "tile-frame" }, icon("plus", "icon-48")),
      h("span", { class: "tile-name", text: "I'm new here" }),
      h("span", { class: "tile-sub", text: "Make a profile" })));
    show(
      h("h1", { text: "Welcome! Who are you?" }),
      h("p", { class: "logon-lead", text: "Pick your name. New? Make a profile." }),
      message,
      h("div", { class: "tiles" }, tiles));

    async function open(student) {
      try {
        onLoggedIn(await api.login(student.id));
      } catch (err) {
        message.replaceChildren(icon("warn"), h("span", { text: err.message }));
        message.hidden = false;
      }
    }
  }

  function newProfile() {
    newProfileWizard(stage, {
      first: students.length === 0,
      schools: [...new Set(students.map((s) => s.school))],
      onCancel: students.length ? pickName : null,
      onCreated: onLoggedIn,
    });
  }

  pickName();
}

/** Initials in a coloured circle, for a user tile. */
export function avatar(names) {
  const initials = names.map((n) => [...n][0]).join("").slice(0, 4).toUpperCase();
  const hue = [...names.join("")].reduce((a, c) => (a * 31 + c.codePointAt(0)) % 360, 7);
  const el = h("span", { class: `avatar avatar-${initials.length}`, "aria-hidden": "true", text: initials });
  el.style.setProperty("--avatar-hue", String(hue));
  return el;
}

/** The "I'm new here" page: first names (up to 4, for students sharing a kit) and school. */
function newProfileWizard(stage, { first, schools, onCancel, onCreated }) {
  const names = [""];
  let school = schools.length === 1 ? schools[0] : "";
  const pageHolder = h("div", { class: "wizard-page" });
  const buttons = h("div", { class: "dialog-buttons" });
  const win = h("section", { class: "window wizard", "aria-labelledby": "wizard-title" },
    h("div", { class: "titlebar" }, icon("user", "app-icon"), h("span", { class: "title", id: "wizard-title", text: "Make your profile" })),
    h("div", { class: "window-body" }, pageHolder, buttons));
  clear(stage).append(win);

  function pageNames(error) {
    const list = h("div", { class: "name-list" });
    const schoolInput = h("input", {
      class: "input big", id: "school", list: "school-list", autocomplete: "off", maxlength: 60, value: school,
      oninput: (e) => { school = e.target.value; },
    });
    function renderNames() {
      fill(list, names.map((n, i) => h("div", { class: "name-row" },
        h("input", {
          class: "input big", value: n, maxlength: 30, autocomplete: "off", spellcheck: "false",
          "aria-label": i === 0 ? "First name" : `First name ${i + 1}`, autofocus: i === names.length - 1 ? true : null,
          oninput: (e) => { names[i] = e.target.value; },
        }),
        names.length > 1 ? h("button", {
          class: "btn remove-name", type: "button", "aria-label": "Remove this name", title: "Remove",
          onclick: () => { names.splice(i, 1); renderNames(); },
        }, "✕") : null)));
      addBtn.hidden = names.length >= 4;
    }
    const addBtn = h("button", { class: "link-button", type: "button", onclick: () => { names.push(""); renderNames(); list.querySelector("div:last-child input").focus(); } },
      "+ Add another name (sharing a kit)");
    renderNames();
    const create = h("button", { class: "btn default", type: "submit", form: "names-form" }, "Next");
    const form = h("form", {
      id: "names-form",
      onsubmit: async (e) => {
        e.preventDefault();
        const filled = names.map((n) => n.trim()).filter(Boolean);
        if (filled.length === 0) return pageNames("Type your first name.");
        if (!school.trim()) return pageNames("Type your school's name.");
        names.splice(0, names.length, ...filled);
        create.disabled = true;
        try {
          onCreated(await api.createStudent({ names, school: school.trim() }));
        } catch (err) {
          pageNames(err.message);
        }
      },
    },
    h("h2", { text: first ? "Welcome to ArduinoPath!" : "Welcome!" }),
    h("div", { class: "field" },
      h("label", { text: "Your first name" }),
      list,
      h("div", { class: "small muted", text: "Just first names, no last names. Sharing a laptop and kit? Add everyone's first name (up to 4)." }),
      addBtn),
    h("div", { class: "field" },
      h("label", { for: "school", text: "Your school" }),
      schoolInput,
      h("datalist", { id: "school-list" }, schools.map((s) => h("option", { value: s })))),
    error ? h("div", { class: "note error", role: "alert" }, icon("warn"), h("span", { text: error })) : null);
    fill(pageHolder, form);
    fill(buttons,
      onCancel ? h("button", { class: "btn", type: "button", onclick: onCancel }, "Back") : null,
      create);
    const focus = pageHolder.querySelector("[autofocus]") || pageHolder.querySelector("input, button");
    if (focus) focus.focus();
  }

  pageNames();
}
