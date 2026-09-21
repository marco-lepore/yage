import {
  createMockScene,
  Phase,
  SceneHookRegistry,
  SceneHookRegistryKey,
  SystemScheduler,
} from "@yagejs/core";
import { RendererKey, SceneRenderTreeKey } from "@yagejs/renderer";
import type {
  RenderTargetHandle,
  RendererPlugin,
  SceneRenderTree,
} from "@yagejs/renderer";
import { Container, Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { LightingPlugin } from "./LightingPlugin.js";
import { LightingSystem } from "./LightingSystem.js";
import type { LightingRenderer } from "./types.js";
import { LightingWorldKey, LightingWorldManagerKey } from "./types.js";

/** A render tree that hands out one screen-space layer. */
function stubRenderTree(): SceneRenderTree {
  const container = new Container();
  return {
    ensureLayer: () => ({ name: "lighting", space: "screen", container }),
  } as unknown as SceneRenderTree;
}

function stubRenderTarget(): RenderTargetHandle {
  return {
    texture: Texture.EMPTY,
    invalidate: vi.fn(),
    render: vi.fn(),
    renderIfNeeded: vi.fn(() => true),
    resize: vi.fn(),
    destroy: vi.fn(),
  } as unknown as RenderTargetHandle;
}

describe("LightingPlugin", () => {
  it("registers a scoped query-only world for each scene", async () => {
    const { scene, context } = createMockScene();
    const hooks = new SceneHookRegistry();
    context.register(SceneHookRegistryKey, hooks);
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({
      ambient: { level: 0.25, color: 0x123456 },
      renderers: { none: null },
      defaultRenderer: "none",
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
    const plugin = new LightingPlugin({
      renderers: { custom: factory },
      defaultRenderer: "custom",
    });

    plugin.install(context);
    await hooks.runBeforeEnter(scene);
    expect(factory).toHaveBeenCalledTimes(1);

    hooks.runAfterExit(scene);
    expect(destroy).toHaveBeenCalledTimes(1);
    plugin.onDestroy();
  });

  it('configures the built-in overlay under the name "overlay"', async () => {
    const { scene, context } = createMockScene();
    Object.assign(scene, { lighting: { renderer: "overlay" } });
    const hooks = new SceneHookRegistry();
    const createRenderTarget = vi.fn(() => stubRenderTarget());
    scene.registerScoped(SceneRenderTreeKey, stubRenderTree());
    context.register(SceneHookRegistryKey, hooks);
    context.register(RendererKey, {
      virtualSize: { width: 800, height: 600 },
      createRenderTarget,
    } as unknown as RendererPlugin);
    const plugin = new LightingPlugin();

    plugin.install(context);
    await hooks.runBeforeEnter(scene);

    // Only the built-in overlay builds a light buffer of its own.
    expect(createRenderTarget).toHaveBeenCalledTimes(1);
    plugin.onDestroy();
  });

  it("requires a default renderer once a game configures its own", () => {
    const { context } = createMockScene();
    context.register(SceneHookRegistryKey, new SceneHookRegistry());
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({
      renderers: { hard: null, soft: null },
    });

    expect(() => plugin.install(context)).toThrow(
      "LightingPlugin has its own renderers, so defaultRenderer must name " +
        'one of them: "hard", "soft".',
    );
  });

  it("rejects a default renderer that is not one of the configured ones", () => {
    const { context } = createMockScene();
    context.register(SceneHookRegistryKey, new SceneHookRegistry());
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({
      renderers: { hard: null, soft: null },
      defaultRenderer: "glow",
    });

    expect(() => plugin.install(context)).toThrow(
      'LightingPlugin defaultRenderer "glow" is not one of the configured ' +
        'renderers: "hard", "soft".',
    );
  });

  it("rejects a default renderer named without a renderer map", () => {
    const { context } = createMockScene();
    context.register(SceneHookRegistryKey, new SceneHookRegistry());
    context.register(RendererKey, {} as RendererPlugin);
    const plugin = new LightingPlugin({ defaultRenderer: "glow" });

    expect(() => plugin.install(context)).toThrow(
      'LightingPlugin defaultRenderer "glow" is not one of the configured ' +
        'renderers: "overlay".',
    );
  });

  it("rejects a default bounce outside its ranges", () => {
    const { context } = createMockScene();
    context.register(SceneHookRegistryKey, new SceneHookRegistry());
    context.register(RendererKey, {} as RendererPlugin);

    expect(() =>
      new LightingPlugin({
        renderers: { none: null },
        defaultRenderer: "none",
        bounce: { strength: 1.5, radius: 24 },
      }).install(context),
    ).toThrow("LightingPlugin bounce strength");
    expect(() =>
      new LightingPlugin({
        renderers: { none: null },
        defaultRenderer: "none",
        bounce: { strength: 0.5, radius: 0 },
      }).install(context),
    ).toThrow("LightingPlugin bounce radius");
  });

  it("registers LightingSystem after the renderer's render work", () => {
    const scheduler = new SystemScheduler();
    new LightingPlugin({
      renderers: { none: null },
      defaultRenderer: "none",
    }).registerSystems(scheduler);

    const systems = scheduler.getSystems(Phase.Render);
    expect(systems).toHaveLength(1);
    expect(systems[0]).toBeInstanceOf(LightingSystem);
    expect(systems[0]?.priority).toBe(100);
  });
});
