// Block coding: a beginner picks Blocks, opens the Smart Bin, fills the gap
// by dragging a number block in, and the simulator ticks the checklist.
import { test, expect } from "@playwright/test";
import { gapPoint, flyoutBlockPoint, drag, openCategory, setFieldInGap } from "./blocks-helpers.js";

test("Smart Bin in Blocks: drag a number into the gap, Run, and the checklist ticks", async ({ page }) => {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  // Blockly must work under ArduinoPath's strict CSP (no inline styles).
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.sourceFile}:${e.lineNumber}`)));
  page.on("console", (m) => { if (m.text().startsWith("CSP:")) problems.push(m.text()); });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const newTile = page.locator(".new-tile");
  await expect(newTile.or(page.getByLabel("First name", { exact: true }))).toBeVisible();
  if (await newTile.isVisible().catch(() => false)) await newTile.click();
  await page.getByLabel("First name", { exact: true }).fill("Bianca");
  await page.getByLabel("Your school").fill("Test School");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Beginner", { exact: true }).click();
  await page.getByText("Arduino Uno R3").click();
  await page.getByText("Blocks", { exact: true }).click();
  await page.getByRole("button", { name: "Let's go!" }).click();

  await page.locator(".project-card", { hasText: "Smart Bin" }).click();
  const wizard = page.getByRole("dialog", { name: /Wiring Wizard/ });
  await wizard.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("tab", { name: "Blocks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".blocks-area .blocklySvg")).toBeVisible();
  await expect(page.locator(".blocks-code")).toContainText("lid.write(___);");

  // Run with the gap still empty: the Coach asks for it first.
  await page.locator("#tool-run").click();
  await expect(page.locator(".side-panel.guide .clue")).toContainText("Fill in the gaps first");

  // Drag a number into the gap and make it 90.
  await openCategory(page, "Maths");
  await drag(page, await flyoutBlockPoint(page, "math_number"), await gapPoint(page, "ap_servo_write", "ANGLE"));
  await setFieldInGap(page, "ap_servo_write", "ANGLE", 90);
  await expect(page.locator(".blocks-code")).toContainText(/lid\.write\(0\);\n  delay\(2000\);\n  lid\.write\(90\);/);

  await page.locator("#tool-run").click();
  const rows = page.locator(".side-panel.guide .check-row");
  await expect(rows.filter({ hasText: "The lid opens (0°)" })).toHaveClass(/ok/, { timeout: 15_000 });
  await expect(rows.filter({ hasText: "The lid closes (90°)" })).toHaveClass(/ok/, { timeout: 15_000 });
  await page.locator("#tool-run").click();
  await page.screenshot({ path: "test-results/screenshots/blocks-smart-bin.png" });

  // Text shows the same code, and switching back keeps the blocks.
  await page.getByRole("tab", { name: "Text" }).click();
  await expect(page.locator(".editor-text")).toHaveValue(/lid\.write\(90\);/);
  await page.getByRole("tab", { name: "Blocks" }).click();
  await expect(page.locator(".blocks-code")).toContainText("lid.write(90);");
  expect(problems).toEqual([]);
});
