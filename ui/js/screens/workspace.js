// The project workspace: the step-by-step guide (left), the code editor
// (middle) and the simulator with its Serial Monitor (right). Run tries the
// code in the simulator; Upload compiles it with the real compiler and puts
// it on the board over USB; Check my code only compiles. The checklist ticks
// itself as the code runs, the Coach explains clues (errors) in plain
// English, and the adaptive Coach nudges when a student seems stuck.
// Free Play is the same screen without the guide.

import { api } from "../api.js";
import { h, icon, clear, fill, download } from "../dom.js";
import { appWindow, tool, separator, spacer, messageBox } from "../widgets/window.js";
import { codeEditor } from "../widgets/editor.js";
import { createRunPanel } from "../widgets/runpanel.js";
import { Autosaver, Status, statusText } from "../autosave.js";
import { offlineStore } from "../offline-store.js";
import { state, board, tier } from "../state.js";
import { render as markdown } from "../markdown.js";
import { explain } from "../coach.js";
import { normalise, stepState, stepStars, projectStars, starsMessage, hintsUnlocked, Coach, harder, easier } from "../learning.js";
import { review } from "../review.js";
import * as realboard from "../realboard.js";
import { pinPlan } from "../sim/pins.js";
import { blocksView } from "../blocks/view.js";
import { splitText, showExplanation, starterFor, demoFor, blanks, baudOf, simDiagnostics, checklist, allDone, firstFailing, canSkip, openingStep } from "../guide.js";

export function starterSketch(title) {
  return `// ${title}
// Your code saves by itself.

void setup() {
  // This runs once, when the board starts.

}

void loop() {
  // This runs again and again, forever.

}
`;
}

const NUDGE_TEXT = {
  "same-error": "That clue came up twice. Want some help with it?",
  "check-failing": "That checklist item is being tricky. Want some help?",
  "many-tries": "You've had a few tries at this step. Want some help?",
  quiet: "Taking a think? Here's some help if you'd like it.",
  "no-run": "Not sure where to start? Here's some help.",
};

export function workspaceScreen(root, { projectId, openSettings, back }) {
  const isFreePlay = projectId === "freeplay";
  const summary = isFreePlay ? null : state.catalogue.projects.find((p) => p.id === projectId);
  const title = isFreePlay ? "Free Play" : summary?.title ?? "Project";

  const saveCell = h("span", { class: "cell save-status", "aria-live": "polite" });
  const cursorCell = h("span", { class: "cell" });
  const boardCell = h("span", { class: "cell" });
  const panel = h("aside", { class: "side-panel guide", "aria-label": isFreePlay ? "Free Play" : "Step-by-step guide" });
  const editorHolder = h("div", { class: "editor-holder" }, h("p", { class: "muted loading", text: "Opening..." }));
  // Text or Blocks: the same code, typed or built from blocks (CLAUDE.md: the student's choice).
  const blocksHolder = h("div", { class: "editor-holder blocks-holder", hidden: true });
  const textTab = h("button", { class: "tab", type: "button", role: "tab", id: "tab-text", "aria-selected": "true", onclick: () => setCoding("text", true) }, "Text");
  const blocksTab = h("button", { class: "tab", type: "button", role: "tab", id: "tab-blocks", "aria-selected": "false", onclick: () => setCoding("blocks", true) }, "Blocks");
  const codingTabs = h("div", { class: "tabs coding-tabs", role: "tablist", "aria-label": "How to write your code" }, textTab, blocksTab);
  const runHolder = h("div", { class: "run-holder" });
  const portSelect = h("select", { class: "select port-select", "aria-label": "Your board's USB port", title: "The USB port your board is plugged into" },
    h("option", { value: "", text: "Plug in your board..." }));

  const runBtn = tool("run", "Run", () => (rp?.running && runKind === "run" ? stopRun() : run()), { id: "tool-run", title: "Try your code in the simulator" });
  const goalBtn = tool("about", "Watch the goal", () => watchGoal(), { id: "tool-goal", title: "See what this step should do" });
  const uploadBtn = tool("upload", "Upload", () => uploadToBoard(), { id: "tool-upload", title: "Put your code on your real board" });
  const checkBtn = tool("check", "Check my code", () => checkCode(), { id: "tool-check", title: "Check your code with the real compiler" });
  const wiringBtn = tool("wiring", "Wiring", () => openWiring(false), { id: "tool-wiring" });

  const win = appWindow({
    title,
    className: "workspace",
    toolbar: [
      tool("back", "Projects", back),
      separator(),
      isFreePlay ? null : wiringBtn,
      runBtn,
      isFreePlay ? null : goalBtn,
      separator(),
      uploadBtn,
      portSelect,
      checkBtn,
      separator(),
      tool("download", "Download .ino", () => downloadIno()),
      spacer(),
      tool("settings", "Settings", () => openSettings({ onSaved: settingsChanged, projectId: isFreePlay ? undefined : projectId })),
    ],
    body: h("div", { class: "split workspace-split" }, panel, h("main", { class: "code-column", id: "main" }, codingTabs, editorHolder, blocksHolder), runHolder),
    status: [saveCell, boardCell, h("span", { class: "cell grow" }), cursorCell],
  });
  clear(root).append(win);

  // ---------- Saving ----------
  const key = `${state.me.student.id}:${projectId}`;
  const saver = new Autosaver({
    key,
    store: offlineStore,
    send: (code) => api.saveSketch(projectId, code),
    onStatus: (s, detail) => {
      saveCell.className = `cell save-status ${s}`;
      fill(saveCell, s === Status.ERROR || s === Status.OFFLINE ? icon("warn") : null, statusText(s, detail));
    },
  });
  saver.onStatus(Status.SAVED);

  let project = null; // the full project (null for Free Play)
  let progress = null; // learning.js progress
  let stepIndex = 0;
  let editor = null;
  let rp = null;
  let runKind = null; // "run" | "goal" | null
  let mode = "sim"; // what the checklist is about: "sim" | "board"
  let boardSerial = ""; // what the real board has printed since the last upload
  let serialConn = null;
  let simSerialWrite = null; // the run panel's own Send (to the simulator)
  let clue = null; // the Coach's explanation of the last clue, or a message
  let clueHints = 0; // how many of the clue's hints are showing
  let nudge = null;
  let showFull = false;
  let finished = false;
  let reviewFound = null;
  let closed = false;
  let evalTimer = 0;
  let tickTimer = 0;
  let rowsCache = [];
  let coding = state.me.settings.coding === "blocks" ? "blocks" : "text";
  let blocks = null; // the Blocks view, made the first time it's needed
  let blocksSaveTimer = 0;
  const level = () => state.me.settings.help_level || "beginner";
  let coach = new Coach({ level: level(), nudges: state.me.settings.nudges !== false });

  const step = () => project?.steps?.[stepIndex] ?? null;
  const sState = () => stepState(progress, stepIndex);
  const code = () => (editor ? editor.value : "");

  function showBoard() {
    const b = board();
    boardCell.replaceChildren(icon("board"), b ? b.name : "No board");
  }
  showBoard();

  function settingsChanged() {
    showBoard();
    coach.level = level();
    coach.nudges = state.me.settings.nudges !== false;
    if (rp) {
      rp.stop();
      rp.setBoard(board());
    }
    refreshPorts();
    renderGuide();
    if (state.me.settings.coding && state.me.settings.coding !== coding) setCoding(state.me.settings.coding, false);
    else if (blocks) {
      // The blocks make the pin #defines for the board, so start them again for the new one.
      blocks.destroy();
      blocks = null;
      if (coding === "blocks") showBlocks();
    }
  }

  function downloadIno() {
    const name = `${(title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "sketch")}.ino`;
    download(new Blob([code()], { type: "text/plain" }), name);
  }

  function saveProgress() {
    if (isFreePlay || !progress) return;
    progress.step = stepIndex;
    api.saveProgress(projectId, progress).catch(() => {});
  }

  // ---------- The guide panel ----------
  function renderGuide() {
    if (isFreePlay) return renderFreePlay();
    if (!project) return;
    const s = step();
    if (!s) return;
    const st = sState();
    const lv = level();
    const { goal, body } = splitText(s.text);
    const explanationOpen = showFull || showExplanation(lv, s.support);
    const total = project.steps.length;
    const unlocked = hintsUnlocked(lv, s.support, st, (s.hints || []).length);
    const rows = rowsCache;
    const stars = projectStars(progress);
    const t = tier(project.tier);

    const dots = h("ol", { class: "guide-steps", "aria-label": "Steps" }, project.steps.map((x, i) => {
      const done = progress.steps[i]?.done;
      return h("li", {},
        h("button", {
          type: "button",
          class: ["step-dot", i === stepIndex && "current", done && "done"],
          title: `Step ${i + 1}: ${x.title}${done ? " (done)" : ""}`,
          "aria-label": `Step ${i + 1}: ${x.title}${done ? ", done" : ""}`,
          "aria-current": i === stepIndex ? "step" : null,
          disabled: !(done || i <= furthestStep() || canSkip(lv)),
          onclick: () => goToStep(i),
        }, done ? "✓" : String(i + 1)));
    }));

    fill(panel,
      h("div", { class: "panel-head" },
        h("span", { class: `badge tier-${project.tier}`, text: t?.name ?? "" }),
        stars.possible ? h("span", { class: "stars", title: "Independence stars: fewer hints, more stars", text: `★ ${stars.earned}` }) : null,
        h("h2", { text: project.title })),
      dots,
      nudge ? nudgeBox() : null,
      finished ? finishedBox() : h("section", { class: "step", "aria-label": `Step ${stepIndex + 1}` },
        h("h3", { class: "step-title" }, h("span", { class: "muted", text: `Step ${stepIndex + 1} of ${total}: ` }), s.title),
        explanationOpen && body ? h("div", { class: "step-text" }, markdown(body, h)) : null,
        goal ? h("div", { class: "step-goal" }, markdown(goal, h)) : null,
        !explanationOpen && body ? h("button", { class: "btn link", type: "button", onclick: () => { showFull = true; renderGuide(); } }, "Show the full explanation") : null,
        rows.length ? checklistBox(rows) : null,
        clue ? clueBox() : null,
        st.done ? doneBox(s, st) : null,
        hintsBox(s, st, unlocked),
        stepButtons(s, st)),
      safetyNote());
  }

  function furthestStep() {
    let i = 0;
    while (i < project.steps.length - 1 && progress.steps[i]?.done) i++;
    return Math.max(i, progress.step ?? 0);
  }

  function checklistBox(rows) {
    return h("fieldset", { class: "groupbox checklist" },
      h("legend", { text: mode === "board" ? "Checklist (on your board)" : "Checklist" }),
      h("ul", {}, rows.map((r) => h("li", { class: ["check-row", r.ok && "ok"] },
        h("span", { class: "check-mark", "aria-hidden": "true", text: r.ok ? "✓" : "○" }),
        r.tick
          ? h("label", { class: "check-tick" },
            h("input", { type: "checkbox", checked: r.ticked, onchange: (e) => tickRow(r.label, e.target.checked) }),
            h("span", { text: r.label }),
            h("span", { class: "muted small", text: r.type === "confirm" ? " (tick when you see it)" : " (I saw it happen)" }))
          : h("span", { text: r.label }),
        h("span", { class: "sr-only", text: r.ok ? " Done." : " Not yet." })))),
      runKind === "goal" ? h("p", { class: "muted small", text: "Watching the goal doesn't tick the checklist. Press Run to try your own code." }) : null);
  }

  function tickRow(label, on) {
    const st = sState();
    const set = new Set(st.confirmed || []);
    if (on) set.add(label);
    else set.delete(label);
    st.confirmed = [...set];
    saveProgress();
    evaluateNow();
  }

  function clueBox() {
    const c = clue;
    const lv = level();
    const hints = c.hints || [];
    return h("div", { class: "note clue", role: "alert" }, icon("warn"), h("div", {},
      h("strong", { text: c.title }),
      c.line ? h("p", { class: "muted small", text: `Clue on line ${c.line}` }) : null,
      c.explain ? h("p", { text: c.explain }) : null,
      lv === "advanced" && c.message ? h("pre", { class: "code compiler-message", text: c.message }) : null,
      lv === "advanced" && c.tech ? h("p", { class: "small", text: c.tech }) : null,
      hints.slice(0, clueHints).map((t, i) => h("p", { class: "clue-hint" }, h("strong", { text: `Hint ${i + 1}: ` }), t)),
      clueHints < hints.length ? h("button", { class: "btn small", type: "button", onclick: () => { clueHints++; renderGuide(); } },
        clueHints === 0 ? "Show me a hint" : "Another hint") : null,
      c.line ? h("button", { class: "btn small", type: "button", onclick: async () => { if (coding === "blocks") await setCoding("text", false); editor?.goToLine?.(c.line); } }, coding === "blocks" ? "Show me in the code" : "Go to the line") : null));
  }

  function hintsBox(s, st, unlocked) {
    const hints = s.hints || [];
    if (!hints.length) return null;
    const shown = Math.min(st.hints || 0, hints.length);
    return h("fieldset", { class: "groupbox hints" },
      h("legend", { text: "Hints" }),
      hints.slice(0, shown).map((t, i) => h("div", { class: "hint" }, h("strong", { text: `Hint ${i + 1}: ` }), markdown(t, h))),
      shown < hints.length
        ? (shown < unlocked
          ? h("button", { class: "btn", type: "button", onclick: () => showHint() }, shown === 0 ? "Show me a hint" : "Show another hint")
          : h("p", { class: "muted small", text: shown === 0 ? "Hints open up after you've had a go. Press Run to try your code." : "More hints open up after another try." }))
        : null);
  }

  function showHint() {
    const st = sState();
    st.hints = (st.hints || 0) + 1;
    saveProgress();
    renderGuide();
  }

  function doneBox(s, st) {
    const n = stepStars(st);
    return h("div", { class: "note info step-done" }, icon("check"), h("div", {},
      h("strong", { text: s.success || "Step done!" }),
      n ? h("p", { class: "stars-line", text: `${"★".repeat(n)}${"☆".repeat(3 - n)} ${n === 3 ? "All on your own!" : "Hints helped you get there."}` }) : null,
      reviewFound?.length ? h("div", { class: "review" },
        h("p", {}, h("strong", { text: "Code review: " }), "ideas to make your code even better (optional)."),
        h("ul", {}, reviewFound.map((r) => h("li", {}, h("strong", { text: `${r.title}: ` }), r.text)))) : null));
  }

  function stepButtons(s, st) {
    const last = stepIndex === project.steps.length - 1;
    const lv = level();
    return h("div", { class: "step-buttons" },
      stepIndex > 0 ? h("button", { class: "btn", type: "button", onclick: () => goToStep(stepIndex - 1) }, "◀ Back") : null,
      st.done
        ? h("button", { class: "btn default", type: "button", onclick: () => (last ? finishProject() : goToStep(stepIndex + 1)) }, last ? "Finish the project" : "Next step ▶")
        : null,
      !st.done && canSkip(lv) && !last ? h("button", { class: "btn", type: "button", onclick: () => skipStep() }, "Skip this step") : null,
      !st.done && canSkip(lv) && !last ? h("button", { class: "btn", type: "button", onclick: () => goToStep(project.steps.length - 1) }, "Jump to the challenge") : null);
  }

  function nudgeBox() {
    const n = nudge;
    const close = () => { nudge = null; renderGuide(); };
    let text;
    let buttons;
    if (n.kind === "stuck") {
      text = NUDGE_TEXT[n.reason] || "Want some help?";
      buttons = [
        ["Show me a hint", () => { sState().unlocked = true; showHint(); close(); }],
        ["Watch the goal", () => { close(); watchGoal(); }],
        ["Show the full explanation", () => { showFull = true; sState().unlocked = true; close(); }],
      ];
    } else if (n.kind === "flying") {
      text = `You're flying! Three steps in a row on your own. Want to try ${harder(level())} level?`;
      buttons = [["Yes, make it harder", () => setLevel(harder(level()))], ["No thanks", close]];
    } else {
      text = `This is a tricky one. Want a bit more help? (${easier(level())} level)`;
      buttons = [["Yes please", () => setLevel(easier(level()))], ["No thanks, I've got this", close]];
    }
    return h("div", { class: "nudge balloon-inline", role: "status" },
      h("div", { class: "balloon-title" }, icon("about"), h("span", { text: "Coach" })),
      h("p", { text }),
      h("div", { class: "nudge-buttons" }, buttons.map(([label, fn]) => h("button", { class: "btn small", type: "button", onclick: fn }, label))),
      h("button", { class: "caption-close small", type: "button", "aria-label": "Close", onclick: close }, "✕"));
  }

  async function setLevel(lv) {
    nudge = null;
    const settings = { ...state.me.settings, help_level: lv };
    try {
      await api.saveSettings(settings);
      state.me.settings = settings;
      coach.level = lv;
    } catch { /* keep going at the old level */ }
    renderGuide();
  }

  function finishedBox() {
    const stars = projectStars(progress);
    return h("section", { class: "step finished" },
      h("h3", { text: "Project finished!" }),
      h("div", { class: "step-text" }, markdown(project.outro || "Well done!", h)),
      stars.possible ? h("p", { class: "stars-line", text: `★ ${stars.earned} of ${stars.possible}. ${starsMessage(stars)}` }) : null,
      project.stretch?.length ? h("fieldset", { class: "groupbox" },
        h("legend", { text: "Level up challenges" }),
        h("ol", {}, project.stretch.map((x) => h("li", {}, markdown(x, h))))) : null,
      h("div", { class: "step-buttons" },
        h("button", { class: "btn", type: "button", onclick: () => { finished = false; renderGuide(); } }, "◀ Back to the steps"),
        h("button", { class: "btn default", type: "button", onclick: back }, "Pick another project")));
  }

  function safetyNote() {
    if (!project?.parts?.length) return null;
    const b = board();
    return h("div", { class: "note safety" }, icon("warn"), h("div", {},
      h("strong", { text: "Wiring safely" }),
      h("ul", {},
        h("li", { text: "Unplug the USB cable before you change any wires. Plug it back in after." }),
        b?.power?.vcc === "3V3" ? h("li", { text: "Your board runs on 3.3V. Never connect 5V to one of its pins." }) : null,
        project.parts.some((p) => p.type === "led") ? h("li", { text: "Always use a resistor with an LED." }) : null)));
  }

  function renderFreePlay() {
    fill(panel,
      h("div", { class: "panel-head" }, icon("freeplay", "icon-32"), h("h2", { text: "Free Play" })),
      h("p", { text: "Build anything you like! Write your code, press Run to try it in the simulator, or Upload to put it on your board." }),
      clue ? clueBox() : null,
      h("fieldset", { class: "groupbox" },
        h("legend", { text: "Need an idea?" }),
        h("ul", { class: "ideas" },
          h("li", { text: "Make the board's built-in LED blink a secret message in Morse code." }),
          h("li", { text: "Print the numbers 1 to 100 in the Serial Monitor, but say \"Fizz\" for multiples of 3." }),
          h("li", { text: "Ask a question in the Serial Monitor and answer it with an if." }),
          h("li", { text: "Pick a project from the list to learn a new part, then come back and mix them up." }))),
      h("fieldset", { class: "groupbox" },
        h("legend", { text: "Cheat sheet" }),
        h("pre", { class: "code cheat", text: "pinMode(pin, OUTPUT);\ndigitalWrite(pin, HIGH);\ndigitalRead(pin)\nanalogRead(A0)\ndelay(500);\nSerial.begin(9600);\nSerial.println(\"Hi\");\nif (x > 5) { ... }\nfor (int i = 0; i < 10; i++) { ... }" })),
      safetyNoteFreePlay());
  }

  function safetyNoteFreePlay() {
    return h("div", { class: "note safety" }, icon("warn"), h("div", {},
      h("strong", { text: "Wiring safely" }),
      h("p", { text: "Unplug the USB cable before you change any wires. Always use a resistor with an LED." })));
  }

  // ---------- Text or Blocks ----------
  /** Switches between typing the code and building it from blocks; `remember` saves it as the student's choice. */
  async function setCoding(kind, remember) {
    coding = kind;
    textTab.setAttribute("aria-selected", String(kind === "text"));
    blocksTab.setAttribute("aria-selected", String(kind === "blocks"));
    editorHolder.hidden = kind !== "text";
    blocksHolder.hidden = kind !== "blocks";
    if (remember && state.me.settings.coding !== kind) {
      api.saveSettings({ ...state.me.settings, coding: kind }).then((saved) => { state.me.settings = saved; }).catch(() => {});
    }
    if (kind === "blocks") await showBlocks();
    else editor?.focus();
  }

  /** The code as blocks (keeping the student's layout when the code hasn't changed in Text). */
  async function showBlocks() {
    if (!editor) return;
    if (!blocks) {
      blocksHolder.replaceChildren(h("p", { class: "muted loading", text: "Getting the blocks ready..." }));
      try {
        blocks = await blocksView({ project, board: board(), onChange: blocksChanged });
      } catch (err) {
        blocksHolder.replaceChildren(h("div", { class: "note error" }, icon("warn"), h("span", { text: "The blocks couldn't load. You can still use Text." })));
        console.error(err);
        return;
      }
      if (closed) return blocks.destroy();
      blocksHolder.replaceChildren(blocks.el);
    }
    blocks.show(code(), progress?.blocks ?? null);
  }

  function blocksChanged(newCode, blocksState) {
    if (!editor || newCode === code()) return;
    editor.value = newCode;
    saver.change(newCode);
    coach.changed();
    if (mode === "sim" && runKind !== "run") scheduleEvaluate();
    // Keep the layout of the blocks with the progress (it's small), saved a moment after the last change.
    if (progress) {
      progress.blocks = blocksState;
      clearTimeout(blocksSaveTimer);
      blocksSaveTimer = setTimeout(() => { if (JSON.stringify(progress).length < 60_000) saveProgress(); else delete progress.blocks; }, 1500);
    }
  }

  // ---------- Steps ----------
  /** Opens step i. Its starter code replaces the code only when the student first moves onto it (never when reopening the project). */
  function enterStep(i, { useStarter = true } = {}) {
    stepIndex = i;
    const s = step();
    const st = sState();
    clue = null;
    clueHints = 0;
    nudge = null;
    showFull = false;
    reviewFound = null;
    rowsCache = [];
    studentResult = null;
    mode = "sim";
    coach.startStep();
    if (!st.started) {
      st.started = true;
      const starter = useStarter ? starterFor(s, project, board()) : null;
      if (starter != null && editor && code().trim() !== starter.trim()) {
        editor.value = starter;
        saver.change(starter);
        if (progress) delete progress.blocks;
        if (coding === "blocks") showBlocks();
      }
    }
    evaluateNow();
    saveProgress();
    renderGuide();
  }

  function goToStep(i) {
    finished = false;
    stopRun();
    enterStep(i);
  }

  function skipStep() {
    const st = sState();
    st.skipped = true;
    goToStep(stepIndex + 1);
  }

  function stepCompleted() {
    const st = sState();
    if (st.done) return;
    st.done = true;
    st.first_try = (st.failed || 0) === 0;
    if (level() === "advanced") reviewFound = review(code());
    const n = coach.stepDone({ hints: st.hints || 0 });
    if (n) nudge = n;
    saveProgress();
    renderGuide();
  }

  function finishProject() {
    progress.finished = true;
    finished = true;
    saveProgress();
    renderGuide();
  }

  // ---------- Checking ----------
  // The student's last run in the simulator still counts after Stop or Watch the goal.
  let studentResult = null;
  function currentResult() {
    if (mode === "board") return { ok: true, errors: [], events: [], serial: boardSerial };
    if (runKind === "run" && rp) studentResult = rp.result();
    return studentResult;
  }

  function evaluateNow() {
    if (isFreePlay || !project) return;
    const s = step();
    const st = sState();
    rowsCache = checklist(s, {
      code: code(), board: board(), project, result: currentResult(), runs: st.runs || 0,
      confirmed: new Set(st.confirmed || []), mode,
    });
    if (!st.done && allDone(rowsCache)) stepCompleted();
  }

  function scheduleEvaluate() {
    if (evalTimer) return;
    evalTimer = setTimeout(() => {
      evalTimer = 0;
      if (closed) return;
      const before = JSON.stringify(rowsCache.map((r) => r.ok));
      evaluateNow();
      if (JSON.stringify(rowsCache.map((r) => r.ok)) !== before) renderGuide();
    }, 250);
  }

  /** A run finished, or a clue came up: tell the adaptive Coach. */
  function ranWith({ errorId = null } = {}) {
    if (isFreePlay) return;
    const st = sState();
    st.runs = (st.runs || 0) + 1;
    const failedCheck = errorId ? null : firstFailing(rowsCache);
    if (errorId) st.failed = (st.failed || 0) + 1;
    const n = coach.ran({ errorId, failedCheck });
    if (n) nudge = n;
    saveProgress();
  }

  function showClue(c) {
    clue = c;
    clueHints = level() === "beginner" ? 1 : 0;
    renderGuide();
  }

  function blanksClue() {
    const lines = blanks(code());
    if (!lines.length) return false;
    if (coding === "blocks") showClue({ title: "Fill in the gaps first", explain: "A block still has an empty gap (a dark hole). Drag the right block into each gap, then try again.", hints: [] });
    else showClue({ title: "Fill in the blanks first", explain: `Your code still has ___ on line ${lines.join(", ")}. Replace each ___ with the right code, then try again.`, line: lines[0], hints: [] });
    return true;
  }

  // ---------- Run (simulator) ----------
  function ensureRunPanel() {
    if (rp) return rp;
    rp = createRunPanel({
      board: board(), project, circuit: project?.circuit ?? null,
      onRuntimeError: (err) => {
        if (runKind !== "run") return;
        showClue({ title: "The simulator found a clue", explain: err.message, line: err.line || undefined, hints: [] });
        ranWith({ errorId: "runtime" });
      },
      onEvents: () => { if (runKind === "run" && mode === "sim") scheduleEvaluate(); },
    });
    rp.busyLoopText = "Your loop is running without a break, so the board can't do anything else. Add a delay(...) inside the loop, or check your while loop can finish.";
    simSerialWrite = rp.serialWrite;
    runHolder.replaceChildren(rp.el, rp.console.el);
    return rp;
  }

  async function run() {
    if (!editor) return;
    closeBoardSerial();
    mode = "sim";
    clue = null;
    if (blanksClue()) { ranWith({ errorId: "blanks" }); return; }
    saver.change(code());
    const panelRp = ensureRunPanel();
    runKind = "run";
    studentResult = null;
    setRunning(true);
    const res = await panelRp.run(code(), { label: "Running your code" });
    if (closed) return;
    if (!res.ok) {
      runKind = null;
      setRunning(false);
      if (res.unsupported) {
        showClue({ title: "The simulator can't run this part", explain: `${res.message || "This code uses something the simulator doesn't know."} Your real board can: press Upload.`, line: res.line, hints: [] });
        return;
      }
      const c = explain(state.catalogue.errors, "compile", { diagnostics: simDiagnostics(res.errors) });
      showClue(c ?? { title: "There's a clue in your code", explain: res.errors?.[0]?.message ?? "", line: res.errors?.[0]?.line, hints: [] });
      ranWith({ errorId: c?.id ?? "compile" });
      return;
    }
    evaluateNow();
    renderGuide();
    // Count the run once it has had a moment to do something.
    setTimeout(() => {
      if (closed || runKind !== "run") return;
      evaluateNow();
      ranWith();
      renderGuide();
    }, 3000);
  }

  function stopRun() {
    if (runKind === "run") currentResult();
    if (rp) rp.stop();
    runKind = null;
    setRunning(false);
  }

  function setRunning(on) {
    const label = runBtn.querySelector("span");
    label.textContent = on && runKind === "run" ? "Stop" : "Run";
  }

  async function watchGoal() {
    if (!project) return;
    closeBoardSerial();
    const s = step();
    const panelRp = ensureRunPanel();
    if (runKind === "run") currentResult();
    runKind = "goal";
    setRunning(false);
    renderGuide();
    await panelRp.run(demoFor(s, project, board()), { events: s.sim_events || [], ms: s.sim_ms || 0, label: "Watching the goal" });
  }

  // ---------- Real boards ----------
  let ports = [];
  async function refreshPorts() {
    try {
      ports = await api.ports();
    } catch {
      ports = [];
    }
    ports = realboard.sortPorts(ports);
    const guess = realboard.guessPort(ports, board(), portSelect.value || realboard.rememberedPort());
    portSelect.replaceChildren(
      h("option", { value: "", text: ports.length ? "Pick your board's port" : "Plug in your board..." }),
      ports.map((p) => h("option", { value: p.port, text: realboard.portLabel(p), selected: p.port === guess || null })));
  }
  portSelect.addEventListener("focus", refreshPorts);
  portSelect.addEventListener("change", () => realboard.rememberPort(portSelect.value));

  function setBusy(on) {
    [uploadBtn, checkBtn].forEach((b) => { b.disabled = on; });
  }

  async function checkCode() {
    if (!editor || blanksClue()) return;
    const b = board();
    const con = ensureRunPanel().console;
    con.showOutput();
    con.setOutput(`Checking your code for ${b.name}...\n(The first time, the tools for your board are unpacked. This can take a minute.)\n`);
    setBusy(true);
    try {
      const job = await realboard.compile(code(), b, state.me.settings.board_variant, (j) => con.setOutput(jobText(j)));
      afterCompile(job, b, con, false);
    } catch (err) {
      showClue({ title: "Checking didn't work", explain: err.message, hints: [] });
    } finally {
      setBusy(false);
    }
  }

  async function uploadToBoard() {
    if (!editor || blanksClue()) return;
    const b = board();
    await refreshPorts();
    const port = portSelect.value || realboard.guessPort(ports, b, realboard.rememberedPort());
    if (!port) {
      await messageBox({
        kind: "info",
        instruction: ports.some(realboard.isUsb) ? "Which port is your board on?" : "Plug in your board",
        text: ports.some(realboard.isUsb)
          ? "Pick your board's port from the list next to Upload, then press Upload again."
          : ["ArduinoPath can't see a board yet.", "Plug it in with a USB cable that can send data (some only charge), then press Upload again."],
      });
      return;
    }
    stopRun();
    closeBoardSerial();
    const con = ensureRunPanel().console;
    con.showOutput();
    con.setOutput(`Compiling for ${b.name}...\n`);
    setBusy(true);
    try {
      const job = await realboard.upload(code(), b, state.me.settings.board_variant, port, (j) => {
        con.setOutput(jobText(j));
        con.setStatus(j.state === "uploading" ? `Uploading ${j.progress || 0}%` : j.state === "compiling" ? "Compiling..." : "", "");
      });
      if (!afterCompile(job, b, con, true)) return;
      con.setStatus("Uploaded ✓", "good");
      realboard.rememberPort(port);
      mode = "board";
      boardSerial = "";
      openBoardSerial(port, con);
      evaluateNow();
      ranWith();
      renderGuide();
    } catch (err) {
      showClue({ title: "Uploading didn't work", explain: err.message, hints: [] });
    } finally {
      setBusy(false);
    }
  }

  /** Shows the result of a compile or upload job. Returns true if it worked. */
  function afterCompile(job, b, con, uploading) {
    con.setOutput(jobText(job));
    const r = job.result;
    if (r && !r.ok) {
      const c = explain(state.catalogue.errors, "compile", { diagnostics: r.errors || [], output: r.output || "" });
      showClue(c ?? { title: "The compiler found a clue", explain: (r.errors || [])[0]?.message ?? "", hints: [] });
      ranWith({ errorId: c?.id ?? "compile" });
      return false;
    }
    if (job.state === "failed") {
      const text = `${job.output || ""}\n${job.error || ""}`;
      const c = explain(state.catalogue.errors, uploading ? "upload" : "compile", { output: text });
      showClue(c ?? { title: uploading ? "Uploading didn't work" : "Checking didn't work", explain: job.error || "Try again.", hints: [] });
      if (!uploading) ranWith({ errorId: c?.id ?? "compile" });
      return false;
    }
    clue = null;
    if (!uploading) {
      const size = r?.size;
      const pct = size?.flash_max ? Math.round((100 * size.flash) / size.flash_max) : null;
      showClue({ title: "Your code is ready for your board ✓", explain: `It compiled for ${b.name} with no clues${pct != null ? `, and uses ${pct}% of the board's memory` : ""}. Press Upload to put it on your board.`, hints: [], ok: true });
    } else {
      renderGuide();
    }
    return true;
  }

  function jobText(job) {
    const parts = [];
    if (job.output) parts.push(job.output.trimEnd());
    if (job.state === "uploading") parts.push(`Uploading... ${job.progress || 0}%`);
    if (job.state === "done") parts.push(job.kind === "upload" ? "Done! Your code is on the board." : "Done!");
    if (job.error) parts.push(job.error);
    return parts.join("\n");
  }

  function openBoardSerial(port, con, { afterUpload = true } = {}) {
    con.clear();
    con.showMonitor();
    con.setBaudVisible(true);
    if (afterUpload) con.baud = baudOf(code());
    con.setStatus(`Listening to your board on ${port}...`, "");
    serialConn = realboard.openSerial(port, con.baud, {
      retryMs: afterUpload ? 8000 : 3000, // the board restarts after an upload
      onOpen: () => con.setStatus(`Connected to ${port} at ${con.baud} baud`, "good"),
      onData: (text) => {
        con.append(text);
        boardSerial += text.replace(/\r\n/g, "\n");
        if (boardSerial.length > 100_000) boardSerial = boardSerial.slice(-80_000);
        scheduleEvaluateBoard();
      },
      onClose: (reason) => { if (reason) con.setStatus(reason, "warn"); },
    });
    // The Serial Monitor's Send box and speed now talk to the real board.
    rp.serialWrite = (text) => serialConn?.write(text).catch((err) => con.setStatus(err.message, "warn"));
    rp.onBaud = () => {
      if (!serialConn) return;
      serialConn.close();
      openBoardSerial(port, con, { afterUpload: false });
    };
  }

  function scheduleEvaluateBoard() {
    if (mode !== "board") return;
    scheduleEvaluate();
  }

  function closeBoardSerial() {
    if (serialConn) serialConn.close();
    serialConn = null;
    if (rp) {
      rp.console.setBaudVisible(false);
      rp.serialWrite = simSerialWrite; // Send goes to the simulator again
      rp.onBaud = null;
    }
  }

  // ---------- Wiring ----------
  async function openWiring(first) {
    if (!project?.circuit || (project.circuit.breadboard === "none" && !project.parts?.length)) return;
    let wizard;
    try {
      wizard = await import("../wizard.js");
    } catch {
      return; // the Wiring Wizard isn't in this build
    }
    stopRun();
    wizard.openWiringWizard({
      project, board: board(), pins: pinPlan(project, board()),
      onDone: () => {
        progress.wiring_done = true;
        saveProgress();
        renderGuide();
      },
      onClose: () => {},
      first,
    });
  }

  // ---------- Opening ----------
  async function open() {
    project = null;
    try {
      if (!isFreePlay) project = await api.project(projectId);
    } catch (err) {
      if (err.status === 404) {
        await messageBox({ kind: "warn", instruction: "That project isn't here.", text: "It may have been removed. Pick another one." });
        back();
        return;
      }
      editorHolder.replaceChildren(h("div", { class: "note error" }, icon("warn"), h("span", { text: err.message })));
      return;
    }
    if (closed) return;

    if (!isFreePlay) {
      let saved = null;
      try {
        const list = await api.progress();
        saved = list.find((p) => p.project_id === projectId)?.data ?? null;
      } catch { /* start fresh */ }
      progress = normalise(saved, project.steps.length);
      stepIndex = openingStep(progress, project.steps.length);
      finished = !!progress.finished && stepIndex === project.steps.length - 1 && progress.steps[stepIndex]?.done;
    }

    let serverCode = null;
    let updatedAt = 0;
    try {
      const sk = await api.sketch(projectId);
      serverCode = sk.code;
      updatedAt = sk.updated_at;
    } catch (err) {
      if (err.status !== 404) {
        editorHolder.replaceChildren(h("div", { class: "note error" }, icon("warn"), h("span", { text: err.message })));
        return;
      }
    }
    if (closed) return;
    const firstTime = serverCode == null;
    if (firstTime) {
      serverCode = isFreePlay ? starterSketch("Free Play") : (starterFor(project.steps[0], project, board()) ?? starterSketch(title));
    }
    const text = await saver.recover(serverCode, updatedAt);
    editor = codeEditor({
      value: text,
      label: `${title} code`,
      onChange: (v) => {
        saver.change(v);
        coach.changed();
        if (mode === "sim" && runKind !== "run") scheduleEvaluate();
      },
      onCursor: (row, col) => { cursorCell.textContent = `Line ${row}, Col ${col}`; },
    });
    editorHolder.replaceChildren(editor.el);
    if (coding === "blocks") setCoding("blocks", false);
    ensureRunPanel();
    if (isFreePlay) {
      if (firstTime) api.saveProgress(projectId, { step: 0, started_at: Date.now() }).catch(() => {});
      renderGuide();
    } else {
      if (firstTime) {
        progress.started_at = Date.now();
        progress.steps[0] = { ...stepState(progress, 0), started: true };
      }
      enterStep(stepIndex, { useStarter: false });
      if (!progress.wiring_done && project.parts?.length) openWiring(true);
    }
    if (coding === "text") editor.focus();
    refreshPorts();
    tickTimer = setInterval(() => {
      if (isFreePlay || !project || nudge) return;
      const n = coach.tick();
      if (n) {
        nudge = n;
        renderGuide();
      }
    }, 30_000);
  }

  const onOnline = () => saver.retry();
  const onLeave = () => {
    if (saver.dirty) {
      saver.keep(saver.code);
      api.saveSketch(projectId, saver.code, { keepalive: true }).catch(() => {});
    }
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onLeave);
  open();

  return async () => {
    closed = true;
    clearInterval(tickTimer);
    clearTimeout(evalTimer);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onLeave);
    closeBoardSerial();
    clearTimeout(blocksSaveTimer);
    blocks?.destroy();
    if (rp) rp.destroy();
    await saver.flush();
    saver.stop();
  };
}
