import { expect, test } from "@playwright/test";
import { getEntityByName, getSceneStack, gotoFixture } from "./helpers";

test.describe("Scene stack fixture", () => {
  test("pushes, pops, and replaces scenes deterministically", async ({ page }) => {
    await gotoFixture(page, "/scene-stack.html");

    let stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "base-marker")).toBeDefined();

    await page.evaluate(async () => {
      await (window as Window & {
        __sceneStackTest__: { pushOverlay(): Promise<void> };
      }).__sceneStackTest__.pushOverlay();
    });

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

    await page.evaluate(() => {
      (
        window as Window & {
          __sceneStackTest__: { popTop(): void };
        }
      ).__sceneStackTest__.popTop();
    });

    stack = await getSceneStack(page);
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      name: "base-scene",
      paused: false,
    });
    expect(await getEntityByName(page, "overlay-marker")).toBeUndefined();
    expect(await getEntityByName(page, "base-marker")).toBeDefined();

    await page.evaluate(async () => {
      await (
        window as Window & {
          __sceneStackTest__: { replaceWithReplacement(): Promise<void> };
        }
      ).__sceneStackTest__.replaceWithReplacement();
    });

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
