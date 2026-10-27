// Step 2 of the journey: how much help, which board, and text or blocks.

import { api } from "../api.js";
import { h, icon, clear, joinNames } from "../dom.js";
import { HELP_LEVELS, CODING_STYLES, optionCards, boardOptions } from "../dialogs/settings.js";
import { messageBox } from "../widgets/window.js";
import { state } from "../state.js";

export function setupScreen(root, { onDone }) {
  const settings = { ...state.me.settings, help_level: state.me.settings.help_level || "beginner", coding: state.me.settings.coding || "text" };
  const go = h("button", { class: "pill big default", type: "button", onclick: save }, "Let's go!");

  async function save() {
    go.disabled = true;
    try {
      state.me.settings = await api.saveSettings(settings);
      onDone();
    } catch (err) {
      go.disabled = false;
      messageBox({ kind: "error", instruction: "That didn't save.", text: err.message });
    }
  }

  clear(root).append(h("div", { class: "logon" },
    h("main", { class: "logon-stage", id: "main" },
      h("section", { class: "window wizard setup", "aria-labelledby": "setup-title" },
        h("div", { class: "titlebar" }, icon("settings", "app-icon"), h("span", { class: "title", id: "setup-title", text: "Let's get you set up" })),
        h("div", { class: "window-body" },
          h("h2", { text: `Nice to meet you, ${joinNames(state.me.student.names)}!` }),
          h("fieldset", { class: "groupbox" },
            h("legend", { text: "How much help would you like?" }),
            optionCards({ name: "help", options: HELP_LEVELS, value: settings.help_level, onChange: (v) => { settings.help_level = v; } })),
          h("fieldset", { class: "groupbox" },
            h("legend", { text: "Which board do you have?" }),
            h("p", { class: "small muted", text: "Not sure? Ask your teacher, or look for the name printed on the board." }),
            optionCards({ name: "board", options: boardOptions(), value: settings.board, className: "compact", onChange: (v) => { settings.board = v; settings.board_variant = ""; } })),
          h("fieldset", { class: "groupbox" },
            h("legend", { text: "How do you want to write code?" }),
            optionCards({ name: "coding", options: CODING_STYLES, value: settings.coding, className: "compact", onChange: (v) => { settings.coding = v; } })),
          h("p", { class: "small muted", text: "You can change these any time in Settings." }),
          h("div", { class: "setup-go" }, go)))),
    h("img", { class: "bnts-pixels", src: "img/bnts-pixels.svg", alt: "" })));
  go.focus();
}
