import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  createMockEntity,
  trait,
} from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { ColliderComponent } from "@yagejs/physics";
import { Abilities } from "../../core/Abilities.js";
import { Hittable } from "../../core/hit/types.js";
import type { Hit, HitResult } from "../../core/hit/types.js";
import { Facing } from "../Facing.js";
import { HitReceiver } from "../HitReceiver.js";
import { HitDealt } from "../reportedDelivery.js";
import { Projectile } from "../../entities/Projectile.js";
import { projectile } from "./projectile.js";

interface FakeTriggerEvent {
  other: Entity;
  entered: boolean;
  otherCollider: { config: { sensor?: boolean } };
}

// The step spawns a real Projectile entity — stub the physics classes the
// same way Projectile.test.ts does.
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

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

const solid: FakeTriggerEvent["otherCollider"] = { config: { sensor: false } };

beforeEach(() => {
  captured.velocities.length = 0;
});

function setup() {
  const { entity, scene } = createMockEntity("caster");
  entity.add(new Transform({ position: new Vec2(5, 0) }));
  const pc = entity.add(new ProcessComponent());
  return { entity, scene, pc };
}

function findProjectile(scene: Scene): Projectile {
  const [found] = scene.findEntities().filter((e): e is Projectile => e instanceof Projectile);
  if (!found) throw new Error("no Projectile spawned");
  return found;
}

describe("projectile step", () => {
  it("spawns a Projectile travelling along the resolved aim at the given speed", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing()).set(0, 1); // south
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 200, lifetime: 1, hit: {} })] },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    expect(captured.velocities).toEqual([{ x: 0, y: 200 }]);
    const spawned = findProjectile(scene);
    expect(spawned.get(Transform).position).toEqual(new Vec2(5, 0));
  });

  it("spawns at casterPos + rotate(offset, aimAngle)", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing()).set(1, 0); // east, angle 0
    entity.add(
      new Abilities([
        {
          id: "shoot",
          timeline: [
            projectile({ at: 0, speed: 10, lifetime: 1, hit: {}, offset: { x: 3, y: 0 } }),
          ],
        },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    expect(findProjectile(scene).get(Transform).position).toEqual(new Vec2(8, 0));
  });

  it("throws when aim is omitted and there is no Facing", () => {
    const { entity, pc } = setup();
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {} })] },
      ]),
    );

    entity.get(Abilities).play("shoot");
    expect(() => pc._tick(0.01)).toThrow(/Facing|aim/);
  });

  it("throws when an explicit aim resolves to a zero vector", () => {
    const { entity, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "shoot",
          timeline: [
            projectile({ at: 0, speed: 10, lifetime: 1, hit: {}, aim: { x: 0, y: 0 } }),
          ],
        },
      ]),
    );

    entity.get(Abilities).play("shoot");
    expect(() => pc._tick(0.01)).toThrow(/zero vector/);
  });

  it("resolves and snapshots a resolver aim at fire time", () => {
    const { entity, pc } = setup();
    let dir = { x: 1, y: 0 };
    const resolver = vi.fn(() => dir);
    entity.add(
      new Abilities([
        {
          id: "shoot",
          timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {}, aim: resolver })],
        },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);
    dir = { x: 0, y: 1 }; // later state change must not affect the already-fired projectile

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(captured.velocities).toEqual([{ x: 10, y: 0 }]);
  });

  it("defaults to a circle radius-4 collider when shape is omitted", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {} })] },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    expect(findProjectile(scene).get(ColliderComponent).config.shape).toEqual({
      type: "circle",
      radius: 4,
    });
  });

  it("passes layers/mask through to the spawned projectile's collider", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "shoot",
          timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {}, layers: 2, mask: 5 })],
        },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    const collider = findProjectile(scene).get(ColliderComponent);
    expect(collider.config.layers).toBe(2);
    expect(collider.config.mask).toBe(5);
  });

  it("inherits team from the caster's HitReceiver when the step omits team", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(new HitReceiver({ team: "player" }));
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {} })] },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    const collider = findProjectile(scene).get(ColliderComponent);
    captured.triggerHandlers.get(collider)?.({ other: target, entered: true, otherCollider: solid });

    expect(target.received[0]!.team).toBe("player");
  });

  it("an explicit team overrides the caster's HitReceiver team", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(new HitReceiver({ team: "player" }));
    entity.add(
      new Abilities([
        {
          id: "shoot",
          timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {}, team: "boss" })],
        },
      ]),
    );

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);

    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    const collider = findProjectile(scene).get(ColliderComponent);
    captured.triggerHandlers.get(collider)?.({ other: target, entered: true, otherCollider: solid });

    expect(target.received[0]!.team).toBe("boss");
  });

  it("emits HitDealt on the caster when the projectile lands a hit", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {} })] },
      ]),
    );
    const dealt: HitResult[] = [];
    entity.on(HitDealt, (payload) => dealt.push(payload.result));

    entity.get(Abilities).play("shoot");
    pc._tick(0.01);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    const collider = findProjectile(scene).get(ColliderComponent);
    captured.triggerHandlers.get(collider)?.({ other: target, entered: true, otherCollider: solid });

    expect(dealt).toEqual(["hit"]);
  });

  it("throws on a caster with no Transform", () => {
    const { entity } = createMockEntity("no-transform");
    const pc = entity.add(new ProcessComponent());
    entity.add(new Facing());
    entity.add(
      new Abilities([
        { id: "shoot", timeline: [projectile({ at: 0, speed: 10, lifetime: 1, hit: {} })] },
      ]),
    );

    entity.get(Abilities).play("shoot");
    expect(() => pc._tick(0.01)).toThrow(
      /step "projectile" requires a Transform component/,
    );
  });
});
