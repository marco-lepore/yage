import { test, expect } from "@playwright/test";
import {
  gotoFixture,
  waitForClock,
  stepFrames,
  getEntityByName,
  getComponentData,
  getSceneStack,
} from "./helpers.js";

test.describe("Scene-scoped DI", () => {
  test("PhysicsWorldKey resolves in a component via this.use()", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-di.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const probe = await getComponentData<{ hasWorld: boolean }>(
      page,
      "physics-probe",
      "PhysicsProbe",
    );

    expect(probe).toBeDefined();
    expect(probe!.hasWorld).toBe(true);
  });

  test("SceneRenderTreeKey resolves and layers are accessible", async ({
    page,
  }) => {
    await gotoFixture(page, "/scene-di.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const probe = await getComponentData<{
      hasTree: boolean;
      layerCount: number;
      hasCustomLayer: boolean;
    }>(page, "render-tree-probe", "RenderTreeProbe");

    expect(probe).toBeDefined();
    expect(probe!.hasTree).toBe(true);
    // At least: default + bg + world = 3 layers
    expect(probe!.layerCount).toBeGreaterThanOrEqual(3);
    expect(probe!.hasCustomLayer).toBe(true);
  });

  test("scene is on the stack with correct name", async ({ page }) => {
    await gotoFixture(page, "/scene-di.html");
    await waitForClock(page);

    const stack = await getSceneStack(page);
    expect(stack.length).toBe(1);
    expect(stack[0]!.name).toBe("scene-a");
  });

  test("entities are created in the scene", async ({ page }) => {
    await gotoFixture(page, "/scene-di.html");
    await waitForClock(page);
    await stepFrames(page, 1);

    const physicsProbe = await getEntityByName(page, "physics-probe");
    expect(physicsProbe).toBeDefined();
    expect(physicsProbe!.components).toContain("PhysicsProbe");
    expect(physicsProbe!.components).toContain("RigidBodyComponent");

    const renderProbe = await getEntityByName(page, "render-tree-probe");
    expect(renderProbe).toBeDefined();
    expect(renderProbe!.components).toContain("RenderTreeProbe");

    const box = await getEntityByName(page, "box");
    expect(box).toBeDefined();
    expect(box!.components).toContain("GraphicsComponent");
  });
});
