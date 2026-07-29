import { createMockScene } from "@yagejs/core";
import type { RendererPlugin } from "@yagejs/renderer";
import { describe, expect, it, vi } from "vitest";
import { LightingWorldManager } from "./LightingWorldManager.js";
import type { LightingRenderer } from "./types.js";

describe("LightingWorldManager", () => {
  it("returns the same query-only world for repeated scene lookups", () => {
    const { scene } = createMockScene();
    const manager = new LightingWorldManager(
      {} as RendererPlugin,
      { level: 0.25 },
      null,
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
    const manager = new LightingWorldManager(renderer, {}, factory);

    const world = manager.getOrCreateWorld(scene);

    expect(factory).toHaveBeenCalledWith({ scene, world, renderer });

    manager.destroyWorld(scene);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(manager.getWorld(scene)).toBeUndefined();
  });

  it("rejects a renderer factory that returns no backend", () => {
    const { scene } = createMockScene();
    const factory = vi.fn(() => undefined as unknown as LightingRenderer);
    const manager = new LightingWorldManager({} as RendererPlugin, {}, factory);

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
    const manager = new LightingWorldManager({} as RendererPlugin, {}, () => {
      const backend = backends[backendIndex++];
      if (!backend) throw new Error("Missing test renderer.");
      return backend;
    });
    manager.getOrCreateWorld(first);
    manager.getOrCreateWorld(second);

    expect(() => manager.destroy()).toThrow("first teardown failed");
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
    expect([...manager.getAllWorlds()]).toHaveLength(0);
  });
});
