import { expect, test } from "@playwright/test";
import {
  openBaseline,
  read,
  readLighting,
  waitForSettled,
} from "./baseline-probe.js";

/**
 * The baseline fixture through the WebGPU backend, which draws the lighting
 * renderer's WGSL rather than its GLSL.
 *
 * Chromium hands out a WebGPU adapter only when it is started with the
 * machine's own graphics processor, so this spec asks the page which backend
 * it got and skips where there is none, rather than measuring WebGL twice.
 * What one adapter on one machine reports is that machine's answer.
 */
test.use({
  launchOptions: {
    args: [
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      // Chromium picks its own backend elsewhere; Metal is the one this flag
      // names and it exists only on macOS.
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ],
  },
});

test("the fixture draws every case on a WebGPU device", async ({ page }) => {
  await openBaseline(page, "?backend=webgpu");
  await waitForSettled(page);
  const reading = await read(page);
  const graphics = reading.readings["display"]!["graphics"] as Record<
    string,
    unknown
  >;
  test.skip(
    graphics["backend"] !== "webgpu",
    "Chromium started without a WebGPU adapter",
  );

  expect(reading.errors.callbackErrors).toEqual([]);
  expect(graphics["maxSamples"]).toBe(4);
  expect(await readLighting(page)).toMatchObject([
    { scene: "baseline", fallback: null },
  ]);
});
