import { expect, test } from "@playwright/test";
import type { EngineSnapshot } from "@yagejs/core";
import {
  getEntityByName,
  getSceneStack,
  getSnapshot,
  gotoFixture,
  stepFrames,
  waitForClock,
  waitForSceneStackLength,
} from "./helpers.js";

test.describe("Inspector scene sanity", () => {
  test("freely-running frames agree across diagnostics and pending destroys use one count", async ({
    page,
  }) => {
    await gotoFixture(page, "/inspector-scene.html");
    await waitForClock(page);
    await page.waitForFunction(
      () => window.__yage__?.inspector.getExtension("sanity") !== undefined,
    );
    const baseline = await page.evaluate(() => {
      const time = window.__yage__!.inspector.time;
      const frame = time.getFrame();
      time.thaw();
      return frame;
    });
    await page.waitForFunction(
      (frame) => window.__yage__!.inspector.time.getFrame() >= frame + 5,
      baseline,
    );
    const readings = await page.evaluate(() => {
      const inspector = window.__yage__!.inspector;
      inspector.time.freeze();
      const sanity = inspector.getExtension<{
        frameReadings(): Record<string, number>;
      }>("sanity")!;
      return sanity.frameReadings();
    });
    expect(readings.loop).toBeGreaterThan(baseline);
    expect(new Set(Object.values(readings)).size).toBe(1);
    const snapshot = await page.evaluate(() =>
      window
        .__yage__!.inspector.getExtension<{
          destroyPendingSnapshot(): EngineSnapshot;
        }>("sanity")!
        .destroyPendingSnapshot(),
    );
    const sceneCount = snapshot.scenes.reduce(
      (count, scene) => count + scene.entities.length,
      0,
    );
    expect(snapshot.entityCount).toBe(sceneCount);
    expect(
      snapshot.sceneStack.reduce(
        (count, scene) => count + scene.entityCount,
        0,
      ),
    ).toBe(sceneCount);
  });

  test("inspector sees initial scene and delayed push", async ({ page }) => {
    await gotoFixture(page, "/inspector-scene.html");
    await waitForClock(page);
    // The fixture pushes base-scene after engine.start() resolves; wait for it
    // before reading the stack rather than relying on waitForClock's slack.
    await waitForSceneStackLength(page, 1);

    const initialStack = await getSceneStack(page);
    expect(initialStack).toHaveLength(1);
    expect(initialStack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });

    const baseMarker = await getEntityByName(page, "base-marker");
    expect(baseMarker).toBeDefined();
    expect(baseMarker?.components).toContain("Transform");

    await stepFrames(page, 3);

    const stacked = await getSceneStack(page);
    expect(stacked).toHaveLength(2);
    expect(stacked[0]).toMatchObject({
      name: "base-scene",
      paused: true,
    });
    expect(stacked[1]).toMatchObject({
      name: "overlay-scene",
      paused: false,
    });

    const overlayMarker = await getEntityByName(page, "overlay-marker");
    expect(overlayMarker).toBeDefined();
    expect(overlayMarker?.components).toContain("Transform");

    const snapshot = await getSnapshot(page);
    expect(snapshot.sceneStack).toHaveLength(2);
    expect(snapshot.entityCount).toBeGreaterThanOrEqual(2);
    expect(snapshot.frame).toBeGreaterThan(0);
  });
});
