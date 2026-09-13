import { expect, test } from "@playwright/test";
import { gotoFixture, waitForClock } from "./helpers.js";

/**
 * Real Pixi, empty string. Both unit suites replace `pixi.js` wholesale, so
 * the actual split — the one that produces no line containers and used to
 * take `addChild()` down with it — only runs here.
 */
test.describe("Empty split text", () => {
  test("mounts, clears and refills without a console error", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await gotoFixture(page, "/split-text-empty.html");
    await waitForClock(page);

    // Mounting empty already ran the constructor's split path on both the
    // renderer component and the UI element.
    expect(pageErrors).toEqual([]);

    const charCounts = await page.evaluate(() => {
      const api = window.__splitEmpty__;
      if (!api) throw new Error("__splitEmpty__ is not available.");
      return api.run();
    });

    // Pairs of (component, UI element) char counts for "", "Hello", "",
    // "world": empty leaves no glyphs, and the next value splits normally.
    expect(charCounts).toEqual([0, 0, 5, 5, 0, 0, 5, 5]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

declare global {
  interface Window {
    __splitEmpty__?: { run(): number[] };
  }
}
