import { describe, expect, it, vi } from "vitest";
import { Entity, ProcessComponent, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { ColliderComponent, RigidBodyComponent } from "@yagejs/physics";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery } from "../core/hit/delivery.js";
import { Projectile } from "./Projectile.js";
import type { ProjectileConfig } from "./Projectile.js";

interface FakeTriggerEvent {
  other: Entity;
  entered: boolean;
  otherCollider: { config: { sensor?: boolean } };
}

// Projectile needs no real Rapier world — replace the physics classes with
// recorders/fakes, same idiom as Hitbox.test.ts (captured state in hoisted
// maps, never a property the real classes don't declare).
const captured = vi.hoisted(() => ({
  velocities: [] as { x: number; y: number }[],
  triggerHandlers: new WeakMap<object, (ev: FakeTriggerEvent) => void>(),
}));

vi.mock("@yagejs/physics", async () => {
  const core = await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class RigidBodyComponent extends core.Component {
    readonly type: string;
    constructor(config: { type: string; [key: string]: unknown }) {
      super();
      this.type = config.type;
    }
    setVelocity(v: { x: number; y: number }): void {
      captured.velocities.push({ x: v.x, y: v.y });
    }
  }

  class ColliderComponent extends core.Component {
    constructor(public readonly config: Record<string, unknown>) {
      super();
    }
    onTrigger(handler: (ev: FakeTriggerEvent) => void): () => void {
      captured.triggerHandlers.set(this, handler);
      return () => captured.triggerHandlers.delete(this);
    }
  }

  return { RigidBodyComponent, ColliderComponent };
});

function fireTrigger(collider: ColliderComponent, ev: FakeTriggerEvent): void {
  captured.triggerHandlers.get(collider)?.(ev);
}

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

function spawnProjectile(
  scene: Scene,
  overrides: Partial<ProjectileConfig> & { delivery?: HitDelivery } = {},
) {
  const owner = overrides.owner ?? scene.spawn("owner");
  const delivery = overrides.delivery ?? createHitDelivery({ source: owner, data: { damage: 5 } });
  const config: ProjectileConfig = {
    position: { x: 0, y: 0 },
    direction: { x: 1, y: 0 },
    speed: 100,
    shape: { type: "circle", radius: 4 },
    lifetime: 1,
    ...overrides,
    delivery,
    owner,
  };
  const projectile = scene.spawn(Projectile, config);
  return { owner, delivery, projectile };
}

const solid: FakeTriggerEvent["otherCollider"] = { config: { sensor: false } };
const sensor: FakeTriggerEvent["otherCollider"] = { config: { sensor: true } };

describe("Projectile", () => {
  it("spawns a dynamic zero-gravity body with velocity dir*speed and a sensor collider", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene, {
      position: { x: 10, y: 20 },
      direction: { x: 0, y: 1 },
      speed: 200,
    });

    const body = projectile.get(RigidBodyComponent);
    expect(body.type).toBe("dynamic");
    expect(captured.velocities).toEqual([{ x: 0, y: 200 }]);

    const collider = projectile.get(ColliderComponent);
    expect(collider.config.sensor).toBe(true);
    expect(collider.config.shape).toEqual({ type: "circle", radius: 4 });

    const transform = projectile.get(Transform);
    expect(transform.position).toEqual(new Vec2(10, 20));
  });

  it("destroys itself on a landed hit", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));

    fireTrigger(projectile.get(ColliderComponent), { other: target, entered: true, otherCollider: solid });

    expect(target.received).toHaveLength(1);
    expect(projectile.isDestroyed).toBe(true);
  });

  it("destroys itself on a solid non-target contact (bit-free wall death)", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene);
    const wall = scene.spawn("wall"); // not Hittable

    fireTrigger(projectile.get(ColliderComponent), { other: wall, entered: true, otherCollider: solid });

    expect(projectile.isDestroyed).toBe(true);
  });

  it("passes through a non-landing sensor overlap", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene);
    const pickup = scene.spawn("pickup-zone"); // not Hittable, sensor

    fireTrigger(projectile.get(ColliderComponent), { other: pickup, entered: true, otherCollider: sensor });

    expect(projectile.isDestroyed).toBe(false);
  });

  it("skips its owner entirely: no deliver, no consume", () => {
    const { scene } = createMockScene();
    const owner = scene.spawn(Target); // Hittable, to prove even a Hittable owner is skipped
    owner.add(new Transform({ position: new Vec2(0, 0) }));
    const { projectile } = spawnProjectile(scene, { owner });

    fireTrigger(projectile.get(ColliderComponent), { other: owner, entered: true, otherCollider: solid });

    expect(owner.received).toHaveLength(0);
    expect(projectile.isDestroyed).toBe(false);
  });

  it("consumes only once across duplicate same-tick trigger events", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    const collider = projectile.get(ColliderComponent);
    const ev: FakeTriggerEvent = { other: target, entered: true, otherCollider: solid };

    fireTrigger(collider, ev);
    fireTrigger(collider, ev);

    expect(target.received).toHaveLength(1);
  });

  it("self-destructs after its lifetime elapses", () => {
    const { scene } = createMockScene();
    const { projectile } = spawnProjectile(scene, { lifetime: 0.5 });

    projectile.get(ProcessComponent)._tick(0.5);

    expect(projectile.isDestroyed).toBe(true);
  });

  it("spawns standalone (no ability) via scene.spawn with a game-built delivery", () => {
    const { scene } = createMockScene();
    const owner = scene.spawn("thrower");
    const delivery = createHitDelivery({ source: owner, data: { damage: 3 } });
    const projectile = scene.spawn(Projectile, {
      position: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      speed: 50,
      shape: { type: "circle", radius: 4 },
      delivery,
      owner,
      lifetime: 1,
    });
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));

    fireTrigger(projectile.get(ColliderComponent), { other: target, entered: true, otherCollider: solid });

    expect(target.received).toHaveLength(1);
  });
});
