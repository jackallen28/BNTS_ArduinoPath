// The circuit renderer, on its demo page (ui/circuit-demo.html): the sample
// circuit on every board, wiring steps, simulated behaviour and controls,
// and a few projects' circuits. Screenshots go to
// test-results/screenshots/circuit-*.png at 1366×768.
import { test, expect } from "@playwright/test";

const BOARDS = ["uno", "nano", "mega", "nodemcu", "d1-mini", "esp32", "esp32-c3"];

function watchErrors(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  return problems;
}

async function open(page, query) {
  await page.setViewportSize({ width: 1366, height: 768 });
  const board = new URLSearchParams(query).get("board") || "uno";
  await page.goto(`/circuit-demo.html?${query}`);
  await expect(page.locator(`body[data-ready="${board}"]`)).toBeAttached({ timeout: 15_000 });
  await page.waitForTimeout(400); // the demo's first ticks
}

for (const board of BOARDS) {
  test(`the sample circuit on ${board}`, async ({ page }) => {
    const problems = watchErrors(page);
    await open(page, `board=${board}&all=1`);
    const svg = page.locator("#breadboard svg.cp-svg");
    await expect(svg).toHaveAttribute("role", "img");
    await expect(svg).toHaveAttribute("aria-label", /on a breadboard/);
    await expect(page.locator("#breadboard .cp-part")).toHaveCount(10);
    await expect(page.locator("#breadboard .cp-wire")).toHaveCount(20);
    await expect(page.locator("#schematic .cp-sch-part")).toHaveCount(10);
    await expect(page.locator("#problems li")).toHaveText(["No problems found."]);
    await page.screenshot({ path: `test-results/screenshots/circuit-${board}.png` });
    expect(problems).toEqual([]);
  });
}

test("wiring steps: new parts glow, earlier ones fade, later ones hide", async ({ page }) => {
  const problems = watchErrors(page);
  await open(page, "board=uno&step=1");
  const part = (id) => page.locator(`#breadboard .cp-part[data-part="${id}"]`);
  await expect(part("red")).toHaveAttribute("filter", /url\(#cp\d+-hl\)/);
  await expect(part("yellow")).toHaveAttribute("display", "none");
  await page.getByRole("button", { name: "Next ▶" }).click();
  await expect(page.locator("#step-label")).toHaveText("Step 2 of 7");
  await expect(part("red")).toHaveAttribute("opacity", "0.4");
  await expect(part("yellow")).toHaveAttribute("filter", /hl/);
  await expect(part("servo")).toHaveAttribute("display", "none");
  await page.screenshot({ path: "test-results/screenshots/circuit-step2.png" });
  await page.getByRole("button", { name: "Show the whole circuit" }).click();
  await expect(part("servo")).toHaveAttribute("display", "inline");
  await expect(part("red")).toHaveAttribute("opacity", "1");
  expect(problems).toEqual([]);
});

test("controls: press the button, turn the knob, and the drawing reacts", async ({ page }) => {
  const problems = watchErrors(page);
  await open(page, "board=uno&all=1");
  // The demo sketch lights the traffic lights and draws on the OLED.
  const glows = page.locator("#breadboard .cp-glow");
  await expect(glows).toHaveCount(3);
  await expect.poll(async () => (await glows.evaluateAll((els) => els.map((e) => +e.getAttribute("opacity")))).some((o) => o > 0.5)).toBe(true);
  await expect(page.locator("#breadboard .cp-oled-pixels")).toHaveAttribute("d", /^M/);

  const button = page.getByRole("button", { name: "Press button" });
  await button.focus();
  await page.keyboard.down("Space");
  await expect(page.locator("#control-log")).toHaveText('b1: press = true');
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.up("Space");
  await expect(page.locator("#control-log")).toHaveText('b1: press = false');

  const knob = page.getByRole("slider", { name: "Turn knob" });
  await knob.focus();
  await page.keyboard.press("End");
  await expect(knob).toHaveAttribute("aria-valuenow", "100");
  await expect(page.locator("#control-log")).toHaveText("pot: position = 1");
  // The demo turns the servo with the knob.
  await expect.poll(() => page.locator('#breadboard [data-cp="horn"]').getAttribute("transform")).toContain("rotate(-44)");
  await page.screenshot({ path: "test-results/screenshots/circuit-controls.png" });
  expect(problems).toEqual([]);
});

const PROJECTS = [
  ["parking-sensor", "uno"], ["parking-sensor", "esp32"], ["keypad-safe", "uno"], ["rfid-door", "nodemcu"],
  ["simon-says", "uno"], ["joystick-snake", "esp32"], ["weather-station", "d1-mini"], ["neopixel-mood-lamp", "nano"],
  ["digital-dice", "esp32-c3"], ["plant-buddy", "mega"],
];
for (const [project, board] of PROJECTS) {
  test(`project ${project} on ${board}`, async ({ page }) => {
    const problems = watchErrors(page);
    await open(page, `board=${board}&project=${project}&all=1`);
    await expect(page.locator("#problems li")).toHaveText(["No problems found."]);
    await page.screenshot({ path: `test-results/screenshots/circuit-project-${project}-${board}.png` });
    expect(problems).toEqual([]);
  });
}
