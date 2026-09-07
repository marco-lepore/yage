import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoFixture, waitForClock, stepFrames } from "./helpers.js";

/**
 * A `shockwave` ring travels `speed × time` from its trigger point, and the
 * preset's `direction` decides which end of that ramp it starts at. The spec
 * measures the ring's radius after each block of stepped frames and checks it
 * grows for `"out"` and shrinks for `"in"`, whatever the window shape, the
 * letterbox bars or the device pixel ratio.
 *
 * The ring is located by differencing each capture against the pre-trigger
 * canvas over a band of rows through the trigger point. Only the right-hand
 * side is measured: a ring wider than about 380 virtual px runs off the left
 * edge from a trigger point at virtual x 420.
 */

interface ShockwaveAPI {
  speed: number;
  duration: number;
  trigger(x: number, y: number): void;
  canvasToVirtual(x: number, y: number): { x: number; y: number };
  virtualToCanvas(x: number, y: number): { x: number; y: number };
}

type ShockwaveWin = Window & { __shockwaveDirection__?: ShockwaveAPI };

// Each case screenshots a full canvas five times and diffs a band of every
// one; at device pixel ratio 2 that takes over 20 s on an idle machine.
test.setTimeout(180_000);

/** Trigger point in virtual pixels. */
const TRIGGER = { x: 420, y: 400 };

/** Milliseconds per stepped frame, and frames per measured block. */
const FRAME_MS = 50;
const FRAMES_PER_BLOCK = 4;

/** Half-height, in screenshot rows, of the band searched for the ring. */
const BAND_RADIUS = 2;

/** Summed |ΔR| + |ΔG| + |ΔB| above which a pixel counts as displaced. */
const DIFF_THRESHOLD = 60;

/** Measured error stayed under 5 px; a reversed ramp misses by 100 or more. */
const TOLERANCE_VIRTUAL_PX = 10;

const HOST_SHAPES = [
  { label: "bars left and right", width: 1200, height: 560 },
  { label: "bars top and bottom", width: 900, height: 700 },
];

async function capture(page: Page, canvas: Locator): Promise<string> {
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
 * Screenshot x of the middle of the displaced band to the right of `centerX`,
 * or `undefined` when the two captures match there. Decoding happens in the
 * page so the pixel arrays never cross the process boundary.
 */
async function ringEdgeX(
  page: Page,
  baseline: string,
  shot: string,
  centerX: number,
  centerY: number,
): Promise<number | undefined> {
  return page.evaluate(
    async ({ a, b, cx, cy, band, limit }) => {
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
      const top = Math.max(0, Math.round(cy) - band);
      const bottom = Math.min(first.height - 1, Math.round(cy) + band);
      const from = Math.max(0, Math.round(cx) + 1);
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      for (let y = top; y <= bottom; y += 1) {
        for (let x = from; x < first.width; x += 1) {
          const i = (y * first.width + x) * 4;
          const delta =
            Math.abs(first.data[i]! - second.data[i]!) +
            Math.abs(first.data[i + 1]! - second.data[i + 1]!) +
            Math.abs(first.data[i + 2]! - second.data[i + 2]!);
          if (delta <= limit) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (minX > maxX) return undefined;
      return (minX + maxX) / 2;
    },
    {
      a: baseline,
      b: shot,
      cx: centerX,
      cy: centerY,
      band: BAND_RADIUS,
      limit: DIFF_THRESHOLD,
    },
  );
}

for (const dpr of [1, 2]) {
  test.describe(`shockwave direction at device pixel ratio ${dpr}`, () => {
    test.use({
      deviceScaleFactor: dpr,
      viewport: { width: 1400, height: 900 },
    });

    for (const shape of HOST_SHAPES) {
      for (const direction of ["out", "in"] as const) {
        const travel =
          direction === "out"
            ? "an outward ring travels away from"
            : "an inward ring travels onto";
        test(`${travel} its trigger point (${shape.label})`, async ({
          page,
        }) => {
          await gotoFixture(
            page,
            `/shockwave-direction.html?hostWidth=${shape.width}` +
              `&hostHeight=${shape.height}&resolution=${dpr}` +
              `&direction=${direction}`,
          );
          await page.waitForFunction(
            () => (window as ShockwaveWin).__shockwaveDirection__ !== undefined,
          );
          await waitForClock(page);

          const canvas = page.locator("canvas").first();
          const baseline = await capture(page, canvas);

          const center = await page.evaluate((point) => {
            const api = (window as ShockwaveWin).__shockwaveDirection__!;
            api.trigger(point.x, point.y);
            return api.virtualToCanvas(point.x, point.y);
          }, TRIGGER);

          const measured: number[] = [];
          for (let block = 0; block < 4; block += 1) {
            await stepFrames(page, FRAMES_PER_BLOCK, FRAME_MS);
            const shot = await capture(page, canvas);
            const edge = await ringEdgeX(
              page,
              baseline,
              shot,
              center.x * dpr,
              center.y * dpr,
            );
            if (edge === undefined) {
              throw new Error(`no ring found after block ${block + 1}`);
            }
            const virtual = await page.evaluate(
              ({ x, y, scale }) => {
                const api = (window as ShockwaveWin).__shockwaveDirection__!;
                return api.canvasToVirtual(x / scale, y / scale);
              },
              { x: edge, y: center.y * dpr, scale: dpr },
            );
            measured.push(virtual.x - TRIGGER.x);
          }

          const expected =
            direction === "out" ? [100, 200, 300, 400] : [400, 300, 200, 100];
          for (const [index, radius] of expected.entries()) {
            expect(
              Math.abs(measured[index]! - radius),
              `block ${index + 1} radius ${measured[index]}`,
            ).toBeLessThanOrEqual(TOLERANCE_VIRTUAL_PX);
          }
        });
      }
    }
  });
}
