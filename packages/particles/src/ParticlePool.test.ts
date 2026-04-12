import { describe, it, expect, vi } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockParticle {
    x = 0;
    y = 0;
    scaleX = 1;
    scaleY = 1;
    rotation = 0;
    alpha = 1;
    texture: unknown;
    tint = 0xffffff;

    constructor(texture: unknown) {
      this.texture = texture;
    }
  }

  return { mocks: { MockParticle } };
});

vi.mock("pixi.js", () => ({
  Particle: mocks.MockParticle,
}));

import { ParticlePool } from "./ParticlePool.js";

describe("ParticlePool", () => {
  const texture = { label: "test-tex" } as never;

  it("pre-allocates particles up to capacity", () => {
    const pool = new ParticlePool(texture, 10);
    expect(pool.freeCount).toBe(10);
    expect(pool.activeCount).toBe(0);
  });

  it("acquire returns a particle", () => {
    const pool = new ParticlePool(texture, 5);
    const p = pool.acquire();
    expect(p).toBeDefined();
    expect(pool.freeCount).toBe(4);
    expect(pool.activeCount).toBe(1);
  });

  it("acquire returns undefined when at capacity", () => {
    const pool = new ParticlePool(texture, 2);
    pool.acquire();
    pool.acquire();
    expect(pool.acquire()).toBeUndefined();
  });

  it("release returns a particle to the pool", () => {
    const pool = new ParticlePool(texture, 3);
    const p = pool.acquire()!;
    expect(pool.freeCount).toBe(2);
    pool.release(p);
    expect(pool.freeCount).toBe(3);
    expect(pool.activeCount).toBe(0);
  });

  it("released particle is reused on next acquire", () => {
    const pool = new ParticlePool(texture, 1);
    const p1 = pool.acquire()!;
    pool.release(p1);
    const p2 = pool.acquire();
    expect(p2).toBe(p1);
  });

  it("release resets particle state", () => {
    const pool = new ParticlePool(texture, 1);
    const p = pool.acquire()!;
    p.x = 100;
    p.y = 200;
    p.scaleX = 3;
    p.scaleY = 3;
    p.rotation = 1.5;
    p.alpha = 0.5;
    pool.release(p);

    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.scaleX).toBe(1);
    expect(p.scaleY).toBe(1);
    expect(p.rotation).toBe(0);
    expect(p.alpha).toBe(1);
  });

  it("capacity reflects the max pool size", () => {
    const pool = new ParticlePool(texture, 50);
    expect(pool.capacity).toBe(50);
  });
});
