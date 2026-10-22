// The project picker. Free Play is the first box; every project is open
// from day one. Tiers are only a guide: a colour badge, a filter and
// "Good to try first" tips.

import { api } from "../api.js";
import { h, icon, clear, fill, joinNames } from "../dom.js";
import { appWindow, tool, separator, spacer } from "../widgets/window.js";
import { saveMyWork } from "../dialogs/settings.js";
import { state, board, tier, projectSuits, missingFromKit, partsSummary, partName } from "../state.js";

const FILTER_KEY = "arduinopath.picker.filter";

export function pickerScreen(root, { openSettings, logOut, openProject }) {
  let filter = loadFilter();
  let progress = new Map();

  const grid = h("div", { class: "project-grid", id: "projects" });
  const nav = h("nav", { class: "nav-pane", "aria-label": "Filter projects" });
  const greeting = h("div", { class: "picker-head" });
  const statusBoard = h("span", { class: "cell" });
  const statusHelp = h("span", { class: "cell" });

  const win = appWindow({
    title: "Projects",
    toolbar: [
      tool("settings", "Settings", () => openSettings({ onSaved: render })),
      separator(),
      tool("save", "Save my work", saveMyWork),
      tool("open", "Open my work", () => openSettings({ tab: "work", onSaved: render })),
      separator(),
      tool("about", "About", () => openSettings({ tab: "about" })),
      spacer(),
      h("span", { class: "toolbar-user" }, icon("user"), h("span", { text: joinNames(state.me.student.names) })),
      tool("logout", "Log out", logOut),
    ],
    body: h("div", { class: "split" }, nav, h("main", { class: "content", id: "main" }, greeting, grid)),
    status: [statusBoard, statusHelp, h("span", { class: "cell grow" }), h("span", { class: "cell", text: state.info?.school ?? "" })],
  });
  clear(root).append(win);

  function loadFilter() {
    try {
      return JSON.parse(localStorage.getItem(FILTER_KEY)) || { tier: "all", mine: false };
    } catch {
      return { tier: "all", mine: false };
    }
  }

  function saveFilter() {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
    } catch {
      // Not important.
    }
  }

  function render() {
    const b = board();
    const tiers = state.catalogue.tiers;
    fill(nav,
      h("div", { class: "nav-title", text: "Show" }),
      h("ul", { class: "nav-list", role: "listbox", "aria-label": "Tier" },
        [{ id: "all", name: "All projects" }, ...tiers].map((t) => h("li", {
          class: ["nav-item", "selectable", filter.tier === t.id && "selected"],
          role: "option",
          tabindex: "0",
          "aria-selected": String(filter.tier === t.id),
          onclick: () => { filter.tier = t.id; saveFilter(); render(); },
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } },
        }, t.id === "all" ? icon("app") : h("span", { class: `tier-dot tier-${t.id}` }), h("span", { text: t.name })))),
      h("label", { class: "check nav-check" },
        h("input", { type: "checkbox", checked: filter.mine, onchange: (e) => { filter.mine = e.target.checked; saveFilter(); render(); } }),
        h("span", { text: `Only ones that work with my ${b?.short ?? "board"}` })));

    fill(greeting,
      h("h1", { text: `Hi ${joinNames(state.me.student.names)}! What would you like to make?` }),
      h("p", { class: "muted" },
        "Every project is open, in any order. Each one starts with the Wiring Wizard, then you code it one part at a time. ",
        b ? h("span", { class: "board-chip" }, icon("board"), ` Your board: ${b.name}`) : null));

    const anyDone = [...progress.values()].some((p) => p.data?.completed);
    const projects = state.catalogue.projects.filter((p) =>
      (filter.tier === "all" || p.tier === filter.tier) && (!filter.mine || projectSuits(p, b)));
    const cards = [];
    if (filter.tier === "all") cards.push(freePlayCard());
    for (const p of projects) cards.push(projectCard(p, b, anyDone));
    if (projects.length === 0) cards.push(h("p", { class: "muted", text: "No projects here work with your board. Untick the box to see them all." }));
    fill(grid, cards);

    statusBoard.replaceChildren(icon("board"), `Board: ${b?.name ?? "none"}`);
    statusHelp.textContent = `Help: ${({ beginner: "Beginner", moderate: "Moderate", advanced: "Advanced" })[state.me.settings.help_level] ?? "not set"}`;
  }

  function freePlayCard() {
    const started = progress.has("freeplay");
    return h("button", { class: "card freeplay-card", type: "button", onclick: () => openProject("freeplay") },
      icon("freeplay", "icon-48"),
      h("span", { class: "card-body" },
        h("span", { class: "card-title", text: "Free Play" }),
        h("span", { class: "card-intro", text: "Build anything you like! Add parts, write code, and try your own ideas." }),
        h("span", { class: "card-intro muted", text: "...or pick one of the projects below for step-by-step help." })),
      h("span", { class: "card-go pill" }, started ? "Keep going" : "Start"));
  }

  // "an ESP32 board", "an Arduino (Uno, Nano or Mega)", "a NodeMCU"...
  function boardNeed(key) {
    const words = { all: "any board", avr: "an Arduino (Uno, Nano or Mega)", esp: "an ESP board", esp8266: "an ESP8266 board", esp32: "an ESP32 board" };
    if (words[key]) return words[key];
    const name = state.catalogue.boards.find((x) => x.id === key)?.short ?? key;
    return (/^[AEIO]/i.test(name) ? "an " : "a ") + name;
  }

  function projectCard(p, b, anyDone) {
    const t = tier(p.tier);
    const suits = projectSuits(p, b);
    const missing = missingFromKit(p);
    const prog = progress.get(p.id);
    const notes = [];
    if (!suits) {
      notes.push(h("span", { class: "card-note warn" }, icon("warn"), `Needs ${p.boards.map(boardNeed).join(" or ")}`));
    } else {
      notes.push(h("span", { class: "card-note good" }, icon("check"), `Works with your ${b?.short ?? "board"}`));
    }
    if (p.board_count > 1) notes.push(h("span", { class: "card-note" }, icon("users"), `Needs ${p.board_count} boards: team up with a friend`));
    if (p.needs_internet) notes.push(h("span", { class: "card-note" }, icon("wifi"), "Needs the internet"));
    if (missing.length) notes.push(h("span", { class: "card-note warn" }, icon("warn"), `Needs a part not in your kit: ${missing.map((m) => partName(m.type)).join(", ")}`));

    let ribbon = null;
    if (p.step_count === 0) ribbon = h("span", { class: "ribbon soon", text: "Coming soon" });
    else if (t?.good_first && !anyDone && !prog) ribbon = h("span", { class: "ribbon first", text: "Good to try first" });

    let progressLine = null;
    if (prog) {
      const step = Number(prog.data?.step) || 0;
      progressLine = p.step_count > 0
        ? h("span", { class: "card-progress" }, h("span", { class: "progress" }, progressBar(step / p.step_count)), h("span", { class: "small", text: prog.data?.completed ? "Finished!" : `Step ${Math.min(step + 1, p.step_count)} of ${p.step_count}` }))
        : h("span", { class: "card-progress small", text: "Started" });
    }

    return h("button", { class: ["card", "project-card", !suits && "unsuited"], type: "button", onclick: () => openProject(p.id), "aria-label": `${p.title}. ${t?.name ?? ""}. ${p.intro}` },
      ribbon,
      h("span", { class: "card-top" },
        h("span", { class: `badge tier-${p.tier}`, text: t?.name ?? p.tier }),
        h("span", { class: "card-minutes" }, icon("clock"), `About ${p.minutes} min`)),
      h("span", { class: "card-title", text: p.title }),
      h("span", { class: "card-intro", text: p.intro }),
      h("span", { class: "card-parts" }, icon("parts"), h("span", { text: partsSummary(p) })),
      h("span", { class: "card-notes" }, notes),
      progressLine);
  }

  function progressBar(fraction) {
    const bar = h("span");
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    return bar;
  }

  async function loadProgress() {
    try {
      const list = await api.progress();
      progress = new Map(list.map((p) => [p.project_id, p]));
    } catch {
      progress = new Map();
    }
    render();
  }

  const onWork = () => loadProgress();
  window.addEventListener("arduinopath:work-changed", onWork);
  render();
  loadProgress();
  return () => window.removeEventListener("arduinopath:work-changed", onWork);
}
