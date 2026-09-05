import { describe, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d", async () => {
  const mod = await import("@dimforge/rapier2d-compat");
  await mod.default.init();
  return { default: mod.default };
});

import { Transform, Vec2, createMockScene } from "@yagejs/core";
import {
  ColliderComponent,
  PhysicsWorld,
  PhysicsWorldKey,
  RigidBodyComponent,
} from "@yagejs/physics";
import { Projectile } from "./Projectile.js";
import { createHitDelivery } from "../core/hit/delivery.js";

describe("Projectile with real physics", () => {
  it("lands a solid gravity-driven projectile on a one-way platform", () => {
    const { scene } = createMockScene();
    const world = new PhysicsWorld();
    scene._registerScoped(PhysicsWorldKey, world);
    const platform = scene.spawn("platform");
    platform.add(new Transform({ position: new Vec2(0, 300) }));
    platform.add(new RigidBodyComponent({ type: "static" }));
    platform.add(
      new ColliderComponent({
        shape: { type: "box", width: 200, height: 20 },
        oneWay: {},
      }),
    );
    const caster = scene.spawn("caster");
    const consume = vi.fn((result: string) => result !== "ignored");
    const projectile = scene.spawn(Projectile, {
      caster,
      aim: Vec2.RIGHT,
      position: new Vec2(0, 100),
      delivery: createHitDelivery({ source: caster }),
      params: {
        speed: 0,
        lifetime: 10,
        shape: { type: "circle", radius: 5 },
        sensor: false,
        gravityScale: 1,
        consume,
      },
    });
    for (let i = 0; i < 150; i++) {
      world.step(1 / 60);
      world.processCollisionEvents();
    }
    const body = projectile.get(RigidBodyComponent);
    expect(
      world.toPixels(world.getBody(body._bodyHandle)!.translation().y),
    ).toBeCloseTo(285, 0);
    expect(body.velocityY).toBeCloseTo(0, 1);
    expect(projectile.isDestroyed).toBe(false);
    expect(consume).toHaveBeenCalledWith("ignored", false);
    projectile.destroy();
    platform.destroy();
    scene._flushDestroyQueue();
    world.destroy();
  });
});
