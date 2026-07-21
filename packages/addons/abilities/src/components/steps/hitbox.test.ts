import { describe, expect, it, vi } from "vitest";
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
import { AbilitySpawned } from "../../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../../core/AbilitySpawned.js";
import { Hittable } from "../../core/hit/types.js";
import type { Hit, HitResult } from "../../core/hit/types.js";
import { Facing } from "../Facing.js";
import { HitReceiver } from "../HitReceiver.js";
import { HitDealt } from "../reportedDelivery.js";
import { Hitbox, HitboxFollow } from "../../entities/Hitbox.js";
import { hitbox } from "./hitbox.js";

interface FakeTriggerEvent {
  other: Entity;
  entered: boolean;
}

// The step spawns a real Hitbox entity (kinematic body + sensor collider) —
// stub the physics classes the same way Hitbox.test.ts does.
const captured = vi.hoisted(() => ({
  triggerHandlers: new WeakMap<object, (ev: FakeTriggerEvent) => void>(),
}));

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");

  class RigidBodyComponent extends core.Component {
    readonly type: string;
    constructor(config: { type: string; [key: string]: unknown }) {
      super();
      this.type = config.type;
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

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];
  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

@trait(AbilitySpawned)
class SpawnedAttacker extends Entity {
  abilitySpawnContext: AbilitySpawnContext<object> | undefined;

  override setup(context: AbilitySpawnContext<object>): void {
    this.abilitySpawnContext = context;
  }
}

function setup() {
  const { entity, scene } = createMockEntity("caster");
  entity.add(new Transform({ position: new Vec2(5, 0) }));
  const pc = entity.add(new ProcessComponent());
  return { entity, scene, pc };
}

function findHitboxes(scene: Scene): Hitbox[] {
  return scene.findEntities().filter((e): e is Hitbox => e instanceof Hitbox);
}

function findHitbox(scene: Scene): Hitbox {
  const [found] = findHitboxes(scene);
  if (!found) throw new Error("no Hitbox spawned");
  return found;
}

function fireHitboxTrigger(spawned: Hitbox, target: Entity): void {
  const collider = spawned.get(ColliderComponent);
  captured.triggerHandlers.get(collider)?.({ other: target, entered: true });
}

function leaveHitboxTrigger(spawned: Hitbox, target: Entity): void {
  const collider = spawned.get(ColliderComponent);
  captured.triggerHandlers.get(collider)?.({ other: target, entered: false });
}

describe("hitbox step", () => {
  it("aims off the caster's Facing when aim is omitted", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing()).set(0, 1); // south, screen convention
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    expect(findHitbox(scene).get(Transform).rotation).toBeCloseTo(Math.PI / 2);
  });

  it("aims along an explicit aim vector", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
              aim: { x: 0, y: -3 },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    expect(findHitbox(scene).get(Transform).rotation).toBeCloseTo(-Math.PI / 2);
  });

  it("resolves and snapshots a resolver aim at enter", () => {
    const { entity, scene, pc } = setup();
    let dir = { x: 1, y: 0 };
    const resolver = vi.fn(() => dir);
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
              aim: resolver,
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);
    dir = { x: 0, y: 1 }; // later state change must not move the already-spawned hitbox

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(findHitbox(scene).get(Transform).rotation).toBeCloseTo(0);
  });

  it("throws when aim is omitted and there is no Facing", () => {
    const { entity, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.1,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    expect(() => pc._tick(0.01)).toThrow(/Facing|aim/);
  });

  it("throws when an explicit aim resolves to a zero vector", () => {
    const { entity, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.1,
              shape: { type: "circle", radius: 5 },
              hit: {},
              aim: { x: 0, y: 0 },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    expect(() => pc._tick(0.01)).toThrow(/zero vector/);
  });

  it("inherits team from the caster's HitReceiver when the step omits team", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(new HitReceiver({ team: "player" }));
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: { damage: 1 },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(target.received[0]!.team).toBe("player");
  });

  it("an explicit team overrides the caster's HitReceiver team", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(new HitReceiver({ team: "player" }));
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
              team: "boss",
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(target.received[0]!.team).toBe("boss");
  });

  it("resolves a hit builder once at enter and freezes the payload", () => {
    const { entity, scene, pc } = setup();
    let damage = 1;
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: () => ({ damage }),
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);
    damage = 99; // later state change must not affect the already-resolved hit

    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(target.received[0]!.data).toEqual({ damage: 1 });
  });

  it("passes layers/mask through to the spawned hitbox's collider", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
              layers: 1,
              mask: 6,
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    const collider = findHitbox(scene).get(ColliderComponent);
    expect(collider.config.layers).toBe(1);
    expect(collider.config.mask).toBe(6);
  });

  it("destroys the spawned hitbox when the window closes naturally", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);
    const spawned = findHitbox(scene);
    expect(spawned.isDestroyed).toBe(false);

    pc._tick(0.19);
    expect(spawned.isDestroyed).toBe(true);
  });

  it("destroys the spawned hitbox when the ability is cancelled mid-window", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    const abilities = entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 1,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    abilities.send("swing");
    pc._tick(0.01);
    const spawned = findHitbox(scene);

    abilities.cancel();
    expect(spawned.isDestroyed).toBe(true);
  });

  it("redelivers to current overlaps at every interval and stops after cancellation", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    const abilities = entity.add(
      new Abilities([
        {
          id: "aura",
          timeline: [
            hitbox({
              from: 0,
              to: 1,
              every: 0.1,
              shape: { type: "circle", radius: 5 },
              hit: { damage: 1 },
            }),
          ],
        },
      ]),
    );

    abilities.send("aura");
    pc._tick(0.01);
    const spawned = findHitbox(scene);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(spawned, target);
    expect(target.received).toHaveLength(1);

    pc._tick(0.1);
    expect(target.received).toHaveLength(2);
    pc._tick(0.1);
    expect(target.received).toHaveLength(3);

    abilities.cancel();
    pc._tick(0.3);
    expect(target.received).toHaveLength(3);
  });

  it("stops interval hits outside the overlap and hits immediately on re-entry", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "aura",
          timeline: [
            hitbox({
              from: 0,
              to: 1,
              every: 0.1,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("aura");
    pc._tick(0.01);
    const spawned = findHitbox(scene);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(spawned, target);
    leaveHitboxTrigger(spawned, target);

    pc._tick(0.19);
    expect(target.received).toHaveLength(1);
    fireHitboxTrigger(spawned, target);
    expect(target.received).toHaveLength(2);
    pc._tick(0.1);
    expect(target.received).toHaveLength(3);
  });

  it("keeps once-per-window behavior across exit and re-entry when every is omitted", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 1,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);
    const spawned = findHitbox(scene);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(spawned, target);
    leaveHitboxTrigger(spawned, target);
    fireHitboxTrigger(spawned, target);

    expect(target.received).toHaveLength(1);
  });

  it("tracks two overlapping hitbox windows in one timeline independently", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    const abilities = entity.add(
      new Abilities([
        {
          id: "combo",
          timeline: [
            hitbox({
              from: 0,
              to: 0.1,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
            hitbox({
              from: 0,
              to: 0.3,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    abilities.send("combo");
    pc._tick(0.01); // both enter
    const [short, long] = findHitboxes(scene);
    expect(short).toBeDefined();
    expect(long).toBeDefined();

    pc._tick(0.15); // short exits at 0.1, long (to 0.3) still open
    expect(short!.isDestroyed).toBe(true);
    expect(long!.isDestroyed).toBe(false);

    pc._tick(0.2); // long exits at 0.3
    expect(long!.isDestroyed).toBe(true);
  });

  it("emits HitDealt on the caster when the hitbox lands a hit; a cancelled swing emits nothing", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    const abilities = entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );
    const dealt: HitResult[] = [];
    entity.on(HitDealt, (payload) => dealt.push(payload.result));

    abilities.send("swing");
    pc._tick(0.01);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(dealt).toEqual(["hit"]);

    abilities.cancel();
    dealt.length = 0;
    abilities.send("swing");
    pc._tick(0.01);
    abilities.cancel(); // never contacts a target

    expect(dealt).toEqual([]);
  });

  it("attributes a spawned attack's hitbox to the original caster", () => {
    const { entity: caster, scene } = createMockEntity("caster");
    caster.add(new Transform({ position: Vec2.ZERO }));
    const spawned = scene.spawn(SpawnedAttacker, {
      caster,
      aim: Vec2.RIGHT,
      position: new Vec2(5, 0),
      params: {},
      team: "player",
    });
    spawned.add(new Transform({ position: new Vec2(5, 0) }));
    spawned.add(new Facing());
    const pc = spawned.add(new ProcessComponent());
    spawned.add(
      new Abilities([
        {
          id: "child-hit",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: { damage: 2 },
            }),
          ],
        },
      ]),
    );
    const dealt: HitResult[] = [];
    caster.on(HitDealt, ({ result }) => dealt.push(result));

    spawned.get(Abilities).send("child-hit");
    pc._tick(0.01);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(target.received[0]?.source).toBe(caster);
    expect(target.received[0]?.team).toBe("player");
    expect(dealt).toEqual(["hit"]);
  });

  it("falls back to the original caster's HitReceiver team when the spawned attack's own context has none", () => {
    // The spawned attack itself carries no team (no explicit context team,
    // no HitReceiver of its own) — team resolution must reach past it to
    // the resolved caster's own HitReceiver, not stop at the running
    // entity's (`ctx.entity`'s) own, which is what a team-fallback drift
    // between `hitbox` and `spawn` used to do.
    const { entity: caster, scene } = createMockEntity("caster");
    caster.add(new Transform({ position: Vec2.ZERO }));
    caster.add(new HitReceiver({ team: "boss" }));
    const spawned = scene.spawn(SpawnedAttacker, {
      caster,
      aim: Vec2.RIGHT,
      position: new Vec2(5, 0),
      params: {},
    });
    spawned.add(new Transform({ position: new Vec2(5, 0) }));
    spawned.add(new Facing());
    const pc = spawned.add(new ProcessComponent());
    spawned.add(
      new Abilities([
        {
          id: "child-hit",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: { damage: 2 },
            }),
          ],
        },
      ]),
    );

    spawned.get(Abilities).send("child-hit");
    pc._tick(0.01);
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(10, 0) }));
    fireHitboxTrigger(findHitbox(scene), target);

    expect(target.received[0]?.team).toBe("boss");
  });

  it("wires the caster in as the follow target when follow is set", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
              follow: true,
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);
    const spawned = findHitbox(scene);

    entity.get(Transform).setPosition(40, -10);
    spawned.get(HitboxFollow).update();

    expect(spawned.get(Transform).position).toEqual(new Vec2(40, -10));
  });

  it("does not attach follow tracking when follow is omitted (default false)", () => {
    const { entity, scene, pc } = setup();
    entity.add(new Facing());
    entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("swing");
    pc._tick(0.01);

    expect(findHitbox(scene).tryGet(HitboxFollow)).toBeUndefined();
  });

  it("throws on a caster with no Transform", () => {
    const { entity } = createMockEntity("no-transform");
    const pc = entity.add(new ProcessComponent());
    entity.add(new Facing());
    const abilities = entity.add(
      new Abilities([
        {
          id: "swing",
          timeline: [
            hitbox({
              from: 0,
              to: 0.2,
              shape: { type: "circle", radius: 5 },
              hit: {},
            }),
          ],
        },
      ]),
    );

    abilities.send("swing");
    expect(() => pc._tick(0.01)).toThrow(
      /step "hitbox" requires a Transform component/,
    );
  });
});
