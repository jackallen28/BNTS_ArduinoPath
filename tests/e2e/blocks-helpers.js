// Moving blocks with the mouse, for the Blocks tests (and the walkthrough videos).

/** The screen point of a block's empty value gap: blockType's input `input` (the first one still empty). */
export async function gapPoint(page, blockType, input) {
  return page.evaluate(([type, name]) => {
    const B = globalThis.Blockly;
    const ws = B.getMainWorkspace();
    const block = ws.getBlocksByType(type, true).find((b) => b.getInput(name) && !b.getInputTargetBlock(name));
    if (!block) throw new Error(`no ${type} with an empty ${name}`);
    const c = block.getInput(name).connection;
    const p = B.utils.svgMath.wsToScreenCoordinates(ws, new B.utils.Coordinate(c.x, c.y));
    const box = ws.getParentSvg().getBoundingClientRect();
    return { x: p.x - box.left + box.left, y: p.y };
  }, [blockType, input]);
}

/** Where to grab a block in the toolbox's flyout: near its left edge (its plug), in the middle. */
export async function flyoutBlockPoint(page, blockType, index = 0) {
  return page.evaluate(([type, i]) => {
    const ws = globalThis.Blockly.getMainWorkspace();
    const blocks = ws.getToolbox().getFlyout().getWorkspace().getTopBlocks(true).filter((b) => b.type === type);
    const r = blocks[i].getSvgRoot().getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  }, [blockType, index]);
}

/** Drags with the mouse from one point to another, slowly enough to see. */
export async function drag(page, from, to, steps = 25) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 4, { steps: 4 });
  await page.mouse.move(to.x + 6, to.y, { steps });
  await page.mouse.up();
}

/** Opens a toolbox category by name. */
export async function openCategory(page, name) {
  await page.locator(".blocklyToolboxCategory, .blocklyTreeRow").filter({ hasText: name }).first().click();
}

/** Types into the number or text field of the block that was dropped into type's input. */
export async function setFieldInGap(page, blockType, input, value) {
  await page.waitForTimeout(400); // let the dropped block settle into the gap
  const r = await page.evaluate(([type, name]) => {
    const ws = globalThis.Blockly.getMainWorkspace();
    // The block a student dropped in (not a number that was already there as a shadow).
    const block = ws.getBlocksByType(type, true).map((b) => b.getInputTargetBlock(name)).find((t) => t && !t.isShadow());
    const field = block.inputList.flatMap((i) => i.fieldRow).find((f) => f.EDITABLE);
    const box = field.getSvgRoot().getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }, [blockType, input]);
  await page.mouse.click(r.x, r.y);
  const box = page.locator(".blocklyHtmlInput");
  await box.waitFor();
  await box.fill(String(value));
  await page.keyboard.press("Enter");
}
