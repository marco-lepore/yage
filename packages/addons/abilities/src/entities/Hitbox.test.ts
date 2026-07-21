import { describe, expect, it, vi } from "vitest";
import { Entity, Transform, Vec2, createMockScene, trait } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent, ColliderComponent } from "@yagejs/physics";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult } from "../core/hit/types.js";
import { createHitDelivery } from "../core/hit/delivery.js";
import type { HitDelivery } from "../core/hit/delivery.js";
import { Hitbox, HitboxFollow } from "./Hitbox.js";
import type { HitboxConfig } from "./Hitbox.js";

interface FakeTriggerEvent {
  other: Entity;
  entered: boolean;
}

// Hitbox needs no real Rapier world — replace the physics classes with
// recorders/fakes. State is captured in hoisted maps keyed by component
// instance, not exposed as instance properties: the real RigidBodyComponent
// keeps `config` private and ColliderComponent declares no trigger-handler
// field, so reading either off the mock instance directly would fail
// typecheck against the real (unmocked) types these tests import.
const captured = vi.hoisted(() => ({
  bodyConfigs: new WeakMap<object, Record<string, unknown>>(),
  triggerHandlers: new WeakMap<object, (ev: FakeTriggerEvent) => void>(),
}));

vi.mock("@yagejs/physics", async () => {
  const core = await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class RigidBodyComponent extends core.Component {
    readonly type: string;
    constructor(config: { type: string; [key: string]: unknown }) {
      super();
      this.type = config.type;
      captured.bodyConfigs.set(this, config);
    }
    setVelocity(): void {}
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
  result: HitResult = "hit";
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return this.result;
  }
}

function spawnTarget(scene: Scene, x: number, y: number): Target {
  const target = scene.spawn(Target);
  target.add(new Transform({ position: new Vec2(x, y) }));
  return target;
}

function spawnHitbox(
  scene: Scene,
  overrides: Partial<HitboxConfig> & { delivery?: HitDelivery } = {},
) {
  const source = scene.spawn("attacker");
  const delivery = overrides.delivery ?? createHitDelivery({ source, data: { damage: 5 } });
  const config: HitboxConfig = {
    position: { x: 0, y: 0 },
    rotation: Math.PI / 2,
    shape: { type: "circle", radius: 10 },
    ...overrides,
    delivery,
  };
  const hitbox = scene.spawn(Hitbox, config);
  return { source, delivery, hitbox };
}

describe("Hitbox", () => {
  it("spawns a detached kinematic sensor with the given shape/offset/rotation", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene, {
      offset: { x: 3, y: 4 },
      shape: { type: "box", width: 20, height: 10 },
    });

    const body = hitbox.get(RigidBodyComponent);
    expect(body.type).toBe("kinematic");
    expect(captured.bodyConfigs.get(body)?.gravityScale).toBe(0);

    const collider = hitbox.get(ColliderComponent);
    expect(collider.config.sensor).toBe(true);
    expect(collider.config.shape).toEqual({ type: "box", width: 20, height: 10 });
    expect(collider.config.offset).toEqual({ x: 3, y: 4 });

    const transform = hitbox.get(Transform);
    expect(transform.position).toEqual(new Vec2(0, 0));
    expect(transform.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("omits offset/layers/mask on the collider config when not given", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene);
    const collider = hitbox.get(ColliderComponent);
    expect("offset" in collider.config).toBe(false);
    expect("layers" in collider.config).toBe(false);
    expect("mask" in collider.config).toBe(false);
  });

  it("passes layers/mask through to the collider config", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene, { groups: { layers: 1, mask: 6 } });
    const collider = hitbox.get(ColliderComponent);
    expect(collider.config.layers).toBe(1);
    expect(collider.config.mask).toBe(6);
  });

  it("delivers to a Hittable target on trigger-enter", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene, { position: { x: 0, y: 0 } });
    const target = spawnTarget(scene, 10, 0);

    const collider = hitbox.get(ColliderComponent);
    fireTrigger(collider, { other: target, entered: true });

    expect(target.received).toHaveLength(1);
    expect(target.received[0]!.data).toEqual({ damage: 5 });
  });

  it("ignores a trigger-exit event (entered=false)", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene);
    const target = spawnTarget(scene, 10, 0);

    const collider = hitbox.get(ColliderComponent);
    fireTrigger(collider, { other: target, entered: false });

    expect(target.received).toHaveLength(0);
  });

  it("delivers to a target once per window, even across repeated trigger-enters", () => {
    const { scene } = createMockScene();
    const { hitbox } = spawnHitbox(scene);
    const target = spawnTarget(scene, 10, 0);

    const collider = hitbox.get(ColliderComponent);
    fireTrigger(collider, { other: target, entered: true });
    fireTrigger(collider, { other: target, entered: true });

    expect(target.received).toHaveLength(1);
  });

  it("never delivers to the delivery's own source, even when the source is itself Hittable", () => {
    const { scene } = createMockScene();
    const source = scene.spawn(Target);
    source.add(new Transform({ position: new Vec2(0, 0) }));
    const delivery = createHitDelivery({ source, data: { damage: 5 } });
    const { hitbox } = spawnHitbox(scene, { delivery });

    const collider = hitbox.get(ColliderComponent);
    fireTrigger(collider, { other: source, entered: true });

    expect(source.received).toHaveLength(0);
  });

  describe("follow", () => {
    it("hitbox tracks a moving caster", () => {
      const { scene } = createMockScene();
      const caster = scene.spawn("caster");
      const casterTransform = caster.add(new Transform({ position: new Vec2(0, 0) }));
      const { hitbox } = spawnHitbox(scene, {
        position: { x: 0, y: 0 },
        rotation: Math.PI / 4,
        follow: true,
        caster,
      });

      casterTransform.setPosition(50, 20);
      hitbox.get(HitboxFollow).update();

      const transform = hitbox.get(Transform);
      expect(transform.position).toEqual(new Vec2(50, 20));
      expect(transform.rotation).toBeCloseTo(Math.PI / 4); // rotation stays the fire-time snapshot

      const target = spawnTarget(scene, 60, 20);
      const collider = hitbox.get(ColliderComponent);
      fireTrigger(collider, { other: target, entered: true });
      expect(target.received[0]!.direction).toEqual(new Vec2(1, 0)); // knockback origin tracked too
    });

    it("keeps its last position once the caster is destroyed mid-window", () => {
      const { scene } = createMockScene();
      const caster = scene.spawn("caster");
      const casterTransform = caster.add(new Transform({ position: new Vec2(0, 0) }));
      const { hitbox } = spawnHitbox(scene, { follow: true, caster });

      casterTransform.setPosition(10, 0);
      hitbox.get(HitboxFollow).update();
      caster.destroy();
      casterTransform.setPosition(999, 999);
      hitbox.get(HitboxFollow).update();

      expect(hitbox.get(Transform).position).toEqual(new Vec2(10, 0));
    });

    it("throws when follow is true but no caster is given", () => {
      const { scene } = createMockScene();
      expect(() => spawnHitbox(scene, { follow: true })).toThrow(/follow=true but no caster/);
    });
  });
});
