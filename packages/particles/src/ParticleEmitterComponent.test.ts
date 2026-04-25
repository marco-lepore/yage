import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmitterConfig } from "./types.js";

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
      if (textureOrOpts && typeof textureOrOpts === "object" && "texture" in (textureOrOpts as Record<string, unknown>)) {
        this.texture = (textureOrOpts as Record<string, unknown>).texture;
      } else {
        this.texture = textureOrOpts;
      }
    }

    get tint(): number { return this._tint; }
    set tint(v: number) { this._tint = v; }
  }

  class MockParticleContainer {
    children: MockParticle[] = [];
    parent: unknown = null;
    destroyed = false;
    texture: unknown = null;
    dynamicProperties: unknown = null;

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

    removeFromParent(): void { this.parent = null; }
    destroy(): void { this.destroyed = true; }
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

    removeFromParent(): void { /* noop for test */ }

    sortChildren(): void {
      this.children.sort((a, b) =>
        ((a as Record<string, number>).zIndex ?? 0) - ((b as Record<string, number>).zIndex ?? 0),
      );
    }

    destroy(): void { this.destroyed = true; }
  }

  return { mocks: { MockParticle, MockParticleContainer, MockContainer } };
});

vi.mock("pixi.js", () => ({
  Particle: mocks.MockParticle,
  ParticleContainer: mocks.MockParticleContainer,
  Container: mocks.MockContainer,
  Texture: { from: (key: string) => ({ label: key }) },
}));

import { Transform } from "@yagejs/core";
import { createParticlesTestContext, spawnEntityInScene } from "./test-helpers.js";
import { ParticleEmitterComponent } from "./ParticleEmitterComponent.js";

const tex = { label: "test" } as never;

function createEmitter(
  overrides: Partial<EmitterConfig> = {},
) {
  return new ParticleEmitterComponent({
    texture: tex,
    lifetime: 1,
    ...overrides,
  });
}

function setupEntity(emitter: ParticleEmitterComponent) {
  const ctx = createParticlesTestContext();
  const entity = spawnEntityInScene(ctx.scene);
  entity.add(new Transform());
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
      const container = emitter.container as unknown as InstanceType<typeof mocks.MockParticleContainer>;
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
      const emitter = createEmitter({ speed: 0, lifetime: 10, maxParticles: 1 });
      emitter.burst(1, 100, 200);
      const p = emitter._active[0]!.particle;
      expect(p.x).toBe(100);
      expect(p.y).toBe(200);
    });
  });

  describe("onAdd / onDestroy", () => {
    it("onAdd adds container to the render layer", () => {
      const emitter = createEmitter();
      const { layerManager } = setupEntity(emitter);
      const layerContainer = layerManager.defaultLayer.container as unknown as InstanceType<typeof mocks.MockContainer>;
      expect(layerContainer.children).toContain(emitter.container);
    });

    it("onDestroy destroys the container", () => {
      const emitter = createEmitter();
      setupEntity(emitter);
      emitter.onDestroy?.();
      const container = emitter.container as unknown as InstanceType<typeof mocks.MockParticleContainer>;
      expect(container.destroyed).toBe(true);
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

    it("throws when neither texture nor textureKey provided", () => {
      expect(
        () => new ParticleEmitterComponent({ lifetime: 1 } as never),
      ).toThrow(/requires either/);
    });
  });
});
