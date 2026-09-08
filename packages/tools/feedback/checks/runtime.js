async function verifyRuntime(page) {
  const read = () =>
    page.evaluate(() => ({
      frame: window.__yage__.inspector.time.getFrame(),
      frozen: window.__yage__.inspector.time.isFrozen(),
      input: window.__yage__.inspector.snapshot().input,
      errors: window.__yage__.inspector.getErrors(),
    }));
  if (!(await page.locator("dialog.yage-feedback").count()))
    await page
      .getByRole("button", { name: "Leave feedback", exact: true })
      .click();
  const before = await read();
  await page
    .getByRole("combobox", { name: "Target mode" })
    .selectOption("entities");
  const labels = await page.locator("dialog .targets label").allTextContents();
  await page.locator("dialog summary").click();
  await page.getByRole("searchbox", { name: "Filter entities" }).fill("Scout");
  const scouts = page.getByRole("checkbox", { name: /Scout/ });
  await scouts.nth(0).check();
  await scouts.nth(1).check();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill(
      "These scouts are too close together and too small. Spread and enlarge the formation.",
    );
  await page.getByRole("textbox", { name: "Comment" }).press("Space");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page
    .getByRole("combobox", { name: "Target mode" })
    .selectOption("area");
  await page.setViewportSize({ width: 1180, height: 860 });
  const box = await page
    .getByRole("figure", { name: "Captured game view" })
    .boundingBox();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.94, box.y + box.height * 0.62, {
    steps: 8,
  });
  await page.mouse.up();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("This empty part of the map needs some small environmental details.");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  const after = await read();
  if (before.frame !== after.frame || !after.frozen)
    throw new Error("Clock moved while commenting");
  await page.screenshot({ path: "output/playwright/feedback-runtime.png" });
  await page.getByRole("button", { name: "Return to view" }).click();
  await page.waitForFunction(
    (frame) => window.__yage__.inspector.time.getFrame() > frame,
    before.frame,
  );
  await page
    .getByRole("button", { name: "Leave feedback", exact: true })
    .click();
  const second = await read();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill(
      "On this later frame, the moving scout has drifted away from the group.",
    );
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  await page.getByRole("button", { name: "Return to view" }).click();
  await page.getByRole("button", { name: "Freeze / resume" }).click();
  const frozenBefore = await read();
  await page
    .getByRole("button", { name: "Leave feedback", exact: true })
    .click();
  await page.getByRole("button", { name: "Return to view" }).click();
  const frozenAfter = await read();
  if (frozenBefore.frame !== frozenAfter.frame || !frozenAfter.frozen)
    throw new Error("Pre-existing freeze not preserved");
  return { labels, before, after, second, frozenBefore, frozenAfter };
}
