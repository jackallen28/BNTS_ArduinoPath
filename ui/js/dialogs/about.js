// The About box.

import { h, icon } from "../dom.js";
import { openDialog } from "../widgets/window.js";
import { state } from "../state.js";

export function aboutContent() {
  return h("div", { class: "about" },
    h("div", { class: "about-head" },
      icon("app", "icon-48"),
      h("div", {},
        h("div", { class: "about-title", text: "ArduinoPath" }),
        h("div", { class: "muted", text: `Version ${state.info?.version ?? ""}` }))),
    h("p", { text: "ArduinoPath helps you learn to code Arduino and ESP boards, one part at a time." }),
    h("p", { text: "It was developed by the Banyule Nillumbik Tech School (BNTS) and reviewed by teachers." }),
    h("p", { text: "It is not hosted on AI. Every hint was written by people, and ArduinoPath runs on this laptop, so your work stays here. Nothing is sent over the internet." }),
    h("p", { text: "ArduinoPath aims to open up programming to every student by adapting to each student's needs." }),
    state.info?.data_dir ? h("p", { class: "muted small" },
      "Saved work and the log file (arduinopath.log), for troubleshooting: ",
      h("code", { class: "about-path", text: state.info.data_dir })) : null);
}

export function showAbout() {
  let dlg;
  dlg = openDialog({
    title: "About ArduinoPath",
    iconName: "about",
    content: aboutContent(),
    buttons: [h("button", { class: "btn default", type: "button", onclick: () => dlg.close() }, "OK")],
  });
  return dlg.result;
}
