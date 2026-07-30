import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterConfig, EmitterOptions } from "./types.js";

const { mocks } = vi.hoisted(() => {
  class MockParticle {
    x = 0;
    y = 0;
    scaleX = 1;
    scaleY = 1;
    rotation = 0;
    alpha = 1;
    texture: unknown;
    _tint = 0xffffff;
    color = 0xffffffff;

    constructor(textureOrOpts: unknown) {
      if (
        textureOrOpts &&
        typeof textureOrOpts === "object" &&
        "texture" in (textureOrOpts as Record<string, unknown>)
      ) {
        this.texture = (textureOrOpts as Record<string, unknown>).texture;
      } else {
        this.texture = textureOrOpts;
      }
    }

    get tint(): number {
      return this._tint;
    }
    set tint(v: number) {
      this._tint = v;
    }
  }

  class MockParticleContainer {
    children: MockParticle[] = [];
    parent: unknown = null;
    destroyed = false;
    texture: unknown = null;
    dynamicProperties: unknown = null;
    // Pixi's own default — display objects start at "inherit", not "normal".
    blendMode = "inherit";

    constructor(opts?: Record<string, unknown>) {
      if (opts) {
        this.texture = opts.texture;
        this.dynamicProperties = opts.dynamicProperties;
      }
    }

    addParticle(p: MockParticle): MockParticle {
      this.children.push(p);
      return p;
    }

    removeParticle(p: MockParticle): MockParticle {
      const idx = this.children.indexOf(p);
      if (idx !== -1) this.children.splice(idx, 1);
      return p;
    }

    removeFromParent(): void {
      this.parent = null;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }

  // Mock Container for RenderLayerManager
  class MockContainer {
    children: unknown[] = [];
    position = { x: 0, y: 0 };
    scale = { x: 1, y: 1 };
    rotation = 0;
    visible = true;
    alpha = 1;
    parent: unknown = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    destroyed = false;

    addChild(child: unknown): unknown {
      this.children.push(child);
      if (child && typeof child === "object") {
        (child as Record<string, unknown>).parent = this;
      }
      return child;
    }

    removeChild(child: unknown): unknown {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      if (child && typeof child === "object") {
        (child as Record<string, unknown>).parent = null;
      }
      return child;
    }

    removeFromParent(): void {
      /* noop for test */
    }

    sortChildren(): void {
      this.children.sort(
        (a, b) =>
          ((a as Record<string, number>).zIndex ?? 0) -
          ((b as Record<string, number>).zIndex ?? 0),
      );
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  // Enough of a texture backend for the built-in shape generator to run.
  class MockBufferImageSource {
    resource: unknown;
    constructor(opts: Record<string, unknown>) {
      this.resource = opts.resource;
    }
  }

  class MockTexture {
    source: unknown;
    constructor(opts: Record<string, unknown>) {
      this.source = opts.source;
    }
    static from(key: string): unknown {
      return { label: key };
    }
    static WHITE = { label: "WHITE" };
  }

  return {
    mocks: {
      MockParticle,
      MockParticleContainer,
      MockContainer,
      MockTexture,
      MockBufferImageSource,
    },
  };
});

vi.mock("pixi.js", () => ({
  Particle: mocks.MockParticle,
  ParticleContainer: mocks.MockParticleContainer,
  Container: mocks.MockContainer,
  Texture: mocks.MockTexture,
  BufferImageSource: mocks.MockBufferImageSource,
}));

import { Transform, Vec2 } from "@yagejs/core";
import {
  createParticlesTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";
import { shapeTexture } from "./shapes.js";

const tex = { label: "test" } as never;

function createEmitter(overrides: Partial<EmitterOptions> = {}) {
  return new ParticleEmitterComponent({
    texture: tex,
    lifetime: 1,
    ...overrides,
  });
}

function setupEntity(
  emitter: ParticleEmitterComponent,
  transform: Transform | null = new Transform(),
) {
  const ctx = createParticlesTestContext();
  const entity = spawnEntityInScene(ctx.scene);
  if (transform) entity.add(transform);
  entity.add(emitter);
  return { ...ctx, entity };
}

describe("ParticleEmitterComponent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("construction", () => {
    it("creates a ParticleContainer", () => {
      const emitter = createEmitter();
      expect(emitter.container).toBeDefined();
    });

    it("defaults to not emitting", () => {
      const emitter = createEmitter();
      expect(emitter.isEmitting).toBe(false);
    });

    it("defaults to 0 active particles", () => {
      const emitter = createEmitter();
      expect(emitter.activeCount).toBe(0);
    });

    it("needs no texture — defaults to the shared white pixel", () => {
      const emitter = new ParticleEmitterComponent({ lifetime: 1 });
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.texture).toEqual({ label: "WHITE" });
    });

    it("rejects more than one texture source at the type level", () => {
      const rejected: EmitterConfig[] = [
        // @ts-expect-error texture and textureKey are mutually exclusive.
        { texture: "spark.png", textureKey: "other.png", lifetime: 1 },
        // @ts-expect-error texture and shape are mutually exclusive.
        { texture: "spark.png", shape: "circle", lifetime: 1 },
        // @ts-expect-error textureKey and shape are mutually exclusive.
        { textureKey: "spark.png", shape: "circle", lifetime: 1 },
      ];
      expect(rejected).toHaveLength(3);
    });

    it("prefers texture over textureKey and shape for a plain-JS caller", () => {
      // Only reachable without type checking, which is why the precedence
      // survives: the union above rules it out for TypeScript callers.
      const emitter = new ParticleEmitterComponent({
        texture: tex,
        textureKey: "also-set.png",
        shape: "circle",
        lifetime: 1,
      } as unknown as EmitterConfig);
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.texture).toBe(tex);
    });

    it("prefers textureKey over shape for a plain-JS caller", () => {
      const emitter = new ParticleEmitterComponent({
        textureKey: "spark.png",
        shape: "circle",
        lifetime: 1,
      } as unknown as EmitterConfig);
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.texture).toEqual({ label: "spark.png" });
    });
  });

  describe("activeness", () => {
    it("hides the container while dormant and shows it again on activation", () => {
      const emitter = createEmitter();
      const { entity } = setupEntity(emitter);
      expect(emitter.container.visible).toBe(true);

      entity.setActive(false);
      expect(emitter.container.visible).toBe(false);

      entity.setActive(true);
      expect(emitter.container.visible).toBe(true);
    });

    it("keeps a hand-set hide across a deactivate/reactivate cycle", () => {
      const emitter = createEmitter();
      const { entity } = setupEntity(emitter);
      emitter.container.visible = false;

      entity.setActive(false);
      entity.setActive(true);
      expect(emitter.container.visible).toBe(false);
    });
  });

  describe("emit / stop", () => {
    it("emit() starts continuous emission", () => {
      const emitter = createEmitter();
      emitter.emit();
      expect(emitter.isEmitting).toBe(true);
    });

    it("stop() halts continuous emission", () => {
      const emitter = createEmitter();
      emitter.emit();
      emitter.stop();
      expect(emitter.isEmitting).toBe(false);
    });
  });

  describe("burst", () => {
    it("spawns the requested number of particles", () => {
      const emitter = createEmitter({ maxParticles: 50 });
      emitter.burst(10);
      expect(emitter.activeCount).toBe(10);
    });

    it("rejects a single coordinate at the type level", () => {
      // Either both coordinates or neither: one alone would mix an explicit x
      // with an implied y of 0.
      const emitter = createEmitter();
      // @ts-expect-error burst takes (count) or (count, x, y).
      emitter.burst(1, 100);
      expect(emitter.activeCount).toBe(1);
    });

    it("does not exceed maxParticles", () => {
      const emitter = createEmitter({ maxParticles: 5 });
      emitter.burst(10);
      expect(emitter.activeCount).toBe(5);
    });
  });

  describe("continuous emission via _update", () => {
    it("spawns particles based on rate and dt", () => {
      const emitter = createEmitter({ rate: 10, maxParticles: 50 });
      emitter.emit();
      // dt = 0.5s, rate = 10/s => 5 particles
      emitter._update(0.5, 0, 0);
      expect(emitter.activeCount).toBe(5);
    });

    it("accumulates fractional spawns across frames", () => {
      const emitter = createEmitter({ rate: 10, maxParticles: 50 });
      emitter.emit();
      // 3 frames of 0.05s each => 0.5 + 0.5 + 0.5 = 1.5, floor → 1 particle
      emitter._update(0.05, 0, 0);
      emitter._update(0.05, 0, 0);
      emitter._update(0.05, 0, 0);
      expect(emitter.activeCount).toBe(1);
    });

    it("does not spawn when stopped", () => {
      const emitter = createEmitter({ rate: 100 });
      emitter._update(1, 0, 0);
      expect(emitter.activeCount).toBe(0);
    });

    it("stop resets the accumulator", () => {
      const emitter = createEmitter({ rate: 10, maxParticles: 50 });
      emitter.emit();
      // Accumulate 0.9 (not enough for a particle)
      emitter._update(0.09, 0, 0);
      emitter.stop();
      emitter.emit();
      // Should start fresh, not carry over the 0.9
      emitter._update(0.05, 0, 0);
      expect(emitter.activeCount).toBe(0);
    });
  });

  describe("particle lifecycle", () => {
    it("kills particles when their lifetime expires", () => {
      const emitter = createEmitter({ lifetime: 0.5, maxParticles: 50 });
      emitter.burst(3);
      expect(emitter.activeCount).toBe(3);
      // Advance past lifetime
      emitter._update(0.6, 0, 0);
      expect(emitter.activeCount).toBe(0);
    });

    it("recycles dead particles back to the pool", () => {
      const emitter = createEmitter({ lifetime: 0.1, maxParticles: 5 });
      emitter.burst(5);
      expect(emitter._pool.freeCount).toBe(0);
      emitter._update(0.2, 0, 0);
      expect(emitter._pool.freeCount).toBe(5);
    });

    it("removed particles are taken off the container", () => {
      const emitter = createEmitter({ lifetime: 0.1, maxParticles: 5 });
      emitter.burst(3);
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.children.length).toBe(3);
      emitter._update(0.2, 0, 0);
      expect(container.children.length).toBe(0);
    });
  });

  describe("particle physics", () => {
    it("applies velocity to particle position", () => {
      // speed=100, angle=0 → vx=100, vy≈0
      const emitter = createEmitter({
        speed: 100,
        angle: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      const startX = p.x;
      emitter._update(1, 0, 0);
      // Should move ~100px in x
      expect(p.x - startX).toBeCloseTo(100, 0);
    });

    it("applies gravity", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        gravity: { x: 0, y: 100 },
        maxParticles: 1,
      });
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      emitter._update(1, 0, 0);
      // After 1s of 100px/s² gravity, vy=100, position=100*1=100
      expect(p.y).toBeCloseTo(100, 0);
    });

    it("applies damping", () => {
      const emitter = createEmitter({
        speed: 100,
        angle: 0,
        lifetime: 10,
        damping: 0.5,
        maxParticles: 1,
      });
      emitter.burst(1);
      emitter._update(1, 0, 0);
      const state = emitter._active[0]!;
      // velocity should be damped: 100 * (1-0.5)^1 = 50
      expect(state.vx).toBeCloseTo(50, 0);
    });

    it("applies rotation speed", () => {
      const emitter = createEmitter({
        rotationSpeed: 2,
        lifetime: 10,
        maxParticles: 1,
      });
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      const startRot = p.rotation;
      emitter._update(1, 0, 0);
      expect(p.rotation - startRot).toBeCloseTo(2, 1);
    });
  });

  describe("lerped properties", () => {
    it("lerps scale over lifetime", () => {
      const emitter = createEmitter({
        scale: { start: 2, end: 0 },
        lifetime: 1,
        maxParticles: 1,
      });
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      expect(p.scaleX).toBeCloseTo(2, 1);

      emitter._update(0.5, 0, 0); // half lifetime
      expect(p.scaleX).toBeCloseTo(1, 1);
    });

    it("lerps alpha over lifetime", () => {
      const emitter = createEmitter({
        alpha: { start: 1, end: 0 },
        lifetime: 1,
        maxParticles: 1,
      });
      emitter.burst(1);
      emitter._update(0.5, 0, 0);
      const p = emitter._active[0]!.particle;
      expect(p.alpha).toBeCloseTo(0.5, 1);
    });
  });

  describe("spawn positioning", () => {
    it("spawns particles at the given world position", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      emitter.burst(1, 100, 200);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(100);
      expect(p.y).toBe(200);
    });

    it("a no-arg burst spawns at the entity's world position", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      setupEntity(emitter, new Transform({ position: new Vec2(30, 40) }));
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(30);
      expect(p.y).toBe(40);
    });

    it("a no-arg burst on a parented entity uses the world, not local, position", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      const { scene, entity } = setupEntity(
        emitter,
        new Transform({ position: new Vec2(5, 7) }),
      );
      const parent = spawnEntityInScene(scene, "parent");
      parent.add(new Transform({ position: new Vec2(100, 200) }));
      parent.addChild("child", entity);

      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(105);
      expect(p.y).toBe(207);
    });

    it("falls back to (0, 0) when the entity has no Transform", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      setupEntity(emitter, null);
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });

    it("falls back to (0, 0) when the emitter is not on an entity", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      emitter.burst(1);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });
  });

  describe("onAdd / onDestroy", () => {
    it("onAdd adds container to the render layer", () => {
      const emitter = createEmitter();
      const { layerManager } = setupEntity(emitter);
      const layerContainer = layerManager.defaultLayer
        .container as unknown as InstanceType<typeof mocks.MockContainer>;
      expect(layerContainer.children).toContain(emitter.container);
    });

    it("adding the emitter does not warn on its own", () => {
      // Adding an emitter before the entity's Transform is legitimate, so the
      // check belongs on first use, not on add.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      setupEntity(createEmitter(), null);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns on first use when the entity has no Transform", () => {
      // The system that ticks emitters queries for a Transform too, so such an
      // emitter silently does nothing at all.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const emitter = createEmitter();
      setupEntity(emitter, null);
      emitter.emit();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]![0]).toMatch(/no Transform/);
    });

    it("warns only once across repeated use", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const emitter = createEmitter();
      setupEntity(emitter, null);
      emitter.emit();
      emitter.burst(3);
      emitter.emit();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("stays quiet on use when the entity has a Transform", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const emitter = createEmitter();
      setupEntity(emitter);
      emitter.emit();
      emitter.burst(3);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("onDestroy destroys the container", () => {
      const emitter = createEmitter();
      setupEntity(emitter);
      emitter.onDestroy?.();
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.destroyed).toBe(true);
    });
  });

  describe("blend mode", () => {
    it("leaves the container at Pixi's default when unset", () => {
      expect(createEmitter().blendMode).toBe("inherit");
    });

    it("applies the configured mode to the container", () => {
      const emitter = createEmitter({ blendMode: "add" });
      expect(emitter.container.blendMode).toBe("add");
    });

    it("the setter writes through to the container", () => {
      const emitter = createEmitter();
      emitter.blendMode = "screen";
      expect(emitter.container.blendMode).toBe("screen");
      expect(emitter.blendMode).toBe("screen");
    });
  });

  describe("serialization", () => {
    it("serialize returns null with warning when using raw texture", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const emitter = createEmitter();
      expect(emitter.serialize()).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it("serialize returns null when a raw texture outranks a stray key", () => {
      // Only reachable from plain JS. The raw texture is what renders, so the
      // key describes art the restored emitter would not have drawn.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const emitter = new ParticleEmitterComponent({
        texture: tex,
        textureKey: "other.png",
        lifetime: 1,
      } as unknown as EmitterConfig);
      expect(emitter.serialize()).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it("serialize returns full config when using textureKey", () => {
      const emitter = new ParticleEmitterComponent({
        textureKey: "particle.png",
        lifetime: [0.4, 0.8],
        speed: [80, 160],
        rate: 40,
        tint: 0xff6600,
      });
      const data = emitter.serialize()!;
      expect(data).not.toBeNull();
      expect(data.textureKey).toBe("particle.png");
      expect(data.lifetime).toEqual([0.4, 0.8]);
      expect(data.speed).toEqual([80, 160]);
      expect(data.rate).toBe(40);
      expect(data.tint).toBe(0xff6600);
    });

    it("fromSnapshot round-trips config", () => {
      const original = new ParticleEmitterComponent({
        textureKey: "spark.png",
        lifetime: 1,
        speed: [50, 100],
        angle: [-1, 1],
        scale: { start: [0.5, 1.0], end: 0.1 },
        alpha: { start: 1, end: 0 },
        gravity: { x: 0, y: 300 },
        tint: 0xffcc00,
        damping: 0.2,
        rate: 30,
        maxParticles: 150,
      });
      const data = original.serialize()!;
      const restored = ParticleEmitterComponent.fromSnapshot(data);
      expect(restored.serialize()).toEqual(data);
    });

    it("omits blendMode while the container blends inherited", () => {
      const emitter = new ParticleEmitterComponent({
        textureKey: "particle.png",
        lifetime: 1,
      });
      expect(emitter.serialize()!.blendMode).toBeUndefined();
    });

    it("records an explicit normal, which differs from the unset default", () => {
      const emitter = new ParticleEmitterComponent({
        textureKey: "particle.png",
        lifetime: 1,
        blendMode: "normal",
      });
      expect(emitter.serialize()!.blendMode).toBe("normal");
    });

    it("records a blend mode set after construction and round-trips it", () => {
      const emitter = new ParticleEmitterComponent({
        textureKey: "spark.png",
        lifetime: 1,
      });
      emitter.blendMode = "add";
      const data = emitter.serialize()!;
      expect(data.blendMode).toBe("add");
      expect(ParticleEmitterComponent.fromSnapshot(data).blendMode).toBe("add");
    });

    it("serializes the built-in shape with its size filled in", () => {
      const emitter = new ParticleEmitterComponent({
        shape: "softCircle",
        lifetime: 1,
      });
      const data = emitter.serialize()!;
      expect(data.shape).toEqual({ type: "softCircle", size: [64, 64] });
      expect(data.textureKey).toBeUndefined();
      expect(ParticleEmitterComponent.fromSnapshot(data).serialize()).toEqual(
        data,
      );
    });

    it("round-trips an explicit shape size", () => {
      const emitter = new ParticleEmitterComponent({
        shape: { type: "circle", size: [32, 16] },
        lifetime: 1,
      });
      const data = emitter.serialize()!;
      expect(data.shape).toEqual({ type: "circle", size: [32, 16] });
      const restored = ParticleEmitterComponent.fromSnapshot(data);
      expect(restored.serialize()).toEqual(data);
      expect(restored.container.texture).toBe(
        shapeTexture({ type: "circle", size: [32, 16] }),
      );
    });

    it("serializes the default shape for a config with no texture at all", () => {
      const emitter = new ParticleEmitterComponent({ lifetime: 1 });
      expect(emitter.serialize()!.shape).toEqual({
        type: "pixel",
        size: [1, 1],
      });
    });
  });
});
