import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

interface Probe {
  level: number;
  screenX: number;
  screenY: number;
}

interface LightingAPI {
  frames(): number;
  probe(x: number, y: number): Probe;
  setFillIntensity(intensity: number): void;
}

type LightingWindow = Window & { __lighting__?: LightingAPI };

/** Wait for the scene to have run and drawn a few frames. */
async function settle(page: Page): Promise<void> {
  const from = await page.evaluate(() => {
    const value = (window as LightingWindow).__lighting__;
    return value ? value.frames() : 0;
  });
  await page.waitForFunction((target) => {
    const value = (window as LightingWindow).__lighting__;
    return value !== undefined && value.frames() > target;
  }, from + 3);
}

/**
 * The floor is white and the ambient level is zero, so a canvas pixel carries
 * the light level the overlay drew there: 0 is unlit, 1 is fully lit.
 */
async function drawnLevels(page: Page, probes: Probe[]): Promise<number[]> {
  const image = PNG.sync.read(await page.locator("canvas").screenshot());
  return probes.map((probe) => {
    const offset =
      (Math.round(probe.screenY) * image.width + Math.round(probe.screenX)) * 4;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    return (red + green + blue) / 3 / 255;
  });
}

async function probe(page: Page, x: number, y: number): Promise<Probe> {
  return page.evaluate(
    ([px, py]) => {
      const value = (window as LightingWindow).__lighting__;
      if (!value) throw new Error("__lighting__ is not available");
      return value.probe(px as number, py as number);
    },
    [x, y],
  );
}

test.describe("Lighting shadows", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/lighting-shadows.html");
    await page.waitForFunction(
      () => (window as LightingWindow).__lighting__ !== undefined,
    );
    await settle(page);
    expect(errors).toEqual([]);
  });

  test("draws the same shadow the query reports", async ({ page }) => {
    // Straight behind the wall, and the same distance from the lamp with
    // nothing in the way.
    const shadowed = await probe(page, 290, 200);
    const lit = await probe(page, 200, 290);
    expect(shadowed.level).toBe(0);
    expect(lit.level).toBeCloseTo(0.5, 2);

    const [drawnShadow, drawnLit] = await drawnLevels(page, [shadowed, lit]);
    expect(drawnShadow).toBeLessThan(0.08);
    expect(drawnLit).toBeCloseTo(lit.level, 1);
  });

  test("lets a light that ignores occluders reach into the shadow", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const value = (window as LightingWindow).__lighting__;
      if (!value) throw new Error("__lighting__ is not available");
      value.setFillIntensity(0.6);
    });
    await settle(page);

    const shadowed = await probe(page, 290, 200);
    expect(shadowed.level).toBeCloseTo(0.3, 2);

    const [drawnShadow] = await drawnLevels(page, [shadowed]);
    expect(drawnShadow).toBeCloseTo(shadowed.level, 1);
  });
});
