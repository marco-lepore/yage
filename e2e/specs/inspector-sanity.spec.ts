import { expect, test } from "@playwright/test";
import {
  getEntityByName,
  getSceneStack,
  getSnapshot,
  gotoFixture,
  waitForSceneStackLength,
} from "./helpers";

test.describe("Inspector scene sanity", () => {
  test("inspector sees initial scene and delayed push", async ({ page }) => {
    await gotoFixture(page, "/inspector-scene.html");

    const initialStack = await getSceneStack(page);
    expect(initialStack).toHaveLength(1);
    expect(initialStack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });

    const baseMarker = await getEntityByName(page, "base-marker");
    expect(baseMarker).toBeDefined();
    expect(baseMarker?.components).toContain("Transform");

    await waitForSceneStackLength(page, 2);

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
    expect(snapshot.frameCount).toBeGreaterThan(0);
  });
});
