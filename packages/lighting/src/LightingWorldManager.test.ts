import { createMockScene } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightingWorldManager } from "./LightingWorldManager.js";
import type { LightingWorldManagerOptions } from "./LightingWorldManager.js";
import type {
  LightingRenderer,
  LightingRendererFactory,
  SceneLightingOptions,
} from "./types.js";

/** A mock scene carrying a `lighting` property. */
function sceneWith(
  lighting: SceneLightingOptions,
): ReturnType<typeof createMockScene> {
  const mock = createMockScene();
  Object.assign(mock.scene, { lighting });
  return mock;
}

/** Manager options with one renderer under the default name. */
function options(
  factory: LightingRendererFactory | null,
  overrides: Partial<LightingWorldManagerOptions> = {},
): LightingWorldManagerOptions {
  return {
    ambient: {},
    renderers: { overlay: factory },
    defaultRenderer: "overlay",
    bounce: null,
    ...overrides,
  };
}

describe("LightingWorldManager", () => {
  it("returns the same query-only world for repeated scene lookups", () => {
    const { scene } = createMockScene();
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(null, { ambient: { level: 0.25 } }),
    );

    const world = manager.getOrCreateWorld(scene);

    expect(manager.getOrCreateWorld(scene)).toBe(world);
    expect(manager.getWorld(scene)).toBe(world);
    expect(world.ambientLevel).toBe(0.25);
  });

  it("creates and destroys one renderer with the scene world", () => {
    const { scene } = createMockScene();
    const renderer = {} as RendererPlugin;
    const destroy = vi.fn();
    const backend: LightingRenderer = {
      render: vi.fn(),
      destroy,
    };
    const factory = vi.fn(() => backend);
    const manager = new LightingWorldManager(renderer, options(factory));

    const world = manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith({
      scene,
      world,
      renderer,
      bounce: null,
    });

    manager.destroyWorld(scene);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(manager.getWorld(scene)).toBeUndefined();
  });

  it("hands the configured bounce to a scene that sets none", () => {
    const { scene } = createMockScene();
    const renderer = {} as RendererPlugin;
    const factory = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const bounce = { strength: 0.4, radius: 24 };
    const manager = new LightingWorldManager(
      renderer,
      options(factory, { bounce }),
    );

    manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ bounce }));
  });

  it("lets a scene's own bounce win over the configured one", () => {
    const own = { strength: 0.8, radius: 90 };
    const { scene } = sceneWith({ bounce: own });
    const factory = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(factory, { bounce: { strength: 0.4, radius: 24 } }),
    );

    manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ bounce: own }),
    );
  });

  it("lets a scene turn the configured bounce off with null", () => {
    const { scene } = sceneWith({ bounce: null });
    const factory = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(factory, { bounce: { strength: 0.4, radius: 24 } }),
    );

    manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ bounce: null }),
    );
  });

  it("falls through to the configured bounce when only a renderer is named", () => {
    const bounce = { strength: 0.4, radius: 24 };
    const { scene } = sceneWith({ renderer: "overlay" });
    const factory = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(factory, { bounce }),
    );

    manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ bounce }));
  });

  it("rejects a scene bounce outside its range, naming the scene", () => {
    const { scene } = sceneWith({ bounce: { strength: 2, radius: 24 } });
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(null),
    );

    expect(() => manager.getOrCreateWorld(scene)).toThrow(
      `Scene "${scene.name}" lighting bounce strength must be a finite ` +
        `number from 0 to 1, got 2.`,
    );
    expect(manager.getWorld(scene)).toBeUndefined();
  });

  it("builds the renderer the scene names", () => {
    const { scene } = sceneWith({ renderer: "soft" });
    const soft = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const hard = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(null, {
        renderers: { hard, soft },
        defaultRenderer: "hard",
      }),
    );

    manager.getOrCreateWorld(scene);

    expect(soft).toHaveBeenCalledTimes(1);
    expect(hard).not.toHaveBeenCalled();
  });

  it("draws nothing for a scene naming a null entry", () => {
    const { scene } = sceneWith({ renderer: "none" });
    const factory = vi.fn(() => ({ render: vi.fn(), destroy: vi.fn() }));
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(null, {
        renderers: { overlay: factory, none: null },
        defaultRenderer: "overlay",
      }),
    );

    const world = manager.getOrCreateWorld(scene);

    expect(factory).not.toHaveBeenCalled();
    expect(manager.getWorld(scene)).toBe(world);
  });

  it("rejects a scene naming a renderer that is not configured", () => {
    const { scene } = sceneWith({ renderer: "glow" });
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(null, {
        renderers: { hard: null, soft: null },
        defaultRenderer: "hard",
      }),
    );

    expect(() => manager.getOrCreateWorld(scene)).toThrow(
      `Scene "${scene.name}" asks for lighting renderer "glow", which is not ` +
        `configured. Configured renderers: "hard", "soft".`,
    );
    expect(manager.getWorld(scene)).toBeUndefined();
  });

  it("rejects a renderer factory that returns no backend", () => {
    const { scene } = createMockScene();
    const factory = vi.fn(() => undefined as unknown as LightingRenderer);
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(factory),
    );

    expect(() => manager.getOrCreateWorld(scene)).toThrow(
      `Lighting renderer factory returned no renderer for scene "${scene.name}".`,
    );
    expect(manager.getWorld(scene)).toBeUndefined();
  });

  it("destroys every world before rethrowing the first teardown error", () => {
    const first = createMockScene("first").scene;
    const second = createMockScene("second").scene;
    const firstDestroy = vi.fn(() => {
      throw new Error("first teardown failed");
    });
    const secondDestroy = vi.fn();
    const backends: LightingRenderer[] = [
      { render: vi.fn(), destroy: firstDestroy },
      { render: vi.fn(), destroy: secondDestroy },
    ];
    let backendIndex = 0;
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      options(() => {
        const backend = backends[backendIndex++];
        if (!backend) throw new Error("Missing test renderer.");
        return backend;
      }),
    );
    manager.getOrCreateWorld(first);
    manager.getOrCreateWorld(second);

    expect(() => manager.destroy()).toThrow("first teardown failed");
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
    expect([...manager.getAllWorlds()]).toHaveLength(0);
  });
});
