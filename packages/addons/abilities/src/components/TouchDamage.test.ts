import { beforeEach, describe, expect, it, vi } from "vitest";
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
  otherCollider?: object;
  selfShapeIndex?: number;
  otherShapeIndex?: number;
}

interface FakeCollisionEvent {
  other: Entity;
  started: boolean;
  otherCollider?: object;
  selfShapeIndex?: number;
  otherShapeIndex?: number;
  contactPoint?: Vec2;
  contactNormal?: Vec2;
}

interface FakeContact {
  point: Vec2;
  otherPoint: Vec2;
  normal: Vec2;
  distance: number;
}

// TouchDamage reads a sibling ColliderComponent and (via HitReceiver's
// default steps) pulls in Stagger's RigidBodyComponent import — stub both,
// capturing handlers in hoisted maps (the real ColliderComponent declares
// no trigger/collision-handler field to read them back from directly).
const captured = vi.hoisted(() => ({
  triggerHandlers: new WeakMap<object, (ev: FakeTriggerEvent) => void>(),
  collisionHandlers: new WeakMap<object, (ev: FakeCollisionEvent) => void>(),
  // What the stubbed `contactWith` answers, and the pairs it was asked for.
  contact: undefined as FakeContact | undefined,
  contactQueries: [] as { other: object; options: unknown }[],
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
      // A real event names the shape pair; fill it in for the tests.
      captured.triggerHandlers.set(this, (ev) =>
        handler({
          otherCollider: this,
          selfShapeIndex: 0,
          otherShapeIndex: 0,
          ...ev,
        }),
      );
      return () => captured.triggerHandlers.delete(this);
    }
    onCollision(handler: (ev: FakeCollisionEvent) => void): () => void {
      captured.collisionHandlers.set(this, (ev) =>
        handler({
          otherCollider: this,
          selfShapeIndex: 0,
          otherShapeIndex: 0,
          ...ev,
        }),
      );
      return () => captured.collisionHandlers.delete(this);
    }
    contactWith(other: object, options: unknown): FakeContact | undefined {
      captured.contactQueries.push({ other, options });
      return captured.contact;
    }
  }

  return { RigidBodyComponent, ColliderComponent };
});

beforeEach(() => {
  captured.contact = undefined;
  captured.contactQueries.length = 0;
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
    touch.fixedUpdate(0.5);
    expect(target.received).toHaveLength(1); // before the interval

    touch.fixedUpdate(0.5); // t=1.0 — interval elapsed
    expect(target.received).toHaveLength(2);
  });

  it("stops re-hitting after contact ends", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
    captured.triggerHandlers.get(collider)?.({ other: target, entered: false });
    touch.fixedUpdate(2); // well past the interval

    expect(target.received).toHaveLength(1);
  });

  it("drops a destroyed target from the re-hit ledger without throwing", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);

    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
    target.destroy();

    expect(() => touch.fixedUpdate(2)).not.toThrow();
    expect(target.received).toHaveLength(1); // no re-hit after destroy
  });

  it("measures the sensor pair on contact-begin and again for each interval re-hit", () => {
    const { scene, collider, touch } = setup(true, { interval: 1 });
    const target = spawnTarget(scene);
    const otherCollider = {};
    captured.contact = {
      point: new Vec2(0, 0),
      otherPoint: new Vec2(12, 3),
      normal: new Vec2(1, 0),
      distance: -2,
    };

    captured.triggerHandlers.get(collider)?.({
      other: target,
      entered: true,
      otherCollider,
      otherShapeIndex: 1,
    });
    expect(target.received[0]!.contact?.point).toEqual(new Vec2(12, 3));
    expect(target.received[0]!.contact?.normal.x).toBe(-1);

    captured.contact = {
      point: new Vec2(0, 0),
      otherPoint: new Vec2(14, 3),
      normal: new Vec2(1, 0),
      distance: -4,
    };
    touch.fixedUpdate(1);
    expect(target.received).toHaveLength(2);
    expect(target.received[1]!.contact?.point).toEqual(new Vec2(14, 3));
    expect(captured.contactQueries).toEqual([
      {
        other: otherCollider,
        options: { selfShapeIndex: 0, otherShapeIndex: 1 },
      },
      {
        other: otherCollider,
        options: { selfShapeIndex: 0, otherShapeIndex: 1 },
      },
    ]);
  });

  it("uses a solid collision's own contact data instead of a query", () => {
    const { scene, collider } = setup(false);
    const target = spawnTarget(scene);
    captured.collisionHandlers.get(collider)?.({
      other: target,
      started: true,
      contactPoint: new Vec2(5, 5),
      contactNormal: new Vec2(0, 1),
    });
    expect(captured.contactQueries).toHaveLength(0);
    expect(target.received[0]!.contact?.point).toEqual(new Vec2(5, 5));
    expect(target.received[0]!.contact?.normal.y).toBe(-1);
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

  it("releases collision callbacks while disabled and restores them on enable", () => {
    const { scene, collider, touch } = setup(true);
    const target = spawnTarget(scene);

    touch.enabled = false;
    expect(captured.triggerHandlers.has(collider)).toBe(false);

    touch.enabled = true;
    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
    expect(target.received).toHaveLength(1);
  });

  it("uses the same callback lifecycle while the host entity is inactive", () => {
    const { entity, scene, collider } = setup(true);
    const target = spawnTarget(scene);

    entity.setActive(false);
    expect(captured.triggerHandlers.has(collider)).toBe(false);

    entity.setActive(true);
    captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
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

    touch.fixedUpdate(1); // interval elapsed — re-hit
    expect(dealt).toEqual(["hit", "hit"]);
  });
});
