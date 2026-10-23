// The Wiring Wizard and the run panel, on their developer page
// (ui/bench-demo.html). Screenshots: test-results/screenshots/wizard-*.png.
import { test, expect } from "@playwright/test";

function watchErrors(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  return problems;
}

async function open(page, query) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/bench-demo.html?${query}`);
  await expect(page.locator("body[data-ready]")).toBeAttached({ timeout: 15_000 });
}

test("the Wiring Wizard for Blink & Traffic Lights, tested in the simulator", async ({ page }) => {
  const problems = watchErrors(page);
  await open(page, "project=blink-traffic-lights&board=uno&wizard=1");
  const wiz = page.getByRole("dialog", { name: /Wiring Wizard/ });
  await expect(wiz.getByRole("heading", { name: "Meet the LEDs (you need 3)" })).toBeVisible();
  await expect(wiz).toContainText("The long leg is +");
  await page.screenshot({ path: "test-results/screenshots/wizard-meet.png" });
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await expect(wiz.getByRole("heading", { name: /Meet the 220Ω resistors/ })).toBeVisible();
  await wiz.getByRole("button", { name: "Next ▶" }).click();

  // Wiring steps: the step's text for the Uno, the drawing and the safety line.
  await expect(wiz.getByRole("heading", { name: "Step 1: The red LED" })).toBeVisible();
  await expect(wiz).toContainText("Add a wire from pin 12 to J6");
  await expect(wiz).toContainText("Unplug the USB cable");
  await expect(wiz.locator(".cp-part[data-part='red']")).toHaveAttribute("filter", /hl/);
  await page.screenshot({ path: "test-results/screenshots/wizard-wire.png" });
  await wiz.getByRole("button", { name: "Show the schematic" }).click();
  await expect(wiz.locator(".cp-schematic")).toBeVisible();
  await wiz.getByRole("button", { name: "Show the breadboard" }).click();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await expect(wiz.getByRole("heading", { name: "Step 3: The green LED" })).toBeVisible();
  await wiz.getByRole("button", { name: "Next ▶" }).click();

  // Test it, in the simulator.
  await expect(wiz.getByRole("heading", { name: "Test it" })).toBeVisible();
  const start = wiz.getByRole("button", { name: "Start programming" });
  await expect(start).toBeDisabled();
  await wiz.getByRole("button", { name: "Test", exact: true }).click();
  // Each LED takes its turn; tick "I saw it work" when it lights.
  for (const id of ["red", "yellow", "green"]) {
    const row = wiz.locator(`[data-row="${id}"]`);
    await expect(row).toContainText("having its turn", { timeout: 10_000 });
    await row.getByLabel("I saw it work").check();
  }
  await page.screenshot({ path: "test-results/screenshots/wizard-test.png" });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.locator("body")).toHaveAttribute("data-wizard", "done");
  await expect(page.locator("#log")).toHaveText('Wiring Wizard done: {"confirmed":true}');
  expect(problems).toEqual([]);
});

test("the wizard's test ticks an input when the student uses it", async ({ page }) => {
  const problems = watchErrors(page);
  await open(page, "project=button-night-light&board=uno&wizard=1");
  const wiz = page.getByRole("dialog", { name: /Wiring Wizard/ });
  await wiz.getByRole("button", { name: "Skip the introductions" }).click();
  await expect(wiz.getByRole("heading", { name: "Step 1: The LED" })).toBeVisible();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await wiz.getByRole("button", { name: "Test", exact: true }).click();
  const button = wiz.locator('[data-row="b1"]');
  await expect(button).toContainText("Press the button.");
  await page.waitForTimeout(500);
  const press = wiz.getByRole("button", { name: "Press button" });
  await press.focus();
  await page.keyboard.down("Space");
  await expect(button).toContainText("Working!", { timeout: 5000 });
  await page.keyboard.up("Space");
  await expect(button).toHaveClass(/ok/);
  // Fix it jumps back to the part's wiring screen with likely causes.
  await wiz.locator('[data-row="led"]').getByRole("button", { name: "Fix it" }).click();
  await expect(wiz.getByRole("heading", { name: "Step 1: The LED" })).toBeVisible();
  await expect(wiz.getByRole("alert")).toContainText("The LED is in backwards");
  expect(problems).toEqual([]);
});

test("the run panel: watch the goal, the LED glows, serial shows, a button changes a pin", async ({ page }) => {
  const problems = watchErrors(page);
  await open(page, "project=button-night-light&board=uno&step=0");
  await page.getByRole("button", { name: "Watch the goal" }).click();
  await expect(page.locator(".rp-banner")).toHaveText(/Watching the goal/);
  const glow = page.locator(".run-panel .cp-part[data-part='led'] .cp-glow");
  await expect.poll(async () => Number(await glow.getAttribute("opacity")), { timeout: 5000 }).toBeGreaterThan(0.5);
  await page.screenshot({ path: "test-results/screenshots/wizard-runpanel-goal.png" });

  // Step 2 prints the button's state; pressing the button on the drawing changes it.
  await page.selectOption("#step", "1");
  await page.getByRole("button", { name: "▶ Run" }).click();
  await expect(page.locator(".rp-banner")).toBeHidden();
  const monitor = page.getByLabel("Serial Monitor output");
  await expect(monitor).not.toBeEmpty({ timeout: 5000 });
  const press = page.getByRole("button", { name: "Press button" });
  await press.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect.poll(() => page.evaluate(() => window.rp.result().events.some((e) => e.type === "serial"))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.rp.result().serial)).toMatch(/(^|\n)0\n/);
  await press.dispatchEvent("pointerup", { pointerId: 1 });
  await page.getByRole("button", { name: "■ Stop" }).click();
  expect(problems).toEqual([]);
});

test("the wizard's test on a real board (the app's board API pretended)", async ({ page }) => {
  const problems = watchErrors(page).filter(() => true);
  let uploaded = null;
  await page.route("**/api/ports", (r) => r.fulfill({ json: [{ port: "COM3", label: "COM3", chip: "CH340", board: "Arduino Uno", fqbn: "arduino:avr:uno" }] }));
  await page.route("**/api/upload", (r) => { uploaded = r.request().postDataJSON(); return r.fulfill({ json: { id: "job1" } }); });
  await page.route("**/api/jobs/job1", (r) => r.fulfill({ json: { state: "done", output: "Done uploading." } }));
  await page.route("**/api/serial?*", (r) => r.fulfill({
    status: 200, contentType: "text/event-stream",
    body: 'event: open\ndata: {}\n\nevent: data\ndata: "HELLO\\r\\nTEST:led:ON\\r\\nREAD:b1:1\\r\\n"\n\nevent: data\ndata: "READ:b1:0\\r\\n"\n\n',
  }));
  await page.route("**/api/serial/close", (r) => r.fulfill({ status: 204 }));
  await open(page, "project=button-night-light&board=uno&wizard=1");
  const wiz = page.getByRole("dialog", { name: /Wiring Wizard/ });
  await wiz.getByRole("button", { name: "Skip the introductions" }).click();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await wiz.getByRole("button", { name: "Next ▶" }).click();
  await wiz.getByLabel("On my real board").check();
  await expect(wiz.getByLabel("USB port")).toHaveValue("COM3");
  await wiz.getByRole("button", { name: "Test", exact: true }).click();
  await expect(wiz.locator('[data-row="b1"]')).toContainText("Working!");
  await expect(wiz.locator('[data-row="led"]')).toContainText("having its turn");
  expect(uploaded.board).toBe("uno");
  expect(uploaded.port).toBe("COM3");
  expect(uploaded.code).toContain("Serial.begin(115200)");
  await wiz.locator('[data-row="led"]').getByLabel("I saw it work").check();
  await expect(wiz.getByRole("button", { name: "Start programming" })).toBeEnabled();
  await page.screenshot({ path: "test-results/screenshots/wizard-real-board.png" });
  expect(problems.filter((p) => !/EventSource|event-stream|net::/.test(p))).toEqual([]);
});
