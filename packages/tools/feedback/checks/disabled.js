async function checkDisabled(page) {
  if (await page.getByRole("navigation", { name: "Feedback controls" }).count())
    throw new Error("Disabled feedback mounted UI");
  await page.keyboard.press("F8");
  if (await page.locator("dialog.yage-feedback").count())
    throw new Error("Disabled feedback registered shortcut");
  return { disabled: true, controls: 0, composer: 0 };
}
