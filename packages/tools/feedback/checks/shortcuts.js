async function verifyShortcuts(page) {
  const read = () =>
    page.evaluate(() => ({
      frame: window.__yage__.inspector.time.getFrame(),
      frozen: window.__yage__.inspector.time.isFrozen(),
      owned: window.__yage__.inspector.time.isOwned(),
    }));
  const base = page.url().split("?")[0];
  const errors = [];
  const onError = (error) => errors.push(error.message);
  page.on("pageerror", onError);
  const results = [];
  for (const custom of [false, true]) {
    await page.goto(custom ? base + "?shortcuts=custom" : base);
    await page
      .getByRole("button", { name: "Leave feedback", exact: true })
      .waitFor();
    if (
      !(await page
        .getByRole("button", { name: "+1 frame", exact: true })
        .isDisabled())
    )
      throw new Error("Step enabled before freeze");
    await page.keyboard.press(custom ? "Shift+KeyP" : "F9");
    const start = await read();
    if (!start.frozen) throw new Error("Freeze binding failed");
    await page.keyboard.press(custom ? "Period" : "F10");
    const one = await read();
    await page.keyboard.press(custom ? "Shift+Period" : "Shift+F10");
    const ten = await read();
    if (
      one.frame !== start.frame + 1 ||
      ten.frame !== start.frame + 11 ||
      !ten.frozen ||
      ten.owned
    )
      throw new Error("Wrong frame count or leaked time lease");
    await page.getByRole("button", { name: "+1 frame", exact: true }).click();
    await page.getByRole("button", { name: "+10 frames", exact: true }).click();
    const buttons = await read();
    if (buttons.frame !== start.frame + 22)
      throw new Error("Step buttons failed");
    await page.evaluate(() => {
      window.__feedbackLease = window.__yage__.inspector.time.acquire();
    });
    await page.getByRole("button", { name: "+1 frame", exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "+1 frame",
        ).disabled,
    );
    await page.keyboard.press(custom ? "Period" : "F10");
    if ((await read()).frame !== buttons.frame)
      throw new Error("Stepped another clock owner");
    await page.evaluate(() => {
      window.__feedbackLease.release();
      delete window.__feedbackLease;
    });
    await page.keyboard.press(custom ? "Shift+KeyK" : "F8");
    await page
      .getByRole("dialog", { name: "YAGE feedback", exact: true })
      .waitFor();
    await page.keyboard.press(custom ? "Period" : "F10");
    if ((await read()).frame !== buttons.frame)
      throw new Error("Changed captured frame");
    await page
      .getByRole("textbox", { name: "Comment" })
      .fill("Typing retains these letters");
    await page.getByRole("textbox", { name: "Comment" }).press("Shift+KeyK");
    if (
      !(
        await page.getByRole("textbox", { name: "Comment" }).inputValue()
      ).endsWith("K")
    )
      throw new Error("Shortcut intercepted typing");
    await page
      .getByRole("button", { name: "Return to view", exact: true })
      .click();
    if (custom) {
      await page.keyboard.press("F9");
      await page.keyboard.press("F10");
      if (!(await read()).frozen || (await read()).frame !== buttons.frame)
        throw new Error("Overridden defaults still active");
      if (
        !(
          await page
            .getByRole("button", { name: "Leave feedback", exact: true })
            .getAttribute("title")
        ).includes("Shift+K")
      )
        throw new Error("Tooltip not rebound");
    }
    results.push({
      custom,
      start: start.frame,
      after: buttons.frame,
      exact22Frames: true,
    });
  }
  await page.goto(base);
  page.off("pageerror", onError);
  if (errors.length) throw new Error(errors.join("\n"));
  return results;
}
