async function checkControls(page) {
  await page.keyboard.press("F9");
  const resumed = await page.evaluate(
    () => !window.__yage__.inspector.time.isFrozen(),
  );
  if (!resumed) throw new Error("F9 did not resume");
  await page.keyboard.press("F8");
  await page.getByRole("dialog", { name: "YAGE feedback" }).waitFor();
  const frame = await page.evaluate(() =>
    window.__yage__.inspector.time.getFrame(),
  );
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Shortcut input isolation");
  await page.keyboard.press("F9");
  const unchanged = await page.evaluate(
    (frame) =>
      window.__yage__.inspector.time.getFrame() === frame &&
      window.__yage__.inspector.time.isFrozen(),
    frame,
  );
  if (!unchanged) throw new Error("Shortcut changed time inside composer");
  await page.getByRole("button", { name: "Return to view" }).click();
  await page.getByRole("button", { name: "Destroy engine" }).click();
  if (await page.getByRole("navigation", { name: "Feedback controls" }).count())
    throw new Error("Toolbar survived teardown");
  await page.keyboard.press("F8");
  if (await page.locator("dialog.yage-feedback").count())
    throw new Error("Shortcut survived teardown");
  return { resumed, unchanged, teardown: true };
}
