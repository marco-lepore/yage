import { describe, it, expect, vi } from "vitest";
import { createMockScene, Transform, Vec2 } from "@yagejs/core";
import type { Entity } from "@yagejs/core";
import { DebugRegistryImpl } from "../DebugRegistryImpl.js";
import type { DebugGraphics, WorldDebugApi } from "../types.js";
import { VectorContributor } from "./VectorContributor.js";

function createMockGraphics(): DebugGraphics {
  const g: DebugGraphics = {
    position: { x: 0, y: 0 },
    rotation: 0,
    visible: true,
    clear: vi.fn(() => g),
    rect: vi.fn(() => g),
    roundRect: vi.fn(() => g),
    circle: vi.fn(() => g),
    moveTo: vi.fn(() => g),
    lineTo: vi.fn(() => g),
    stroke: vi.fn(() => g),
    fill: vi.fn(() => g),
  };
  return g;
}

/** A world API handing out fresh graphics, recording every one it acquired. */
function createApi(
  options: { zoom?: number; flagEnabled?: boolean; poolSize?: number } = {},
): { api: WorldDebugApi; acquired: DebugGraphics[] } {
  const acquired: DebugGraphics[] = [];
  const poolSize = options.poolSize ?? Infinity;
  const api: WorldDebugApi = {
    acquireGraphics: () => {
      if (acquired.length >= poolSize) return undefined;
      const g = createMockGraphics();
      acquired.push(g);
      return g;
    },
    isFlagEnabled: () => options.flagEnabled ?? true,
    cameraZoom: options.zoom ?? 1,
  };
  return { api, acquired };
}

function setUp(): {
  registry: DebugRegistryImpl;
  contributor: VectorContributor;
  entity: Entity;
  destroyEntity: () => void;
} {
  const { scene } = createMockScene();
  const registry = new DebugRegistryImpl();
  const entity = scene.spawn("agent");
  entity.add(new Transform({ position: { x: 100, y: 50 } }));
  return {
    registry,
    contributor: new VectorContributor(registry.vectors),
    entity,
    destroyEntity: () => {
      entity.destroy();
      scene._flushDestroyQueue();
    },
  };
}

describe("VectorContributor", () => {
  it("reads the provider on every frame", () => {
    const { registry, contributor, entity } = setUp();
    const provider = vi.fn(() => new Vec2(10, 0));
    registry.drawVector(entity, provider);

    const { api } = createApi();
    contributor.drawWorld(api);
    contributor.drawWorld(api);
    contributor.drawWorld(api);

    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("draws from the entity's world position plus the origin offset", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(40, 0), {
      origin: { x: 0, y: -8 },
    });

    const { api, acquired } = createApi();
    contributor.drawWorld(api);

    expect(acquired[0]?.position).toEqual({ x: 100, y: 42 });
  });

  it("places the origin at a child entity's world position", () => {
    const { registry, contributor, entity } = setUp();
    const child = entity.scene.spawn("muzzle");
    child.add(new Transform({ position: { x: 10, y: 4 } }));
    entity.addChild("muzzle", child);

    registry.drawVector(child, () => new Vec2(40, 0));

    const { api, acquired } = createApi();
    contributor.drawWorld(api);

    // Parent (100, 50) + local (10, 4), not the bare local offset.
    expect(acquired[0]?.position).toEqual({ x: 110, y: 54 });
  });

  it("scales the arrow length but not its head or stroke width", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(100, 0), {
      scale: 0.5,
      headSize: 8,
      width: 2,
    });

    const { api, acquired } = createApi();
    contributor.drawWorld(api);

    const g = acquired[0]!;
    // Shaft runs from the origin to the head's base: 100 * 0.5 - 8.
    expect(g.moveTo).toHaveBeenCalledWith(0, 0);
    expect(g.lineTo).toHaveBeenCalledWith(42, 0);
    expect(g.stroke).toHaveBeenCalledWith(
      expect.objectContaining({ width: 2 }),
    );
    // Head tip at the full scaled length.
    expect(g.moveTo).toHaveBeenCalledWith(50, 0);
    expect(g.fill).toHaveBeenCalled();
  });

  it("keeps stroke width and head size constant across camera zoom", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(100, 0), {
      headSize: 8,
      width: 2,
    });

    const { api, acquired } = createApi({ zoom: 4 });
    contributor.drawWorld(api);

    const g = acquired[0]!;
    expect(g.stroke).toHaveBeenCalledWith(
      expect.objectContaining({ width: 0.5 }),
    );
    // Head shrinks in world units by the same factor: 100 - 8/4.
    expect(g.lineTo).toHaveBeenCalledWith(98, 0);
  });

  it("suppresses drawing below the minimum length", () => {
    const { registry, contributor, entity } = setUp();
    let velocity = new Vec2(0.4, 0);
    registry.drawVector(entity, () => velocity, { minLength: 1 });

    const { api, acquired } = createApi();
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(0);

    velocity = new Vec2(4, 0);
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(1);
  });

  it("draws nothing for a zero vector or a provider that returns null", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => Vec2.ZERO);
    registry.drawVector(entity, () => null);

    const { api, acquired } = createApi();
    contributor.drawWorld(api);

    expect(acquired).toHaveLength(0);
  });

  it("stops drawing once the disposer runs", () => {
    const { registry, contributor, entity } = setUp();
    const provider = vi.fn(() => new Vec2(10, 0));
    const stop = registry.drawVector(entity, provider);

    const { api, acquired } = createApi();
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(1);

    stop();
    stop(); // idempotent
    contributor.drawWorld(api);

    expect(acquired).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(registry.vectors.size).toBe(0);
  });

  it("drops the registration when the entity is destroyed", () => {
    const { registry, contributor, entity, destroyEntity } = setUp();
    const provider = vi.fn(() => new Vec2(10, 0));
    registry.drawVector(entity, provider);

    const { api, acquired } = createApi();
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(1);

    destroyEntity();
    contributor.drawWorld(api);

    expect(acquired).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(registry.vectors.size).toBe(0);
  });

  it("skips a dormant entity without dropping its registration", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(10, 0));

    const { api, acquired } = createApi();
    entity.setActive(false);
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(0);

    entity.setActive(true);
    contributor.drawWorld(api);
    expect(acquired).toHaveLength(1);
  });

  it("does not read providers while the flag is off", () => {
    const { registry, contributor, entity } = setUp();
    const provider = vi.fn(() => new Vec2(10, 0));
    registry.drawVector(entity, provider);

    const { api, acquired } = createApi({ flagEnabled: false });
    contributor.drawWorld(api);

    expect(provider).not.toHaveBeenCalled();
    expect(acquired).toHaveLength(0);
  });

  it("stops at an exhausted pool instead of throwing", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(10, 0));
    registry.drawVector(entity, () => new Vec2(0, 10));

    const { api, acquired } = createApi({ poolSize: 1 });
    expect(() => contributor.drawWorld(api)).not.toThrow();
    expect(acquired).toHaveLength(1);
  });

  it("draws one arrow per registration on the same entity", () => {
    const { registry, contributor, entity } = setUp();
    registry.drawVector(entity, () => new Vec2(10, 0));
    registry.drawVector(entity, () => new Vec2(0, 10));

    const { api, acquired } = createApi();
    contributor.drawWorld(api);

    expect(acquired).toHaveLength(2);
  });
});
