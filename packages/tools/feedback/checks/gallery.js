async function verifyGallery(page) {
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.getElementById("refresh").disabled,
  );
  const api = await page
    .locator('meta[name="feedback-api"]')
    .getAttribute("content");
  const server = await page.evaluate(
    (path) => new URL(path, location.href).href,
    api,
  );
  const before = await (await page.request.get(server + "comments")).json();
  const pending = before.filter((c) => ["open", "ingested"].includes(c.status));
  if ((await page.locator("article").count()) !== Math.min(24, pending.length))
    throw new Error("Wrong pending count");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("article img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await page.screenshot({
    path: "output/playwright/feedback-gallery.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Select page", exact: true }).click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: await page.evaluate(() => location.origin),
  });
  await page
    .getByRole("button", { name: "Copy for Codex", exact: true })
    .click();
  const codex = await page.evaluate(() => navigator.clipboard.readText());
  await page
    .getByRole("button", { name: "Copy for Claude", exact: true })
    .click();
  const claude = await page.evaluate(() => navigator.clipboard.readText());
  if (
    !codex.startsWith("$yage-feedback") ||
    !claude.startsWith("/yage-feedback")
  )
    throw new Error("Incorrect skill invocation");
  for (const prompt of [codex, claude]) {
    if (!prompt.includes(server))
      throw new Error("API path missing from handoff");
    for (const comment of pending.slice(-24))
      if (!prompt.includes(comment.id)) throw new Error("Selected ID missing");
    for (const comment of before.filter(
      (c) => !["open", "ingested"].includes(c.status),
    ))
      if (prompt.includes(comment.id))
        throw new Error("Unselected ID included");
  }
  await page
    .getByRole("button", { name: "View evidence", exact: true })
    .first()
    .click();
  await page.getByText("Inspector snapshot", { exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#detail img")?.naturalWidth > 0,
  );
  if (
    !(await page
      .locator("#evidence pre")
      .filter({ hasText: '"frame"' })
      .count())
  )
    throw new Error("Missing inspector evidence");
  await page.screenshot({
    path: "output/playwright/feedback-gallery-detail.png",
    fullPage: true,
  });
  await page.locator("#close-detail").click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("addressed");
  if (
    (await page.locator("article").count()) !==
    Math.min(24, before.filter((c) => c.status === "addressed").length)
  )
    throw new Error("Addressed filter failed");
  if (
    !(await page
      .getByRole("button", { name: "Copy for Codex", exact: true })
      .isDisabled())
  )
    throw new Error("Filter retained hidden selection");
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("pending");
  const after = await (await page.request.get(server + "comments")).json();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Gallery changed comment state");
  return {
    server,
    pending: pending.length,
    addressed: before.filter((c) => c.status === "addressed").length,
    codex,
    claude,
    unchanged: true,
  };
}
