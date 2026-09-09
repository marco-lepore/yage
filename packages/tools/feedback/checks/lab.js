async function verifyLab(page) {
  await page
    .getByRole("button", { name: "Leave feedback", exact: true })
    .click();
  const blocked = await page
    .getByRole("button", { name: /Pause the lab or other clock owner/ })
    .textContent();
  if (await page.locator("dialog.yage-feedback").count())
    throw new Error("Feedback took owned lab clock");
  await page.getByRole("button", { name: "pause", exact: true }).click();
  await page
    .getByRole("button", { name: /Pause the lab or other clock owner/ })
    .click();
  await page
    .getByRole("textbox", { name: "Comment" })
    .fill("Lab capture: make the patrol formation wider.");
  await page.getByRole("button", { name: "Save comment", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  const during = await page.evaluate(() => ({
    frame: window.__yage__.inspector.time.getFrame(),
    frozen: window.__yage__.inspector.time.isFrozen(),
    owned: window.__yage__.inspector.time.isOwned(),
    errors: window.__yage__.inspector.getErrors(),
  }));
  await page.screenshot({ path: "output/playwright/feedback-lab.png" });
  await page.getByRole("button", { name: "Return to view" }).click();
  const after = await page.evaluate(() => ({
    frame: window.__yage__.inspector.time.getFrame(),
    frozen: window.__yage__.inspector.time.isFrozen(),
    owned: window.__yage__.inspector.time.isOwned(),
  }));
  if (!after.frozen || after.owned || after.frame !== during.frame)
    throw new Error("Lab pause state not preserved");
  await page.getByRole("button", { name: "play", exact: true }).click();
  await page.waitForFunction(
    (frame) => window.__yage__.inspector.time.getFrame() > frame,
    during.frame,
  );
  return { blocked, during, after };
}
