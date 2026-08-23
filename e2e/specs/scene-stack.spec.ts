import { expect, test } from "@playwright/test";
import {
  getEntityByName,
  getSceneStack,
  gotoFixture,
  waitForSceneStackLength,
  waitForTopScene,
} from "./helpers.js";

interface SceneStackTestApi {
  pushOverlay(): Promise<void>;
  popTop(): Promise<void>;
  replaceWithReplacement(): Promise<void>;
}

type Win = Window & { __sceneStackTest__?: SceneStackTestApi };

test.describe("Scene stack fixture", () => {
  test("pushes, pops, and replaces scenes deterministically", async ({ page }) => {
    await gotoFixture(page, "/scene-stack.html");
    // The fixture pushes base-scene after engine.start() resolves; gotoFixture
    // only waits for the inspector to exist, so gate on the scene being present.
    await waitForSceneStackLength(page, 1);

    let stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "base-marker")).toBeDefined();

    await page.evaluate(async () => {
      await (window as Win).__sceneStackTest__!.pushOverlay();
    });

    await waitForTopScene(page, "overlay-scene");
    stack = await getSceneStack(page);
    expect(stack).toHaveLength(2);
    expect(stack[0]).toMatchObject({
      name: "base-scene",
      paused: true,
    });
    expect(stack[1]).toMatchObject({
      name: "overlay-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "overlay-marker")).toBeDefined();

    await page.evaluate(async () => {
      await (window as Win).__sceneStackTest__!.popTop();
    });

    await waitForTopScene(page, "base-scene");
    stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "overlay-marker")).toBeUndefined();
    expect(await getEntityByName(page, "base-marker")).toBeDefined();

    await page.evaluate(async () => {
      await (window as Win).__sceneStackTest__!.replaceWithReplacement();
    });

    await waitForTopScene(page, "replacement-scene");
    stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      name: "replacement-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "base-marker")).toBeUndefined();
    expect(await getEntityByName(page, "replacement-marker")).toBeDefined();
  });
});
