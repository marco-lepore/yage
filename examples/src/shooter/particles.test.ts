import { describe, expect, it, vi } from "vitest";
import { Transform } from "@yagejs/core";
import { ParticleEmitterComponent, ParticleSystem } from "@yagejs/particles";
import { createExampleScene } from "../shared/test-helpers.js";
import { createVfxHub } from "./particles.js";
import { Particle } from "pixi.js";

describe("shooter VfxHub", () => {
  it("keeps four pooled hosts while bursts use seeded counts and world positions", () => {
    const { scene, context } = createExampleScene();
    const hub = createVfxHub(scene);
    const hosts = [...scene.getEntities()];
    const emitters = hosts.map((host) => host.get(ParticleEmitterComponent));
    const calls = emitters.map((emitter) => vi.spyOn(emitter, "burst"));
    for (let i = 0; i < 80; i++) {
      hub.bulletImpact(123, 234, 1);
      hub.bulletImpact(321, 432, -1);
      hub.enemyHit(100, 200);
      hub.enemyDeath(300, 400);
    }
    const ranges = [
      [3, 5],
      [3, 5],
      [4, 6],
      [8, 12],
    ] as const;
    const positions = [
      [123, 234],
      [321, 432],
      [100, 200],
      [300, 400],
    ] as const;
    for (let i = 0; i < calls.length; i++) {
      const counts = new Set(calls[i]!.mock.calls.map(([count]) => count));
      const [min, max] = ranges[i]!;
      expect(Math.min(...counts)).toBe(min);
      expect(Math.max(...counts)).toBe(max);
      for (const [count, x, y] of calls[i]!.mock.calls) {
        expect(count).toBeGreaterThanOrEqual(min);
        expect(count).toBeLessThanOrEqual(max);
        expect([x, y]).toEqual(positions[i]);
      }
      expect(emitters[i]!.activeCount).toBe(128);
      expect(emitters[i]!.isEmitting).toBe(false);
    }
    expect(scene.getEntities().size).toBe(4);
    const system = new ParticleSystem();
    system.onRegister(context);
    for (const host of hosts) host.get(Transform).setPosition(50, 60);
    system.update(0);
    for (let i = 0; i < emitters.length; i++) {
      const emitter = emitters[i]!;
      const particle = emitter.container.particleChildren[0]!;
      expect([
        particle.x + emitter.container.position.x,
        particle.y + emitter.container.position.y,
      ]).toEqual(positions[i]);
    }
    system.update(1);
    expect(emitters.map((emitter) => emitter.activeCount)).toEqual([
      0, 0, 0, 0,
    ]);
    expect(scene.getEntities().size).toBe(4);
  });

  it("uses the authored impact, hit and death geometry and motion ranges", () => {
    const { scene, context } = createExampleScene();
    const hub = createVfxHub(scene);
    hub.bulletImpact(0, 0, 1);
    hub.bulletImpact(0, 0, -1);
    hub.enemyHit(0, 0);
    hub.enemyDeath(0, 0);
    const emitters = [...scene.getEntities()].map((host) =>
      host.get(ParticleEmitterComponent),
    );
    const system = new ParticleSystem();
    system.onRegister(context);
    system.update(0.1);
    const specs = [
      {
        size: 4,
        tint: 0x38bdf8,
        minSpeed: 80,
        maxSpeed: 150,
        minLife: 0.2,
        maxLife: 0.35,
        minAngle: -Math.PI / 4,
        maxAngle: Math.PI / 4,
      },
      {
        size: 4,
        tint: 0x38bdf8,
        minSpeed: 80,
        maxSpeed: 150,
        minLife: 0.2,
        maxLife: 0.35,
        minAngle: (3 * Math.PI) / 4,
        maxAngle: (5 * Math.PI) / 4,
      },
      {
        size: 5,
        tint: 0xef4444,
        minSpeed: 60,
        maxSpeed: 120,
        minLife: 0.25,
        maxLife: 0.4,
        minAngle: (2 * Math.PI) / 3,
        maxAngle: (4 * Math.PI) / 3,
      },
      {
        size: 6,
        tint: 0xe11d48,
        minSpeed: 50,
        maxSpeed: 200,
        minLife: 0.3,
        maxLife: 0.5,
        minAngle: 0,
        maxAngle: 2 * Math.PI,
      },
    ];
    for (let i = 0; i < emitters.length; i++) {
      const spec = specs[i]!;
      for (const value of emitters[i]!.container.particleChildren) {
        expect(value).toBeInstanceOf(Particle);
        const particle = value as Particle;
        expect(particle.texture.width).toBe(spec.size);
        expect(particle.texture.height).toBe(spec.size);
        expect(particle.tint).toBe(spec.tint);
        const speed = Math.hypot(particle.x, particle.y) / 0.1;
        expect(speed).toBeGreaterThanOrEqual(spec.minSpeed);
        expect(speed).toBeLessThanOrEqual(spec.maxSpeed);
        let angle = Math.atan2(particle.y, particle.x);
        if (i > 0 && angle < 0) angle += 2 * Math.PI;
        expect(angle).toBeGreaterThanOrEqual(spec.minAngle);
        expect(angle).toBeLessThanOrEqual(spec.maxAngle);
        const lifetime = 0.1 / (1 - particle.alpha);
        expect(lifetime).toBeGreaterThanOrEqual(spec.minLife);
        expect(lifetime).toBeLessThanOrEqual(spec.maxLife);
      }
    }
  });
});
