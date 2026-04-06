import { expect, test } from "@playwright/test";
import { getComponentData, gotoFixture, stepFrames, waitForClock } from "./helpers";

interface ClickTrackerData {
  clicks: number;
}

test.describe("UI button fixture", () => {
  test("clicking the button triggers its callback", async ({ page }) => {
    await gotoFixture(page, "/ui-button.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const canvas = page.locator("canvas");
    await canvas.click({
      position: { x: 100, y: 70 },
    });
    await stepFrames(page, 1);

    const state = await getComponentData<ClickTrackerData>(
      page,
      "ui-state",
      "ClickTracker",
    );
    expect(state?.clicks).toBe(1);
  });
});
