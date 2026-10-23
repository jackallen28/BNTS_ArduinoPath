// The programming workspace: a student opens Blink & Traffic Lights, runs
// the starter code in the simulator, watches the checklist tick, makes a
// mistake and gets the Coach's clue, fixes it, finishes the step and moves
// on; Watch the goal plays the model answer.
import { test, expect } from "@playwright/test";

async function newStudent(page, name) {
  await page.goto("/");
  const logOut = page.getByRole("button", { name: "Log out" });
  if (await logOut.isVisible({ timeout: 2000 }).catch(() => false)) await logOut.click();
  const newTile = page.locator(".new-tile");
  await expect(newTile.or(page.getByLabel("First name", { exact: true }))).toBeVisible();
  if (await newTile.isVisible().catch(() => false)) await newTile.click();
  await page.getByLabel("First name", { exact: true }).fill(name);
  await page.getByLabel("Your school").fill("Test School");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Beginner", { exact: true }).click();
  await page.getByText("Arduino Uno R3").click();
  await page.getByRole("button", { name: "Let's go!" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Hi ${name}!`) })).toBeVisible();
}

// A project with parts opens the Wiring Wizard first (its own test goes through it).
async function closeWizard(page) {
  const wizard = page.getByRole("dialog", { name: /Wiring Wizard/ });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Close" }).click();
  await expect(wizard).toBeHidden();
}

test("a project, one step at a time", async ({ page }) => {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await newStudent(page, "Zara");

  await page.locator(".project-card", { hasText: "Blink & Traffic Lights" }).click();
  await closeWizard(page);
  const guide = page.locator(".side-panel.guide");
  await expect(guide.getByRole("heading", { name: /Step 1 of 4/ })).toBeVisible();
  const editor = page.locator(".editor-text");
  await expect(editor).toHaveValue(/Pins for your Arduino Uno/);
  await expect(editor).toHaveValue(/#define LED_RED 12/);

  // Running with the blank left in asks for the blank first.
  await page.locator("#tool-run").click();
  await expect(guide.locator(".clue")).toContainText("Fill in the blanks first");

  // Fill it in and Run: the simulator ticks the checklist by itself.
  await editor.fill((await editor.inputValue()).replace("___", "LOW"));
  await page.locator("#tool-run").click();
  const rows = guide.locator(".check-row");
  await expect(rows.filter({ hasText: "The red LED turns on" })).toHaveClass(/ok/, { timeout: 15_000 });
  await expect(rows.filter({ hasText: "The red LED turns off" })).toHaveClass(/ok/, { timeout: 15_000 });
  await expect(page.locator("#tool-run")).toContainText("Stop");
  await page.locator("#tool-run").click();
  await expect(page.locator("#tool-run")).toContainText("Run");

  // "I saw it happen" finishes the step, with stars.
  await guide.getByLabel(/I saw the red LED blink/).check();
  await expect(guide.locator(".step-done")).toBeVisible();
  await expect(guide.locator(".stars-line")).toContainText("★★★");
  await page.screenshot({ path: "test-results/screenshots/09-workspace-step-done-1366x768.png" });

  // Step 2: a mistake gives a clue in plain English.
  await guide.getByRole("button", { name: "Next step ▶" }).click();
  await expect(guide.getByRole("heading", { name: /Step 2 of 4/ })).toBeVisible();
  const code = await editor.inputValue();
  await editor.fill(code.replace(/digitalWrite\(LED_RED, HIGH\);/, "digitalWrite(LED_RED, HIGH)"));
  await page.locator("#tool-run").click();
  const clue = guide.locator(".clue");
  await expect(clue).toBeVisible();
  await expect(clue).toContainText(/semicolon|;/i);
  await expect(clue).toContainText("Hint 1"); // beginners see the first hint straight away
  await page.screenshot({ path: "test-results/screenshots/10-workspace-clue-1366x768.png" });

  // Watch the goal plays the model answer, and doesn't tick anything.
  await page.locator("#tool-goal").click();
  await expect(page.locator(".rp-banner")).toContainText("Watching the goal");

  // Progress is saved: reopening the project comes back to step 2.
  await page.getByRole("button", { name: "Projects" }).click();
  await page.locator(".project-card", { hasText: "Blink & Traffic Lights" }).click();
  await closeWizard(page);
  await expect(guide.getByRole("heading", { name: /Step 2 of 4/ })).toBeVisible();
  await expect(guide.locator(".step-dot.done")).toHaveCount(1);

  expect(problems).toEqual([]);
});

test("a screen-only project with the Serial Monitor", async ({ page }) => {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await newStudent(page, "Omar");
  await page.locator(".project-card", { hasText: "Serial Chatbot" }).click();
  await expect(page.getByRole("dialog", { name: /Wiring Wizard/ })).toHaveCount(0); // no parts, no wiring
  const editor = page.locator(".editor-text");
  await expect(editor).toHaveValue(/___/);
  await editor.fill((await editor.inputValue()).replace("___", '"Hello from Omar!"'));
  await page.locator("#tool-run").click();
  await expect(page.locator(".console-out").first()).toContainText("Hello from Omar!", { timeout: 10_000 });
  const rows = page.locator(".side-panel.guide .check-row");
  await expect(rows.first()).toHaveClass(/ok/, { timeout: 10_000 });
  expect(problems).toEqual([]);
});
