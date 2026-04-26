import { test, expect, type Page } from "@playwright/test";
import { gotoFixture, waitForClock, stepFrames } from "./helpers.js";

interface LayerXform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

interface ParallaxAPI {
  setCameraPosition(x: number, y: number): void;
  setCameraZoom(z: number): void;
}

interface DebugDiagnostics {
  getLayerTransform(
    sceneName: string,
    layerName: string,
  ): LayerXform | undefined;
}

interface InspectorAPI {
  getExtension<T extends object>(namespace: string): T | undefined;
}

type ParallaxWin = Window & {
  __cameraTest__?: ParallaxAPI;
  __yage__?: { inspector: InspectorAPI };
};

async function waitForControls(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as ParallaxWin).__cameraTest__ !== undefined,
  );
}

async function setCamera(
  page: Page,
  position: { x: number; y: number },
  zoom = 1,
): Promise<void> {
  await page.evaluate(
    ({ x, y, z }) => {
      const api = (window as ParallaxWin).__cameraTest__;
      if (!api) throw new Error("__cameraTest__ controls are not available");
      api.setCameraPosition(x, y);
      api.setCameraZoom(z);
    },
    { x: position.x, y: position.y, z: zoom },
  );
  // DisplaySystem runs in Phase.Render — one frame applies transforms.
  await stepFrames(page, 1);
}

async function getLayer(page: Page, name: string): Promise<LayerXform | null> {
  return page.evaluate(
    (n) =>
      (window as ParallaxWin).__yage__?.inspector
        .getExtension<DebugDiagnostics>("debug")
        ?.getLayerTransform("parallax", n) ?? null,
    name,
  );
}

test.describe("Camera parallax — per-layer translateRatio bindings", () => {
  test("each bound layer reflects its translateRatio under camera motion", async ({
    page,
  }) => {
    await gotoFixture(page, "/camera-parallax.html");
    await waitForClock(page);
    await waitForControls(page);

    // Fixture viewport is 800x600; at camera (0,0) every bound layer sits
    // at (viewportW/2, viewportH/2) = (400, 300).
    await setCamera(page, { x: 0, y: 0 });
    for (const name of ["sky", "far", "mid", "world"]) {
      const l = await getLayer(page, name);
      expect(l, name).not.toBeNull();
      expect(l!.x).toBe(400);
      expect(l!.y).toBe(300);
    }

    // Move camera right by 100 world units at zoom 1.
    //   layer.x = viewportW/2 - camX * zoom * ratio = 400 - 100 * ratio
    await setCamera(page, { x: 100, y: 0 });

    const sky = await getLayer(page, "sky");
    const far = await getLayer(page, "far");
    const mid = await getLayer(page, "mid");
    const world = await getLayer(page, "world");

    expect(sky!.x).toBe(400 - 100 * 0.1); // 390
    expect(far!.x).toBe(400 - 100 * 0.3); // 370
    expect(mid!.x).toBe(400 - 100 * 0.6); // 340
    expect(world!.x).toBe(400 - 100 * 1); // 300

    // Far layers move less than near layers under horizontal motion.
    expect(Math.abs(sky!.x - 400)).toBeLessThan(Math.abs(far!.x - 400));
    expect(Math.abs(far!.x - 400)).toBeLessThan(Math.abs(mid!.x - 400));
    expect(Math.abs(mid!.x - 400)).toBeLessThan(Math.abs(world!.x - 400));
  });

  test("zoom scales every bound layer uniformly", async ({ page }) => {
    await gotoFixture(page, "/camera-parallax.html");
    await waitForClock(page);
    await waitForControls(page);

    await setCamera(page, { x: 0, y: 0 }, 2);

    for (const name of ["sky", "far", "mid", "world"]) {
      const l = await getLayer(page, name);
      expect(l!.scaleX, name).toBe(2);
      expect(l!.scaleY, name).toBe(2);
    }
  });

  test("UI layer (auto-provisioned, space: 'screen') stays at identity", async ({
    page,
  }) => {
    await gotoFixture(page, "/camera-parallax.html");
    await waitForClock(page);
    await waitForControls(page);

    // Aggressive camera movement + zoom — none of it should affect the UI.
    await setCamera(page, { x: 500, y: 300 }, 3);

    const ui = await getLayer(page, "ui");
    expect(
      ui,
      "ui layer should exist — UIPanel auto-provisions it",
    ).not.toBeNull();
    expect(ui!.x).toBe(0);
    expect(ui!.y).toBe(0);
    expect(ui!.scaleX).toBe(1);
    expect(ui!.scaleY).toBe(1);
    expect(ui!.rotation).toBe(0);
  });
});
