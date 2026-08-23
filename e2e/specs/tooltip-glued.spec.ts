import { expect, test } from "@playwright/test";
import { gotoFixture, stepFrames, waitForClock } from "./helpers.js";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Probe {
  bubble: Box | null;
  trigger: Box;
}

async function probe(page: import("@playwright/test").Page): Promise<Probe> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__tooltip__.probe() as Probe;
  });
}

test.describe("imperative attachTooltip (non-React) stays glued", () => {
  test("bubble shows on hover, hides on out, and tracks the trigger", async ({
    page,
  }) => {
    await gotoFixture(page, "/tooltip-glued.html");
    await waitForClock(page);
    await stepFrames(page, 2);

    // Hidden until hovered.
    let p = await probe(page);
    expect(p.bubble).toBeNull();

    // Hover → the overlay positions + shows the bubble on the next tick.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__tooltip__.show();
    });
    await stepFrames(page, 1);

    p = await probe(page);
    expect(p.bubble).not.toBeNull();

    // The bubble is centered over the trigger, a fixed gap above it
    // (placement: "top", offset 8). Sample across camera motion and assert
    // the relationship holds — the float stays glued.
    const samples: Array<{ dxCenter: number; gap: number; triggerX: number }> =
      [];
    for (let i = 0; i < 5; i++) {
      const s = await probe(page);
      if (!s.bubble) throw new Error("bubble disappeared mid-motion");
      const bubbleCenterX = s.bubble.x + s.bubble.width / 2;
      const triggerCenterX = s.trigger.x + s.trigger.width / 2;
      samples.push({
        dxCenter: bubbleCenterX - triggerCenterX,
        // gap between bubble bottom and trigger top.
        gap: s.trigger.y - (s.bubble.y + s.bubble.height),
        triggerX: triggerCenterX,
      });
      await stepFrames(page, 8);
    }

    // The trigger actually moved across the screen (not a static check).
    const travel = Math.abs(samples.at(-1)!.triggerX - samples[0]!.triggerX);
    expect(travel).toBeGreaterThan(20);

    // Centered over the trigger (within sub-pixel rounding) on every sample.
    for (const s of samples) {
      expect(Math.abs(s.dxCenter)).toBeLessThan(1.5);
      // Gap stays at the configured offset (8) across samples.
      expect(s.gap).toBeGreaterThan(6);
      expect(s.gap).toBeLessThan(10);
    }

    // Pointer-out → hidden again.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__tooltip__.hide();
    });
    await stepFrames(page, 1);
    p = await probe(page);
    expect(p.bubble).toBeNull();
  });
});
