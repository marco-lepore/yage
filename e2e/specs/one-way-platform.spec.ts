import { expect, test } from "@playwright/test";
import {
  getEntityPosition,
  getSnapshot,
  gotoFixture,
  stepFrames,
  waitForClock,
} from "./helpers";

/**
 * Exercises the contact-filter hook in the browser's ESM Rapier build.
 * The clean-errors assertions matter as much as the positions: a filter
 * that throws inside the hook is reported and falls back to solid, which
 * would land the rider for the wrong reason.
 */
test.describe("One-way platform fixture", () => {
  test("rider lands from above, jumper passes from below, drop-through falls out", async ({
    page,
  }) => {
    await gotoFixture(page, "/one-way-platform.html");
    await waitForClock(page);

    // Rider falls ~290px onto the platform (top at 390, half-height 12 →
    // resting center ≈ 378); jumper rises through it from below.
    await stepFrames(page, 180);

    const rider = await getEntityPosition(page, "rider");
    expect(rider).toBeDefined();
    expect(rider!.y).toBeGreaterThan(370);
    expect(rider!.y).toBeLessThan(386);

    // The jumper launched at -1000px/s from y=560: it passed through the
    // platform on the way up and has landed on top of it by now.
    const jumper = await getEntityPosition(page, "jumper");
    expect(jumper).toBeDefined();
    expect(jumper!.y).toBeGreaterThan(370);
    expect(jumper!.y).toBeLessThan(386);

    // The filter must have run cleanly — a throwing filter would also land
    // the rider, via the report-and-stay-solid fallback.
    const snapshot = await getSnapshot(page);
    expect(snapshot.errors.callbackErrors).toEqual([]);

    await page.evaluate(() =>
      (
        window as unknown as { __oneWay__: { dropThrough: () => void } }
      ).__oneWay__.dropThrough(),
    );
    await stepFrames(page, 60);

    const dropped = await getEntityPosition(page, "rider");
    expect(dropped).toBeDefined();
    expect(dropped!.y).toBeGreaterThan(420);

    // The jumper is unaffected by the rider's drop-through.
    const stillThere = await getEntityPosition(page, "jumper");
    expect(stillThere!.y).toBeGreaterThan(370);
    expect(stillThere!.y).toBeLessThan(386);

    const finalSnapshot = await getSnapshot(page);
    expect(finalSnapshot.errors.callbackErrors).toEqual([]);
  });
});
