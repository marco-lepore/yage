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
  setSpotIntensity(intensity: number): void;
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

/** Load the fixture, with an optional query string, and wait until it drew. */
async function open(page: Page, query = ""): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/lighting-shadows.html${query}`);
  await page.waitForFunction(
    () => (window as LightingWindow).__lighting__ !== undefined,
  );
  await settle(page);
  expect(errors).toEqual([]);
}

test.describe("Lighting shadows", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
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

  test("draws a spotlight over the directions its cone covers", async ({
    page,
  }) => {
    const before = await probe(page, 200, 290);
    await page.evaluate(() => {
      const value = (window as LightingWindow).__lighting__;
      if (!value) throw new Error("__lighting__ is not available");
      value.setSpotIntensity(0.5);
    });
    await settle(page);

    // Both points are 90 pixels from the lamp; the cone covers only the first.
    const inside = await probe(page, 200, 290);
    const outside = await probe(page, 110, 200);
    expect(inside.level).toBeCloseTo(before.level + 0.25, 2);
    expect(outside.level).toBeCloseTo(before.level, 2);

    const [drawnInside, drawnOutside] = await drawnLevels(page, [
      inside,
      outside,
    ]);
    expect(drawnInside).toBeCloseTo(inside.level, 1);
    expect(drawnOutside).toBeCloseTo(outside.level, 1);
  });
});

test.describe("Bounced light", () => {
  /** The drawn and queried level just past the wall's shadow edge. */
  async function shadowLevels(
    page: Page,
    query: string,
  ): Promise<{ drawn: number; queried: number }> {
    await open(page, query);
    const shadowed = await probe(page, 290, 200);
    const [drawn] = await drawnLevels(page, [shadowed]);
    return { drawn: drawn ?? 0, queried: shadowed.level };
  }

  test("brightens the shadow without changing what the query reports", async ({
    page,
  }) => {
    const plain = await shadowLevels(page, "");
    const bounced = await shadowLevels(page, "?bounce=1");

    expect(bounced.drawn).toBeGreaterThan(plain.drawn + 0.05);
    expect(bounced.queried).toBe(plain.queried);
    expect(bounced.queried).toBe(0);
  });
});
