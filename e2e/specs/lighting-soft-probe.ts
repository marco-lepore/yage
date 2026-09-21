/**
 * Shared probes for the soft-lighting fixture: the world points the specs
 * measure along, how a probe's queried level is read back, and how the drawn
 * pixel under it is sampled. Two spec files use them, because the WebGPU one
 * needs its own browser launch options.
 */
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PNG } from "pngjs";

interface Probe {
  level: number;
  screenX: number;
  screenY: number;
}

interface SoftLightingAPI {
  backend(): string;
  frames(): number;
  probe(x: number, y: number): Probe;
  setLampIntensity(intensity: number): void;
  setSpotIntensity(intensity: number): void;
}

type SoftWindow = Window & { __softLighting__?: SoftLightingAPI };

/**
 * How far the drawn level may sit from the queried one. The shader rounds each
 * hidden stretch of the lamp out to whole slots at both ends, which is two of
 * its hundred and twenty-eight per stretch, and the light buffer holds eight
 * bits a channel.
 */
export const TOLERANCE = 0.03;

/**
 * World points crossing the wall's shadow border. The lamp stands at
 * (200, 200) and the wall's lower corner at (238, 240), so the border runs
 * through about y = 305 on this line.
 */
export const BORDER_PROBES = [
  [300, 270],
  [300, 282],
  [300, 294],
  [300, 312],
  [300, 324],
  [300, 336],
];

/** Straight behind the wall, and the same distance out with nothing in the way. */
export const SHADOWED = [300, 200];
export const LIT = [200, 300];

/**
 * World points inside the wall, which spans x 238 to 262 and y 160 to 240.
 * With the lamp at `?lampX=232` a 24-pixel lamp reaches into the wall, so the
 * lamp points a pixel here can see are buried in the wall beside it.
 */
export const INSIDE_WALL = [
  [245, 200],
  [250, 180],
  [250, 200],
  [250, 220],
  [255, 200],
];

/** World points crossing the spotlight's cone edge, at one distance from it. */
export const CONE_PROBES = [4, 10, 16, 20, 24, 28, 34].map((degrees) => {
  const angle = (degrees * Math.PI) / 180;
  return [120 + Math.cos(angle) * 120, 200 + Math.sin(angle) * 120];
});

async function settle(page: Page): Promise<void> {
  const from = await page.evaluate(() => {
    const value = (window as SoftWindow).__softLighting__;
    return value ? value.frames() : 0;
  });
  await page.waitForFunction((target) => {
    const value = (window as SoftWindow).__softLighting__;
    return value !== undefined && value.frames() > target;
  }, from + 3);
}

/** The light level the renderer drew at each probe's screen position. */
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

export async function open(page: Page, query: string): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/lighting-soft.html${query}`);
  await page.waitForFunction(
    () => (window as SoftWindow).__softLighting__ !== undefined,
  );
  await settle(page);
  expect(errors).toEqual([]);
}

export async function setIntensities(
  page: Page,
  lamp: number,
  spot: number,
): Promise<void> {
  await page.evaluate(
    ([lampIntensity, spotIntensity]) => {
      const value = (window as SoftWindow).__softLighting__;
      if (!value) throw new Error("__softLighting__ is not available");
      value.setLampIntensity(lampIntensity ?? 0);
      value.setSpotIntensity(spotIntensity ?? 0);
    },
    [lamp, spot],
  );
  await settle(page);
}

/** Queried and drawn levels along one set of world points. */
export async function levelsAlong(
  page: Page,
  points: number[][],
): Promise<{ queried: number[]; drawn: number[] }> {
  const probes = await page.evaluate((list) => {
    const value = (window as SoftWindow).__softLighting__;
    if (!value) throw new Error("__softLighting__ is not available");
    return list.map((point) => value.probe(point[0] ?? 0, point[1] ?? 0));
  }, points);
  return {
    queried: probes.map((probe) => probe.level),
    drawn: await drawnLevels(page, probes),
  };
}

/** Assert the drawn picture equals the queried level at every probe. */
export function expectPictureMatchesQuery(levels: {
  queried: number[];
  drawn: number[];
}): void {
  for (const [index, level] of levels.queried.entries()) {
    const drawn = levels.drawn[index] ?? 0;
    expect(
      Math.abs(drawn - level),
      `probe ${index}: drawn ${drawn.toFixed(4)} against queried ` +
        `${level.toFixed(4)}`,
    ).toBeLessThanOrEqual(TOLERANCE);
  }
}

/** Which Pixi backend the fixture's renderer actually started. */
export async function readBackend(page: Page): Promise<string> {
  return page.evaluate(() => {
    const value = (window as SoftWindow).__softLighting__;
    return value ? value.backend() : "none";
  });
}
