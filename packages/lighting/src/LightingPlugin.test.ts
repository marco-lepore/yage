import {
  createMockScene,
  Phase,
  SceneHookRegistry,
  SceneHookRegistryKey,
  SystemScheduler,
} from "@yagejs/core";
import { RendererKey } from "@yagejs/renderer";
import type { RendererPlugin } from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightingPlugin } from "./LightingPlugin.js";
import { LightingSystem } from "./LightingSystem.js";
import type { LightingRenderer } from "./types.js";
import { LightingWorldKey, LightingWorldManagerKey } from "./types.js";

describe("LightingPlugin", () => {
  it("registers a scoped query-only world for each scene", async () => {
    const { scene, context } = createMockScene();
    const hooks = new SceneHookRegistry();
    context.register(SceneHookRegistryKey, hooks);
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({
      ambient: { level: 0.25, color: 0x123456 },
      renderer: null,
    });

    plugin.install(context);
    await hooks.runBeforeEnter(scene);

    const world = scene.tryResolveScoped(LightingWorldKey);
    expect(world?.ambientLevel).toBe(0.25);
    expect(world?.ambientColor).toBe(0x123456);
    expect(context.resolve(LightingWorldManagerKey).getWorld(scene)).toBe(
      world,
    );

    hooks.runAfterExit(scene);
    expect(
      context.resolve(LightingWorldManagerKey).getWorld(scene),
    ).toBeUndefined();
    plugin.onDestroy();
  });

  it("creates and destroys one custom renderer per scene", async () => {
    const { scene, context } = createMockScene();
    const hooks = new SceneHookRegistry();
    const destroy = vi.fn();
    const backend: LightingRenderer = {
      render: vi.fn(),
      destroy,
    };
    const factory = vi.fn(() => backend);
    context.register(SceneHookRegistryKey, hooks);
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({ renderer: factory });

    plugin.install(context);
    await hooks.runBeforeEnter(scene);
    expect(factory).toHaveBeenCalledTimes(1);

    hooks.runAfterExit(scene);
    expect(destroy).toHaveBeenCalledTimes(1);
    plugin.onDestroy();
  });

  it("registers LightingSystem after the renderer's render work", () => {
    const scheduler = new SystemScheduler();
    new LightingPlugin({ renderer: null }).registerSystems(scheduler);

    const systems = scheduler.getSystems(Phase.Render);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toBeInstanceOf(LightingSystem);
    expect(systems[0]?.priority).toBe(100);
  });
});
