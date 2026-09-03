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
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
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
    /** Pixi hands back `undefined` for a key that was never loaded. */
    static loaded = new Set(["loaded.png"]);
    static from(key: string): unknown {
      return MockTexture.loaded.has(key) ? { label: key } : undefined;
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
import { ySort } from "@yagejs/renderer";
import {
  createParticlesTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

const tex = { label: "test" } as never;

function createEmitter(overrides: Partial<EmitterOptions> = {}) {
  return new ParticleEmitterComponent({
    texture: tex,
    lifetime: 1,
    ...overrides,
  });
}

/** A particle's world position: its container-local coordinate plus the container's. */
function worldOf(emitter: ParticleEmitterComponent, index = 0) {
  const particle = emitter._active[index]!.particle;
  const { x, y } = emitter.container.position;
  return { x: particle.x + x, y: particle.y + y };
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

    it("rejects both texture sources at the type level", () => {
      const rejected: EmitterConfig[] = [
        // @ts-expect-error texture and shape are mutually exclusive.
        { texture: "spark.png", shape: "circle", lifetime: 1 },
      ];
      expect(rejected).toHaveLength(1);
    });

    it("prefers texture over shape for a plain-JS caller", () => {
      // Only reachable without type checking, which is why the precedence
      // survives: the union above rules it out for TypeScript callers.
      const emitter = new ParticleEmitterComponent({
        texture: tex,
        shape: "circle",
        lifetime: 1,
      } as unknown as EmitterConfig);
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.texture).toBe(tex);
    });

    it("resolves a string texture as an asset key", () => {
      const emitter = new ParticleEmitterComponent({
        texture: "loaded.png",
        lifetime: 1,
      });
      const container = emitter.container as unknown as InstanceType<
        typeof mocks.MockParticleContainer
      >;
      expect(container.texture).toEqual({ label: "loaded.png" });
    });

    it("names the key when it is not loaded", () => {
      expect(
        () =>
          new ParticleEmitterComponent({ texture: "missing.png", lifetime: 1 }),
      ).toThrow(/Texture "missing.png" is not loaded/);
    });
  });

  describe("config validation", () => {
    it("names the option, the constraint and the value", () => {
      expect(() => createEmitter({ damping: 1.5 })).toThrow(
        "ParticleEmitterComponent: damping must be between 0 and 1, got 1.5.",
      );
    });

    it("accepts both ends of the damping range and rejects outside it", () => {
      expect(() => createEmitter({ damping: 0 })).not.toThrow();
      expect(() => createEmitter({ damping: 1 })).not.toThrow();
      expect(() => createEmitter({ damping: -0.1 })).toThrow(/damping/);
      expect(() => createEmitter({ damping: NaN })).toThrow(/damping/);
    });

    it("rejects a maxParticles the pool cannot pre-allocate", () => {
      expect(() => createEmitter({ maxParticles: Infinity })).toThrow(
        /maxParticles must be a whole number >= 0/,
      );
      expect(() => createEmitter({ maxParticles: 2.5 })).toThrow(
        /maxParticles/,
      );
    });

    it("names the offending end of a range", () => {
      expect(() => createEmitter({ lifetime: [1, NaN] })).toThrow(
        "ParticleEmitterComponent: lifetime[1] must be finite and > 0, got [1, NaN].",
      );
    });

    it("names the emitter, not the texture helper, for a bad shape size", () => {
      expect(
        () =>
          new ParticleEmitterComponent({
            shape: { type: "circle", size: 0 },
            lifetime: 1,
          }),
      ).toThrow(
        "ParticleEmitterComponent: shape size must be finite and > 0, got 0.",
      );
    });

    it("checks gravity, tint and both ends of a lerped value", () => {
      expect(() => createEmitter({ gravity: { x: 0, y: Infinity } })).toThrow(
        /gravity\.y/,
      );
      expect(() => createEmitter({ tint: NaN })).toThrow(/tint/);
      expect(() => createEmitter({ scale: { start: 1, end: NaN } })).toThrow(
        /scale\.end/,
      );
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

    it("keeps overlapping emission requests independent", () => {
      const emitter = createEmitter();
      const first = emitter.requestEmission();
      const second = emitter.requestEmission();

      first.release();
      expect(first.active).toBe(false);
      expect(second.active).toBe(true);
      expect(emitter.isEmitting).toBe(true);

      second.release();
      expect(emitter.isEmitting).toBe(false);
    });

    it("does not let a request release stop manual emission", () => {
      const emitter = createEmitter();
      const request = emitter.requestEmission();

      emitter.emit();
      request.release();

      expect(emitter.isEmitting).toBe(true);
      emitter.stop();
      expect(emitter.isEmitting).toBe(false);
    });

    it("does not let stop cancel active requests", () => {
      const emitter = createEmitter();
      emitter.emit();
      const request = emitter.requestEmission();

      emitter.stop();

      expect(emitter.isEmitting).toBe(true);
      request.release();
      expect(emitter.isEmitting).toBe(false);
    });

    it("invalidates requests when the emitter is destroyed", () => {
      const emitter = createEmitter();
      const request = emitter.requestEmission();

      emitter.onDestroy();

      expect(request.active).toBe(false);
      expect(emitter.isEmitting).toBe(false);
      expect(() => emitter.requestEmission()).toThrow(/destruction/);
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
      expect(worldOf(emitter)).toEqual({ x: 30, y: 40 });
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
      expect(worldOf(emitter)).toEqual({ x: 105, y: 207 });
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

  describe("container position", () => {
    it("follows the entity's world position", () => {
      const emitter = createEmitter();
      setupEntity(emitter, new Transform({ position: new Vec2(250, 275) }));
      emitter._update(0, 250, 275);
      expect(emitter.container.position.x).toBe(250);
      expect(emitter.container.position.y).toBe(275);
    });

    it("is the depth key ySort reads", () => {
      const emitter = createEmitter();
      setupEntity(emitter, new Transform({ position: new Vec2(250, 275) }));
      emitter._update(0, 250, 275);
      expect(ySort(emitter.container)).toBe(275);
    });

    it("world-space particles hold their position as the emitter moves", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 2,
      });
      setupEntity(emitter, new Transform({ position: new Vec2(100, 200) }));
      emitter.burst(2);
      emitter._update(0, 250, 275);

      expect(emitter.container.position.x).toBe(250);
      expect(emitter.container.position.y).toBe(275);
      expect(worldOf(emitter, 0)).toEqual({ x: 100, y: 200 });
      expect(worldOf(emitter, 1)).toEqual({ x: 100, y: 200 });
    });

    it("local-space particles follow the emitter", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 2,
        simulationSpace: "local",
      });
      setupEntity(emitter, new Transform({ position: new Vec2(100, 200) }));
      emitter.burst(2);
      emitter._update(0, 250, 275);

      expect(worldOf(emitter, 0)).toEqual({ x: 250, y: 275 });
      expect(worldOf(emitter, 1)).toEqual({ x: 250, y: 275 });
    });

    it("keeps an explicit-position burst where it was asked for", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 1,
      });
      setupEntity(emitter, new Transform({ position: new Vec2(500, 500) }));
      emitter.burst(1, 100, 200);
      emitter._update(0, 800, 800);
      expect(worldOf(emitter)).toEqual({ x: 100, y: 200 });
    });
  });

  describe("radial spawn offset", () => {
    it("spawns on a ring of the configured radius", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 8,
        spawnOffset: { radius: 42 },
      });
      setupEntity(emitter);
      emitter.burst(8);
      for (const state of emitter._active) {
        const { x, y } = state.particle;
        expect(Math.hypot(x, y)).toBeCloseTo(42, 6);
      }
    });

    it("keeps every bearing inside the configured arc", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 8,
        spawnOffset: { radius: 10, angle: [0, Math.PI / 2] },
      });
      setupEntity(emitter);
      emitter.burst(8);
      for (const state of emitter._active) {
        const bearing = Math.atan2(state.particle.y, state.particle.x);
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThanOrEqual(Math.PI / 2);
      }
    });

    it("sends particles inward at a negative radialSpeed", () => {
      const emitter = createEmitter({
        speed: 0,
        lifetime: 10,
        maxParticles: 4,
        spawnOffset: { radius: 42 },
        radialSpeed: -110,
      });
      setupEntity(emitter);
      emitter.burst(4);
      for (const state of emitter._active) {
        expect(Math.hypot(state.vx, state.vy)).toBeCloseTo(110, 6);
        // Pointing back at the origin: velocity opposes the spawn offset.
        const alongOffset =
          state.vx * state.particle.x + state.vy * state.particle.y;
        expect(alongOffset).toBeLessThan(0);
      }
    });

    it("adds the radial term to the speed/angle velocity", () => {
      const emitter = createEmitter({
        speed: 20,
        angle: [0, Math.PI * 2],
        lifetime: 10,
        maxParticles: 6,
        spawnOffset: { radius: [10, 12] },
        radialSpeed: 100,
      });
      setupEntity(emitter);
      emitter.burst(6);
      for (const state of emitter._active) {
        const speed = Math.hypot(state.vx, state.vy);
        expect(speed).toBeGreaterThanOrEqual(80);
        expect(speed).toBeLessThanOrEqual(120);
      }
    });

    it("rejects a radialSpeed with no spawnOffset", () => {
      expect(() => createEmitter({ radialSpeed: 100 })).toThrow(
        /radialSpeed needs a spawnOffset/,
      );
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
});
