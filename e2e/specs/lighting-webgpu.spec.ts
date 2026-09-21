import { expect, test } from "@playwright/test";
import {
  BORDER_PROBES,
  CONE_PROBES,
  INSIDE_WALL,
  expectPictureMatchesQuery,
  levelsAlong,
  open,
  readBackend,
  setIntensities,
} from "./lighting-soft-probe.js";

/**
 * The soft-lighting probes through the WebGPU backend, which runs the shader
 * renderer's WGSL rather than its GLSL.
 *
 * Chromium hands out a WebGPU adapter only when it is started with the
 * machine's own graphics processor, so these tests ask the fixture which
 * backend it got and skip where there is none, rather than quietly measuring
 * WebGL a second time.
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

const NO_ADAPTER = "Chromium started without a WebGPU adapter";

test.describe("Soft lighting on WebGPU", () => {
  test("draws the shadow border the query reports", async ({ page }) => {
    await open(page, "?backend=webgpu&renderer=shader&size=24");
    test.skip((await readBackend(page)) !== "webgpu", NO_ADAPTER);
    await setIntensities(page, 1, 0);

    const levels = await levelsAlong(page, BORDER_PROBES);

    expect(Math.min(...levels.queried)).toBeLessThan(0.1);
    expect(Math.max(...levels.queried)).toBeGreaterThan(0.4);
    expectPictureMatchesQuery(levels);
  });

  test("fades a spotlight over the share of its spread it is given", async ({
    page,
  }) => {
    await open(page, "?backend=webgpu&renderer=shader&softness=0.6");
    test.skip((await readBackend(page)) !== "webgpu", NO_ADAPTER);
    await setIntensities(page, 0, 1);

    const levels = await levelsAlong(page, CONE_PROBES);

    expect(Math.max(...levels.queried)).toBeGreaterThan(0.5);
    expectPictureMatchesQuery(levels);
  });

  test("draws a pixel inside a wall dark when the lamp reaches into it", async ({
    page,
  }) => {
    await open(page, "?backend=webgpu&renderer=shader&size=24&lampX=232");
    test.skip((await readBackend(page)) !== "webgpu", NO_ADAPTER);
    await setIntensities(page, 1, 0);

    const levels = await levelsAlong(page, INSIDE_WALL);

    expect(levels.queried).toEqual([0, 0, 0, 0, 0]);
    expectPictureMatchesQuery(levels);
  });
});
