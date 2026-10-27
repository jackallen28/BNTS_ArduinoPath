// Records the beginner walkthrough of the Smart Bin: a new student sets up,
// wires it with the Wiring Wizard, tests it in the simulator, then codes it
// one part at a time, in Text or in Blocks.
//
//   node tools/walkthrough/smart-bin-beginner.mjs text   http://localhost:8611/ out.mp4
//   node tools/walkthrough/smart-bin-beginner.mjs blocks http://localhost:8611/ out.mp4 clean
// Add "clean" for a version with no captions or title cards.
//
// Needs ArduinoPath running with a fresh data folder (the student is new), e.g.
//   go run ./cmd/arduinopath -dev -data /tmp/wt-data -port 8611 -idle-exit 0

import { openStudio } from "./studio.mjs";
import { gapPoint, flyoutBlockPoint } from "../../tests/e2e/blocks-helpers.js";

const [mode = "text", url = "http://localhost:8611/", out = `smart-bin-${mode}.mp4`, style = "captions"] = process.argv.slice(2);
const blocks = mode === "blocks";
const s = await openStudio({ url, out, annotate: style !== "clean" });
const { page } = s;
const wiz = page.getByRole("dialog", { name: /Wiring Wizard/ });
const guide = page.locator(".side-panel.guide");
const row = (text) => guide.locator(".check-row").filter({ hasText: text });

async function untilTicked(text, ms = 20_000) {
  await row(text).waitFor();
  await page.waitForFunction((t) => [...document.querySelectorAll(".side-panel.guide .check-row")].some((r) => r.textContent.includes(t) && r.classList.contains("ok")), text, { timeout: ms });
}

/** Drags the simulator's distance slider (2 to 400 cm) to `cm`. */
async function distance(cm, scope = page.locator(".run-panel")) {
  const slider = scope.locator("input.cp-range[aria-label='Distance']").first();
  const box = await slider.boundingBox();
  const now = Number(await slider.inputValue());
  const at = (v) => ({ x: box.x + 7 + ((v - 2) / 398) * (box.width - 14), y: box.y + box.height / 2 });
  await s.drag(at(now), at(cm), { ms: 900, pause: 200 });
  // The slider is small, so finish with the arrow keys (as a student can).
  await slider.focus();
  for (let v = Number(await slider.inputValue()), n = 0; v !== cm && n < 60; v = Number(await slider.inputValue()), n++) {
    await page.keyboard.press(v < cm ? "ArrowRight" : "ArrowLeft");
    await s.sleep(25);
  }
  await s.sleep(250);
}

async function run() { await s.click(page.locator("#tool-run")); }
async function stop() {
  if ((await page.locator("#tool-run").textContent()).includes("Stop")) await s.click(page.locator("#tool-run"));
}
async function sawIt(label) {
  await s.click(guide.getByLabel(label), { pause: 900 });
}
async function nextStep() {
  await s.click(guide.getByRole("button", { name: "Next step ▶" }), { pause: 1200 });
}

/** Text: click at the ___ and type the answer over it. */
async function fillBlank(answer) {
  const editor = page.locator(".editor-text");
  const code = await editor.inputValue();
  const at = code.indexOf("___");
  const before = code.slice(0, at);
  const line = before.split("\n").length;
  const col = at - before.lastIndexOf("\n") - 1;
  const box = await editor.boundingBox();
  const lh = await editor.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  const pad = await editor.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop) - el.scrollTop);
  const charW = await editor.evaluate((el) => { const c = document.createElement("canvas").getContext("2d"); c.font = getComputedStyle(el).font; return c.measureText("0").width; });
  await s.moveTo(box.x + 8 + col * charW + charW * 1.5, box.y + pad + (line - 0.5) * lh);
  await page.mouse.down(); await page.mouse.up();
  await editor.evaluate((el, a) => { el.setSelectionRange(a, a + 3); }, at);
  await s.sleep(500);
  await s.type(answer, { delay: 140 });
}

/** Blocks: drag a block from a toolbox category into an empty gap, then type its value. */
async function dropIntoGap(category, blockType, index, gapType, gapInput, value) {
  await s.click(page.locator(".blocklyToolboxCategory, .blocklyTreeRow").filter({ hasText: category }).first(), { pause: 700 });
  // index: which one of that type, or for a word block, the word itself
  const from = typeof index === "string"
    ? await page.evaluate(([type, word]) => {
      const ws = globalThis.Blockly.getMainWorkspace();
      const b = ws.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).find((x) => x.type === type && x.getFieldValue("NAME") === word);
      const r = b.getSvgRoot().getBoundingClientRect();
      return { x: r.left + 6, y: r.top + r.height / 2 };
    }, [blockType, index])
    : await flyoutBlockPoint(page, blockType, index);
  const to = await gapPoint(page, gapType, gapInput);
  await s.drag(from, { x: to.x + 6, y: to.y }, { ms: 1100, pause: 700 });
  if (value != null) {
    const r = await page.evaluate(([type, name]) => {
      const ws = globalThis.Blockly.getMainWorkspace();
      const block = ws.getBlocksByType(type, true).map((b) => b.getInputTargetBlock(name)).find((t) => t && !t.isShadow());
      const field = block.inputList.flatMap((i) => i.fieldRow).find((f) => f.EDITABLE);
      const box = field.getSvgRoot().getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }, [gapType, gapInput]);
    await s.clickAt(r.x, r.y, { pause: 300 });
    await page.keyboard.press("Control+A");
    await s.type(String(value), { delay: 160 });
    await page.keyboard.press("Enter");
    await s.sleep(600);
  }
}

/** Blocks: drag a statement block from the toolbox to just above (before: true) or below another block. */
async function insertStatement(category, blockType, index, targetType, nth, { before = true, editWord = null } = {}) {
  await s.click(page.locator(".blocklyToolboxCategory, .blocklyTreeRow").filter({ hasText: category }).first(), { pause: 700 });
  const from = await page.evaluate(([type, i]) => {
    const ws = globalThis.Blockly.getMainWorkspace();
    const b = ws.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).filter((x) => x.type === type)[i];
    const r = b.getSvgRoot().getBoundingClientRect();
    return { x: r.left + 10, y: r.top + 10 };
  }, [blockType, index]);
  const to = await page.evaluate(([type, n, above]) => {
    const B = globalThis.Blockly;
    const ws = B.getMainWorkspace();
    const target = ws.getBlocksByType(type, true)[n];
    const c = above ? target.previousConnection : target.nextConnection;
    const p = B.utils.svgMath.wsToScreenCoordinates(ws, new B.utils.Coordinate(c.x, c.y));
    return { x: p.x, y: p.y };
  }, [targetType, nth, before]);
  await s.drag(from, { x: to.x + 10, y: to.y + 10 }, { ms: 1200, pause: 800 });
  if (editWord) {
    const r = await page.evaluate(([w]) => {
      const ws = globalThis.Blockly.getMainWorkspace();
      const word = ws.getAllBlocks(true).filter((b) => b.type === "ap_word" && b.getFieldValue("NAME") === "HIGH" && b.getSurroundParent()?.type === "ap_digital_write");
      const f = word.at(-1).getField("NAME").getSvgRoot().getBoundingClientRect();
      return { x: f.left + f.width / 2, y: f.top + f.height / 2 };
    }, [editWord]);
    await s.clickAt(r.x, r.y, { pause: 300 });
    await page.keyboard.press("Control+A");
    await s.type(editWord, { delay: 160 });
    await page.keyboard.press("Enter");
    await s.sleep(600);
  }
}

// ------------------------------------------------------------------ the film

await s.title("ArduinoPath", `A beginner's first project: the Smart Bin, in ${blocks ? "Blocks" : "Text"}`, { small: "Banyule Nillumbik Tech School · runs on the student's laptop, no internet, no AI", ms: 5000 });

await s.chapter("1 · Getting started");
await s.caption("A brand-new student opens ArduinoPath on their laptop. No passwords: just their first name and school.");
await s.click(page.getByLabel("First name", { exact: true }));
await s.type("Mia", { delay: 160 });
await s.click(page.getByLabel("Your school"));
await s.type("Eltham High School", { delay: 90 });
await s.click(page.getByRole("button", { name: "Next" }), { pause: 1200 });

await s.caption("They choose how much help they want, which board they have, and how they want to code.", { top: true });
await s.click(page.getByText("Beginner", { exact: true }), { pause: 700 });
await s.click(page.getByText("Arduino Uno R3"), { pause: 700 });
const styleCard = page.locator(".option-card", { hasText: blocks ? "Drag blocks together" : "Type the code yourself" });
await styleCard.scrollIntoViewIfNeeded();
await s.caption(blocks ? "<b>Blocks</b>: drag blocks together, and see the real C++ code they make." : "<b>Text</b>: type real Arduino C++ code, with lots of help.", { top: true });
await s.click(styleCard, { pause: 800 });
await s.click(page.getByRole("button", { name: "Let's go!" }), { pause: 1500 });

await s.caption("Every project is open from day one. Free Play is first; the rest give step-by-step help.");
await s.pointAt(page.locator(".project-card", { hasText: "Smart Bin" }));
await s.caption("Mia picks the <b>Smart Bin</b>: a bin that opens its lid by itself when a hand comes close.");
await s.click(page.locator(".project-card", { hasText: "Smart Bin" }), { pause: 1500 });

// ---- The Wiring Wizard
await s.chapter("2 · Wiring Wizard");
await wiz.waitFor();
if (!blocks) {
  await s.caption("Every project starts with the <b>Wiring Wizard</b>. First, meet the parts.", { top: true });
  await s.pointAt(wiz.locator(".wiz-meet-art"));
  await s.caption("The ultrasonic distance sensor works like a bat: it sends out sound and listens for the echo.", { top: true });
  await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1600 });
  await s.caption("The servo is a motor that turns to an angle. It will lift the lid.", { top: true });
  await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1400 });
  await s.caption("Each card shows how to tell which leg is which: the LED's long leg is +.", { top: true });
  await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1400 });
  await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1400 });
} else {
  await s.caption("The same <b>Wiring Wizard</b> as always: meet the parts, then wire them one at a time.", { top: true });
  await s.click(wiz.getByRole("button", { name: "Skip the introductions" }), { pause: 1400 });
}
await s.caption("Now wire it, one part per screen. The new wires glow; the ones already done fade back.", { top: true });
await s.pointAt(wiz.locator(".wiz-page svg").first(), { dx: 0.55, dy: 0.4 });
await s.sleep(1200);
await s.pointAt(wiz.locator(".wiz-safety"));
await s.caption("Every wiring screen has the safety reminder: unplug the USB cable while changing wires.", { top: true });
if (!blocks) {
  await s.click(wiz.getByRole("button", { name: "Show the schematic" }), { pause: 2200 });
  await s.caption("The schematic view shows the same circuit as a diagram.", { top: true });
  await s.click(wiz.getByRole("button", { name: "Show the breadboard" }), { pause: 1000 });
}
await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1500 });
await s.caption("The lid servo: brown to −, red to +, orange to pin 9. The pin numbers match the Uno.", { top: true });
await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1500 });
await s.caption("Then the LED, with its resistor.", { top: true });
await s.click(wiz.getByRole("button", { name: "Next ▶" }), { pause: 1500 });

await s.caption("Before any coding, a <b>Test</b> checks every part. Here it runs in the simulator; with a real board it uploads a test over USB.", { top: true });
await s.click(wiz.getByRole("button", { name: "Test", exact: true }), { pause: 1200 });
await s.caption("The distance sensor asks for a hand: Mia moves the distance slider.", { top: true });
await distance(15, wiz);
await distance(120, wiz);
await s.sleep(800);
await s.caption("The servo and the LED take turns. When she sees each one work, she ticks the box.", { top: true });
// An output's "I saw it work" counts while it's having its turn.
for (const id of ["servo", "led"]) {
  const r = wiz.locator(`[data-row='${id}']`);
  for (let tries = 0; tries < 4 && !(await r.getByLabel("I saw it work").isChecked()); tries++) {
    await r.getByText(/having its turn/).waitFor({ timeout: 20_000 });
    await s.click(r.getByLabel("I saw it work"), { pause: 700 });
  }
}
await s.caption("Every part is working, so <b>Start programming</b> unlocks.", { top: true });
await s.click(wiz.getByRole("button", { name: "Start programming" }), { pause: 1800 });

// ---- Programming, one part at a time
await s.chapter("3 · Step 1: Move the lid");
await s.caption("The programming screen: the step's instructions and checklist on the left, the code in the middle, the simulator on the right.", { ms: 5200 });
await s.pointAt(guide.locator("h2, h3").filter({ hasText: /Step 1/ }).first());
await s.caption("Step 1 adds just one part: the servo. The starter code is nearly done; there's one blank to fill in.");
if (blocks) {
  await s.pointAt(page.locator(".blocks-area"), { dx: 0.5, dy: 0.6 });
  await s.caption("In Blocks, the code is ready-made blocks. The blank is the empty gap in the second <b>turn servo</b> block.");
  await s.pointAt(page.locator(".blocks-code-box summary"));
  await s.caption("Underneath, students always see the real C++ their blocks make.");
} else {
  await s.pointAt(page.locator(".editor-text"), { dx: 0.3, dy: 0.45 });
}
await s.caption("Mia presses <b>Run</b> first, to see what happens…");
await run();
await guide.locator(".clue").waitFor();
await s.pointAt(guide.locator(".clue"));
await s.caption("The <b>Coach</b> spots the blank and explains in plain English. No AI: every clue was written by teachers.");
if (blocks) {
  await s.caption("She drags a number block into the gap, and types 90 (closed).");
  await dropIntoGap("Maths", "math_number", 0, "ap_servo_write", "ANGLE", 90);
} else {
  await s.caption("The lid is closed at 90°, so she types 90 in the blank.");
  await fillBlank("90");
}
await run();
await s.caption("Run tries it in the simulator, straight away. The lid opens (0°) and closes (90°)…");
await untilTicked("The lid closes (90°)");
await s.pointAt(guide.locator(".checklist, .check-row").first());
await s.caption("…and the checklist ticks itself as the code runs.");
await s.sleep(1500);
await stop();
await s.caption("On a real bin she'd press <b>Upload</b> to send it to the Uno over USB. Then she ticks what she saw.");
await sawIt(/I saw the lid open and close/);
await guide.locator(".step-done").waitFor();
await s.pointAt(guide.locator(".stars-line"));
await s.caption("Step done! The stars count <b>independence</b> (fewer hints), not speed.");
await nextStep();

await s.chapter("4 · Step 2: Measure the distance");
await s.caption("Step 2 adds the next part on its own: the distance sensor. The starter code measures; Mia shows the answer.");
if (blocks) {
  await s.pointAt(page.locator(".blocks-area"), { dx: 0.5, dy: 0.6 });
  await s.caption("The gap is in the <b>Serial Monitor: print</b> block. The distance is saved in a variable called <b>cm</b>.");
  await dropIntoGap("Variables", "ap_word", "cm", "ap_serial_print", "VALUE", null);
} else {
  await s.caption("The distance is saved in a variable called <b>cm</b>, so that goes in the blank.");
  await fillBlank("cm");
}
await run();
await s.caption("She runs it, then moves the slider in the simulator, like a hand coming closer.");
await distance(80);
await s.sleep(800);
await distance(10);
await s.sleep(900);
await s.pointAt(page.locator(".console-out").first());
await s.caption("The Serial Monitor shows the distance as it changes.");
await untilTicked("It measures 10 cm").catch(() => {});
await stop();
await sawIt(/The distance changes when I move my hand/);
await nextStep();

await s.chapter("5 · Step 3: Open for a hand");
await s.caption("Step 3 joins them up with <b>if</b>: if a hand is close, open the lid, wait 5 seconds, close it.");
if (blocks) {
  await s.caption("Scaffolded: a little less help now. The gap is the distance in the <b>if</b>.");
} else {
  await s.caption("Scaffolded: a little less help now. Mia isn't sure what number to use…");
  await s.click(guide.getByRole("button", { name: /Show me a hint/ }), { pause: 800 });
  await s.pointAt(guide.locator(".hint").first());
  await s.caption("…so she asks for a hint. Hints come one at a time, from a nudge to the answer.");
}
if (blocks) await dropIntoGap("Maths", "math_number", 0, "ap_compare", "B", 30);
else await fillBlank("30");
await run();
await s.caption("Run it, and wave a 'hand' in front of the sensor…");
await distance(12);
await s.sleep(2200);
await s.caption("The lid opens! After 5 seconds it closes again.");
await untilTicked("A hand opens the lid (0°)").catch(() => {});
await distance(150);
await s.sleep(4200);
await stop();
await sawIt(/The lid opened when my hand came close/);
await nextStep();

await s.chapter("6 · Step 4: Light while it's open");
await s.caption("Step 4 is <b>brief</b>: just a goal, no blanks. This is how the help fades as students get more confident.");
await s.click(page.locator("#tool-goal"), { pause: 600 });
await s.caption("Not sure what it should do? <b>Watch the goal</b> plays the answer in the simulator, without showing the code.");
await s.pointAt(page.locator(".run-panel .rp-stage"), { dx: 0.6, dy: 0.45 });
await s.sleep(4500);
if (blocks) {
  await s.caption("Mia finds <b>turn pin</b> in <b>Pins</b>: LED_PIN HIGH just before the lid opens…");
  await insertStatement("Pins", "ap_digital_write", 0, "ap_servo_write", 1, { before: true });
  await s.caption("…and LED_PIN LOW just after it closes.");
  await insertStatement("Pins", "ap_digital_write", 0, "ap_servo_write", 2, { before: false, editWord: "LOW" });
} else {
  await s.caption("Mia writes the two lines herself, where the comments say.");
  const editor = page.locator(".editor-text");
  for (const [comment, line] of [["// Turn the LED on here", "digitalWrite(LED_PIN, HIGH);"], ["// Turn the LED off here", "digitalWrite(LED_PIN, LOW);"]]) {
    const code = await editor.inputValue();
    const at = code.indexOf(comment);
    const lineNo = code.slice(0, at).split("\n").length;
    const box = await editor.boundingBox();
    const lh = await editor.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    const pad = await editor.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop) - el.scrollTop);
    await s.moveTo(box.x + 220, box.y + pad + (lineNo - 0.5) * lh);
    await page.mouse.down(); await page.mouse.up();
    await editor.evaluate((el, [a, len]) => el.setSelectionRange(a, a + len), [at, comment.length]);
    await s.sleep(400);
    await s.type(line, { delay: 95 });
  }
}
await run();
await distance(12);
await s.sleep(1800);
await s.caption("The LED lights up while the lid is open. Every check ticks.");
await untilTicked("The LED turns on").catch(() => {});
await distance(150);
await s.sleep(4500);
await stop();
await sawIt(/I saw the LED light up while the lid was open/);
await guide.locator(".step-done").waitFor().catch(() => {});
await s.sleep(800);
await s.caption("The Smart Bin is finished: one part at a time, tested in the simulator, ready to upload to the real bin.", { ms: 5000 });
await s.hideCaption();
await s.chapter("");
await s.title("ArduinoPath", blocks ? "Blocks today, real C++ tomorrow: the same project works in Text too." : "Real code, with a tutor beside every student.", { small: "Your work saves by itself on the laptop · Save my work moves it between laptops", ms: 5000 });

const result = await s.finish();
console.log(`${result.out}: ${result.seconds.toFixed(0)} s, ${result.frames} frames`);
if (result.problems.length) console.log("Page errors:", result.problems);
