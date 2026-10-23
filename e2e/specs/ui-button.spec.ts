import { expect, test } from "@playwright/test";
import {
  getComponentData,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers.js";

interface ClickTrackerData {
  clicks: number;
}

test.describe("UI button fixture", () => {
  test("clicking the button triggers its callback", async ({ page }) => {
    await gotoFixture(page, "/ui-button.html");
    await waitForClock(page);
    // Pointer dispatch needs a drawn frame, and the fixture can freeze
    // before drawing one.
    await stepFrames(page, 1, { render: "last" });

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
