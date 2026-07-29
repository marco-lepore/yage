import { createMockScene, Scene } from "@yagejs/core";
import type { EngineContext } from "@yagejs/core";
import { CameraComponent, RendererKey } from "@yagejs/renderer";
import type { RendererPlugin } from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightingSystem } from "./LightingSystem.js";
import { LightingWorld } from "./LightingWorld.js";
import type { LightingWorldManager } from "./LightingWorldManager.js";
import { LightingWorldManagerKey } from "./types.js";

class TestScene extends Scene {
  constructor(readonly name: string) {
    super();
  }
}

function createScene(context: EngineContext, name: string): Scene {
  const scene = new TestScene(name);
  scene._setContext(context);
  return scene;
}

describe("LightingSystem", () => {
  it("dispatches each scene with its highest-priority camera or null", () => {
    const { scene: firstScene, context } = createMockScene("first");
    const secondScene = createScene(context, "second");
    const noCameraScene = createScene(context, "no-camera");
    const firstWorld = new LightingWorld(firstScene);
    const secondWorld = new LightingWorld(secondScene);
    const noCameraWorld = new LightingWorld(noCameraScene);
    const firstRender = vi.spyOn(firstWorld, "_render");
    const secondRender = vi.spyOn(secondWorld, "_render");
    const noCameraRender = vi.spyOn(noCameraWorld, "_render");
    const worlds = new Map<Scene, LightingWorld>([
      [firstScene, firstWorld],
      [secondScene, secondWorld],
      [noCameraScene, noCameraWorld],
    ]);
    const manager = {
      getAllWorlds: () => worlds.entries(),
    } as unknown as LightingWorldManager;
    context.register(LightingWorldManagerKey, manager);
    context.register(RendererKey, {
      virtualSize: { width: 960, height: 540 },
    } as RendererPlugin);

    const lowPriority = firstScene
      .spawn("low-priority-camera")
      .add(new CameraComponent({ priority: 1 }));
    const highPriority = firstScene
      .spawn("high-priority-camera")
      .add(new CameraComponent({ priority: 10 }));
    const secondCamera = secondScene
      .spawn("second-camera")
      .add(new CameraComponent({ priority: 5 }));
    const system = new LightingSystem();
    system._setContext(context);
    system.onRegister(context);

    system.update();

    const frame = { width: 960, height: 540 };
    expect(firstRender).toHaveBeenLastCalledWith({
      ...frame,
      camera: highPriority,
    });
    expect(secondRender).toHaveBeenLastCalledWith({
      ...frame,
      camera: secondCamera,
    });
    expect(noCameraRender).toHaveBeenLastCalledWith({
      ...frame,
      camera: null,
    });

    highPriority.enabled = false;
    system.update();

    expect(firstRender).toHaveBeenLastCalledWith({
      ...frame,
      camera: lowPriority,
    });
  });
});
