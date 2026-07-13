import { describe, expect, it, vi } from "vitest";
import {
  Entity,
  Transform,
  Vec2,
  createMockEntity,
  createMockScene,
  trait,
} from "@yagejs/core";
import { ColliderComponent } from "@yagejs/physics";
import { AbilitySpawned } from "../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../core/AbilitySpawned.js";
import { Hittable } from "../core/hit/types.js";
import type { Hit, HitResult } from "../core/hit/types.js";
import { HitReceiver } from "./HitReceiver.js";
import { HitDealt } from "./reportedDelivery.js";
import { TouchDamage } from "./TouchDamage.js";
import type { TouchDamageOptions } from "./TouchDamage.js";

interface FakeTriggerEvent {
  other: Entity;
  entered: boolean;
}

interface FakeCollisionEvent {
  other: Entity;
  started: boolean;
}

// TouchDamage reads a sibling ColliderComponent and (via HitReceiver's
// default steps) pulls in Stagger's RigidBodyComponent import — stub both,
// capturing handlers in hoisted maps (the real ColliderComponent declares
// no trigger/collision-handler field to read them back from directly).
const captured = vi.hoisted(() => ({
  triggerHandlers: new WeakMap<object, (ev: FakeTriggerEvent) => void>(),
  collisionHandlers: new WeakMap<object, (ev: FakeCollisionEvent) => void>(),
}));

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class RigidBodyComponent extends core.Component {
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
    onCollision(handler: (ev: FakeCollisionEvent) => void): () => void {
      captured.collisionHandlers.set(this, handler);
      return () => captured.collisionHandlers.delete(this);
    }
  }

  return { RigidBodyComponent, ColliderComponent };
});

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

@trait(AbilitySpawned)
class SpawnedZone extends Entity {
  abilitySpawnContext: AbilitySpawnContext<object> | undefined;

  override setup(context: AbilitySpawnContext<object>): void {
    this.abilitySpawnContext = context;
  }
}

function spawnTarget(
  scene: ReturnType<typeof createMockEntity>["scene"],
): Target {
  const target = scene.spawn(Target);
  target.add(new Transform({ position: new Vec2(5, 0) }));
  return target;
}

/** HitReceiver (if given a team) must be added before TouchDamage — TouchDamage reads it in `onAdd`. */
function setup(
  sensor: boolean,
  options: Partial<TouchDamageOptions> = {},
  team?: string,
) {
  const { entity, scene } = createMockEntity("toucher");
  entity.add(new Transform({ position: new Vec2(0, 0) }));
  const collider = entity.add(
    new ColliderComponent({ shape: { type: "circle", radius: 5 }, sensor }),
  );
  if (team !== undefined) entity.add(new HitReceiver({ team }));
  const touch = entity.add(new TouchDamage({ hit: { damage: 5 }, ...options }));
  return { entity, scene, collider, touch };
}

describe("TouchDamage", () => {
  it("delivers once on contact-begin to a Hittable target", () => {
    const { scene, collider } = setup(true);
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });

    expect(target.received).toHaveLength(1);
    expect(target.received[0]!.data).toEqual({ damage: 5 });
  });

  it("is a no-op for a non-Hittable other (no throw)", () => {
    const { scene, collider } = setup(true);
    const other = scene.spawn("rock");

    expect(() =>
      captured.triggerHandlers.get(collider)?.({ other, entered: true }),
    ).not.toThrow();
  });

  it("re-delivers after the interval elapses while held in contact", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true }); // t=0
    touch.update(0.5);
    expect(target.received).toHaveLength(1); // before the interval

    touch.update(0.5); // t=1.0 — interval elapsed
    expect(target.received).toHaveLength(2);
  });

  it("stops re-hitting after contact ends", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
    captured.triggerHandlers.get(collider)?.({ other: target, entered: false });
    touch.update(2); // well past the interval

    expect(target.received).toHaveLength(1);
  });

  it("drops a destroyed target from the re-hit ledger without throwing", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
    target.destroy();

    expect(() => touch.update(2)).not.toThrow();
    expect(target.received).toHaveLength(1); // no re-hit after destroy
  });

  it("subscribes onTrigger for a sensor host, not onCollision", () => {
    const { collider } = setup(true);
    expect(captured.triggerHandlers.has(collider)).toBe(true);
    expect(captured.collisionHandlers.has(collider)).toBe(false);
  });

  it("subscribes onCollision for a solid host, not onTrigger", () => {
    const { scene, collider } = setup(false);
    expect(captured.collisionHandlers.has(collider)).toBe(true);
    expect(captured.triggerHandlers.has(collider)).toBe(false);

    const target = spawnTarget(scene);
    captured.collisionHandlers.get(collider)?.({
      other: target,
      started: true,
    });

    expect(target.received).toHaveLength(1);
  });

  it("inherits team from a sibling HitReceiver when the options omit team", () => {
    const { scene, collider } = setup(true, {}, "player");
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });

    expect(target.received[0]!.team).toBe("player");
  });

  it("an explicit team overrides the sibling HitReceiver's team", () => {
    const { scene, collider } = setup(true, { team: "boss" }, "player");
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });

    expect(target.received[0]!.team).toBe("boss");
  });

  it("attributes a spawned zone's touch damage to the original caster", () => {
    const { scene } = createMockScene();
    const caster = scene.spawn("caster");
    const zone = scene.spawn(SpawnedZone, {
      caster,
      aim: Vec2.RIGHT,
      position: Vec2.ZERO,
      params: {},
      team: "player",
    });
    zone.add(new Transform());
    const collider = zone.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 5 },
        sensor: true,
      }),
    );
    zone.add(new TouchDamage({ hit: { damage: 5 } }));
    const target = spawnTarget(scene);
    const dealt: HitResult[] = [];
    caster.on(HitDealt, ({ result }) => dealt.push(result));

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });

    expect(target.received[0]?.source).toBe(caster);
    expect(target.received[0]?.team).toBe("player");
    expect(dealt).toEqual(["hit"]);
  });

  it("emits HitDealt on the touch source on contact; a re-hit after the interval emits again", () => {
    const { entity, scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);
    const dealt: HitResult[] = [];
    entity.on(HitDealt, (payload) => dealt.push(payload.result));

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true }); // t=0
    expect(dealt).toEqual(["hit"]);

    touch.update(1); // interval elapsed — re-hit
    expect(dealt).toEqual(["hit", "hit"]);
  });
});
