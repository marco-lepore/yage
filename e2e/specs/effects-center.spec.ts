import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoFixture } from "./helpers.js";

/**
 * `bulgePinch` takes its center in the effect host's own coordinates, so the
 * lens must land on that point whatever the window shape, the letterbox bars
 * or the device pixel ratio. The scene's content is larger than the viewport,
 * which makes the rasterized filter region cover the whole canvas — bars
 * included — instead of matching the play area.
 *
 * The lens is located by differencing two captures of the same canvas, one at
 * intensity 0 and one at intensity 1. Both go through the attached filter: a
 * capture with the filter detached is useless at a device pixel ratio of 2,
 * because the filter's own rasterization then changes every pixel.
 */

interface EffectsCenterAPI {
  center: { x: number; y: number };
  setIntensity(value: number): void;
  canvasToVirtual(x: number, y: number): { x: number; y: number };
}

type CenterWin = Window & { __effectsCenter__?: EffectsCenterAPI };

// Each case screenshots a full canvas twice and diffs every pixel in the page;
// at device pixel ratio 2 that takes over 20 s on an idle machine.
test.setTimeout(120_000);

/** Pixels within this distance of the named center pass. */
const TOLERANCE_VIRTUAL_PX = 6;

/** Summed |ΔR| + |ΔG| + |ΔB| above which a pixel counts as distorted. */
const DIFF_THRESHOLD = 60;

const HOST_SHAPES = [
  { label: "bars left and right", width: 1200, height: 560 },
  { label: "bars top and bottom", width: 900, height: 700 },
];

async function captureAt(
  page: Page,
  canvas: Locator,
  intensity: number,
): Promise<string> {
  await page.evaluate((value) => {
    const api = (window as CenterWin).__effectsCenter__;
    if (!api) throw new Error("__effectsCenter__ controls are not available");
    api.setIntensity(value);
  }, intensity);
  // Two frames: one applies the uniform, one guarantees it reached the canvas.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  return (await canvas.screenshot()).toString("base64");
}

/**
 * Center of the region that differs between the two captures, in screenshot
 * pixels. Decoding happens in the page so the pixel arrays never cross the
 * process boundary.
 */
async function diffCenter(
  page: Page,
  flat: string,
  bulged: string,
  threshold: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    async ({ a, b, limit }) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = surface.getContext("2d");
        if (!ctx) throw new Error("2D context unavailable");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };

      const first = await decode(a);
      const second = await decode(b);
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let y = 0; y < first.height; y += 1) {
        for (let x = 0; x < first.width; x += 1) {
          const i = (y * first.width + x) * 4;
          const delta =
            Math.abs(first.data[i]! - second.data[i]!) +
            Math.abs(first.data[i + 1]! - second.data[i + 1]!) +
            Math.abs(first.data[i + 2]! - second.data[i + 2]!);
          if (delta <= limit) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (minX > maxX) throw new Error("the two captures are identical");
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    },
    { a: flat, b: bulged, limit: threshold },
  );
}

for (const dpr of [1, 2]) {
  test.describe(`effect center at device pixel ratio ${dpr}`, () => {
    test.use({
      deviceScaleFactor: dpr,
      viewport: { width: 1400, height: 900 },
    });

    for (const shape of HOST_SHAPES) {
      test(`bulgePinch lens sits on its host-local center (${shape.label})`, async ({
        page,
      }) => {
        await gotoFixture(
          page,
          `/effects-center.html?hostWidth=${shape.width}` +
            `&hostHeight=${shape.height}&resolution=${dpr}`,
        );
        await page.waitForFunction(
          () => (window as CenterWin).__effectsCenter__ !== undefined,
        );

        const canvas = page.locator("canvas").first();
        const flat = await captureAt(page, canvas, 0);
        const bulged = await captureAt(page, canvas, 1);
        const shot = await diffCenter(page, flat, bulged, DIFF_THRESHOLD);

        const measured = await page.evaluate(
          ({ x, y, scale }) => {
            const api = (window as CenterWin).__effectsCenter__!;
            const virtual = api.canvasToVirtual(x / scale, y / scale);
            return { virtual, center: api.center };
          },
          { x: shot.x, y: shot.y, scale: dpr },
        );

        expect(
          Math.abs(measured.virtual.x - measured.center.x),
        ).toBeLessThanOrEqual(TOLERANCE_VIRTUAL_PX);
        expect(
          Math.abs(measured.virtual.y - measured.center.y),
        ).toBeLessThanOrEqual(TOLERANCE_VIRTUAL_PX);
      });
    }
  });
}
