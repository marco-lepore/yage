import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  Entity,
  EntityPool,
  ErrorBoundaryKey,
  ProcessComponent,
  Transform,
  Vec2,
  createMockEntity,
  trait,
} from "@yagejs/core";
import { AbilitySpawned } from "../../core/AbilitySpawned.js";
import type {
  AbilitySpawnContext,
  AbilitySpawnParams,
} from "../../core/AbilitySpawned.js";
import { Abilities } from "../../core/Abilities.js";
import { Hittable } from "../../core/hit/types.js";
import type { Hit, HitResult } from "../../core/hit/types.js";
import { Facing } from "../Facing.js";
import { HitDealt } from "../reportedDelivery.js";
import { HitReceiver } from "../HitReceiver.js";
import { spawn } from "./spawn.js";

vi.mock("@yagejs/physics", async () => {
  const core =
    await vi.importActual<typeof import("@yagejs/core")>("@yagejs/core");
  return { RigidBodyComponent: class extends core.Component {} };
});

interface OrbParams {
  power: number;
  label: string;
}

@trait(AbilitySpawned)
class Orb extends Entity {
  abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;

  override setup(context: AbilitySpawnContext<OrbParams>): void {
    this.abilitySpawnContext = context;
    this.add(new Transform({ position: context.position }));
  }
}

@trait(Hittable)
class Target extends Entity {
  received: Hit[] = [];

  receiveHit(hit: Hit): HitResult {
    this.received.push(hit);
    return "hit";
  }
}

function setup() {
  const { entity, scene } = createMockEntity("caster");
  entity.add(new Transform({ position: new Vec2(10, 20) }));
  entity.add(new Facing()).set(0, 1);
  entity.add(new HitReceiver({ team: "player" }));
  const pc = entity.add(new ProcessComponent());
  return { entity, scene, pc };
}

function findOrb(entities: readonly Entity[]): Orb {
  const found = entities.find((entity): entity is Orb => entity instanceof Orb);
  if (!found) throw new Error("no Orb spawned");
  return found;
}

describe("spawn step", () => {
  it("acquires and reuses a capped pool member with inferred optional setup params", () => {
    @trait(AbilitySpawned)
    class PooledOrb extends Entity {
      abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;
      override setup(context?: AbilitySpawnContext<OrbParams>): void {
        this.abilitySpawnContext = context;
        this.add(new Transform());
      }
      override onAcquire(context: AbilitySpawnContext<OrbParams>): void {
        this.abilitySpawnContext = context;
        this.get(Transform).setPosition(context.position.x, context.position.y);
      }
    }
    const { entity, scene, pc } = setup();
    const pool = new EntityPool(scene, PooledOrb, { prewarm: 1, maxSize: 1 });
    const contexts: AbilitySpawnContext<OrbParams>[] = [];
    const abilities = entity.add(
      new Abilities([
        {
          id: "pool",
          duration: 0.1,
          timeline: [
            spawn({
              at: 0,
              entity: PooledOrb,
              params: { power: 4, label: "pooled" },
              offset: { x: 3, y: 0 },
              hit: { damage: 7 },
              acquire(context, stepContext) {
                const power: number = context.params.power;
                expect(power).toBe(4);
                expect(context.activation).toBe(stepContext.activation);
                contexts.push(context);
                return pool.acquire(context);
              },
            }),
          ],
        },
      ]),
    );
    const fire = (): void => {
      abilities.send("pool");
      pc._tick(0.2, undefined, "fixed");
    };
    fire();
    const member = scene
      .findEntities()
      .find((e): e is PooledOrb => e instanceof PooledOrb)!;
    expect(member.abilitySpawnContext).toMatchObject({
      caster: entity,
      team: "player",
      aim: new Vec2(0, 1),
      position: new Vec2(10, 23),
      params: { power: 4, label: "pooled" },
    });
    fire();
    expect(member.abilitySpawnContext).toBe(contexts[0]);
    expect(
      scene.findEntities().filter((e) => e instanceof PooledOrb),
    ).toHaveLength(1);
    pool.release(member);
    fire();
    expect(member.abilitySpawnContext).toBe(contexts[2]);
    pool.dispose();
  });

  it("attributes an acquire throw without spawning a fallback", () => {
    const { entity, scene, pc } = setup();
    const error = new Error("acquire failed");
    const abilities = entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 1, label: "x" },
              acquire() {
                throw error;
              },
            }),
          ],
        },
      ]),
    );
    abilities.send("orb");
    expect(() => pc._tick(0.1, undefined, "fixed")).toThrow(error);
    expect(scene.findEntities().filter((e) => e instanceof Orb)).toHaveLength(
      0,
    );
    expect(
      scene.context.resolve(ErrorBoundaryKey).getCallbackErrors(),
    ).toMatchObject([{ kind: "Ability spawn acquire callback" }]);
  });
  it("passes typed params and resolved spawn context to the entity", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "orb",
          // Explicit duration past the point step, so the run is still
          // "active" after the tick below — needed for the identity
          // assertions, which read the live `active(lane)` handle.
          duration: 1,
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 4, label: "arc" },
              offset: { x: 3, y: 0 },
              hit: { damage: 7 },
            }),
          ],
        },
      ]),
    );

    const result = entity.get(Abilities).send("orb");
    if (!result.ok) throw new Error("expected send to succeed");
    pc._tick(0.01, undefined, "fixed");

    const context = findOrb(scene.findEntities()).abilitySpawnContext;
    expect(context?.caster).toBe(entity);
    expect(context?.aim).toEqual(new Vec2(0, 1));
    expect(context?.position.x).toBeCloseTo(10);
    expect(context?.position.y).toBeCloseTo(23);
    expect(context?.team).toBe("player");
    expect(context?.params).toEqual({ power: 4, label: "arc" });
    expect(context?.delivery).toBeDefined();
    expect(context?.activation?.def.id).toBe("orb");
    expect(context?.activation?.lane).toBe("main");
    // Identity, not just field equality: the same handle threaded through
    // PlayResult, AbilitySpawnContext, and the live `active(lane)` read.
    expect(context?.activation).toBe(result.activation);
    expect(context?.activation).toBe(entity.get(Abilities).active("main"));
  });

  it("resolves an absolute position when the step fires", () => {
    const { entity, scene, pc } = setup();
    let position = new Vec2(30, 40);
    const resolvePosition = vi.fn(() => position);
    entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0.1,
              entity: Orb,
              params: { power: 4, label: "arc" },
              position: resolvePosition,
            }),
          ],
        },
      ]),
    );

    entity.get(Transform).setPosition(99, 99);
    position = new Vec2(50, 60);
    entity.get(Abilities).send("orb");
    pc._tick(0.1, undefined, "fixed");

    expect(resolvePosition).toHaveBeenCalledOnce();
    expect(findOrb(scene.findEntities()).abilitySpawnContext?.position).toEqual(
      new Vec2(50, 60),
    );
  });

  it("uses an explicit position without a Transform on the running entity", () => {
    const { entity, scene } = createMockEntity("transformless-caster");
    const pc = entity.add(new ProcessComponent());
    entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 4, label: "arc" },
              aim: { x: 1, y: 0 },
              position: { x: 50, y: 60 },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("orb");
    pc._tick(0.01, undefined, "fixed");

    expect(findOrb(scene.findEntities()).abilitySpawnContext?.position).toEqual(
      new Vec2(50, 60),
    );
  });

  it("applies the facing-local offset after an absolute position", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 4, label: "arc" },
              position: { x: 30, y: 40 },
              offset: { x: 5, y: 0 },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("orb");
    pc._tick(0.01, undefined, "fixed");

    const position = findOrb(scene.findEntities()).abilitySpawnContext
      ?.position;
    expect(position?.x).toBeCloseTo(30);
    expect(position?.y).toBeCloseTo(45);
  });

  it("omits activation on a direct scene.spawn not fired through the spawn step", () => {
    const { scene } = setup();
    const caster = scene.spawn("direct-caster");
    const orb = scene.spawn(Orb, {
      caster,
      aim: new Vec2(1, 0),
      position: new Vec2(0, 0),
      params: { power: 1, label: "direct" },
    });
    expect(orb.abilitySpawnContext?.activation).toBeUndefined();
  });

  it("omits delivery when the step has no hit", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "telegraph",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 0, label: "warning" },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("telegraph");
    pc._tick(0.01, undefined, "fixed");

    expect(
      findOrb(scene.findEntities()).abilitySpawnContext?.delivery,
    ).toBeUndefined();
  });

  it("attributes the supplied delivery and HitDealt event to the original caster", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 1, label: "hit" },
              hit: { damage: 5 },
            }),
          ],
        },
      ]),
    );
    const dealt: HitResult[] = [];
    entity.on(HitDealt, ({ result }) => dealt.push(result));

    entity.get(Abilities).send("orb");
    pc._tick(0.01, undefined, "fixed");
    const orb = findOrb(scene.findEntities());
    const target = scene.spawn(Target);
    target.add(new Transform({ position: new Vec2(20, 20) }));
    orb.abilitySpawnContext?.delivery?.deliver(
      target,
      orb.get(Transform).worldPosition,
    );

    expect(target.received[0]?.source).toBe(entity);
    expect(dealt).toEqual(["hit"]);
  });

  it("rejects a class missing the AbilitySpawned trait before construction", () => {
    class InvalidSpawn extends Entity {
      static latest: InvalidSpawn | undefined;

      constructor() {
        super();
        InvalidSpawn.latest = this;
      }

      abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;

      override setup(context: AbilitySpawnContext<OrbParams>): void {
        this.abilitySpawnContext = context;
      }
    }

    const { entity, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "invalid",
          timeline: [
            spawn({
              at: 0,
              entity: InvalidSpawn,
              params: { power: 1, label: "invalid" },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("invalid");
    expect(() => pc._tick(0.01, undefined, "fixed")).toThrow(
      /step "spawn".*AbilitySpawned trait/,
    );
    expect(InvalidSpawn.latest).toBeUndefined();
  });

  it("leaves the spawned entity in the scene when its setup throws", () => {
    @trait(AbilitySpawned)
    class BrokenSpawn extends Entity {
      static latest: BrokenSpawn | undefined;
      abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;

      constructor() {
        super();
        BrokenSpawn.latest = this;
      }

      override setup(context: AbilitySpawnContext<OrbParams>): void {
        this.abilitySpawnContext = context;
        throw new Error("broken attack");
      }
    }

    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "broken",
          timeline: [
            spawn({
              at: 0,
              entity: BrokenSpawn,
              params: { power: 1, label: "broken" },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("broken");
    expect(() => pc._tick(0.01, undefined, "fixed")).toThrow("broken attack");
    // A throwing setup() is not rolled back — the half-built entity stays in
    // the scene for the developer to inspect, same as any other scene.spawn().
    expect(BrokenSpawn.latest?.isDestroyed).toBe(false);
    expect(
      scene
        .findEntities()
        .some((candidate) => candidate instanceof BrokenSpawn),
    ).toBe(true);
  });

  it("lets a spawned attack pass its original caster to a child attack", () => {
    @trait(AbilitySpawned)
    class Child extends Entity {
      abilitySpawnContext: AbilitySpawnContext<{ depth: number }> | undefined;

      override setup(context: AbilitySpawnContext<{ depth: number }>): void {
        this.abilitySpawnContext = context;
      }
    }

    @trait(AbilitySpawned)
    class Parent extends Entity {
      abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;
      child: Child | undefined;

      override setup(context: AbilitySpawnContext<OrbParams>): void {
        this.abilitySpawnContext = context;
        this.child = this.scene.spawn(Child, {
          caster: context.caster,
          aim: context.aim,
          position: context.position,
          params: { depth: 2 },
          ...(context.team !== undefined ? { team: context.team } : {}),
        });
      }
    }

    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "parent",
          timeline: [
            spawn({
              at: 0,
              entity: Parent,
              params: { power: 2, label: "parent" },
            }),
          ],
        },
      ]),
    );

    entity.get(Abilities).send("parent");
    pc._tick(0.01, undefined, "fixed");

    const parent = scene
      .findEntities()
      .find((candidate): candidate is Parent => candidate instanceof Parent);
    expect(parent?.child?.abilitySpawnContext?.caster).toBe(entity);
  });

  it("a nested spawn's activation.entity is the spawned attack that ran it, not the original caster", () => {
    const { entity, scene, pc } = setup();
    entity.add(
      new Abilities([
        {
          id: "orb",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 1, label: "parent" },
            }),
          ],
        },
      ]),
    );
    entity.get(Abilities).send("orb");
    pc._tick(0.01, undefined, "fixed");
    const orb = findOrb(scene.findEntities());

    const orbPc = orb.add(new ProcessComponent());
    orb.add(
      new Abilities([
        {
          id: "child",
          timeline: [
            spawn({
              at: 0,
              entity: Orb,
              params: { power: 2, label: "child" },
              aim: { x: 1, y: 0 },
            }),
          ],
        },
      ]),
    );
    orb.get(Abilities).send("child");
    orbPc._tick(0.01, undefined, "fixed");

    const children = scene
      .findEntities()
      .filter(
        (candidate): candidate is Orb =>
          candidate instanceof Orb && candidate !== orb,
      );
    expect(children).toHaveLength(1);
    expect(children[0]!.abilitySpawnContext?.caster).toBe(entity); // original caster preserved
    expect(children[0]!.abilitySpawnContext?.activation?.entity).toBe(orb); // this run's owner
  });

  it("requires params to match the spawned entity class", () => {
    const inferred: AbilitySpawnParams<typeof Orb> = {
      power: 2,
      label: "typed",
    };
    expect(inferred.power).toBe(2);

    spawn({
      at: 0,
      entity: Orb,
      // @ts-expect-error power must be a number
      params: { power: "high", label: "typed" },
    });
  });

  it("requires setup to accept AbilitySpawnContext for parameter inference", () => {
    class WrongSetup extends Entity {
      abilitySpawnContext: AbilitySpawnContext<OrbParams> | undefined;

      override setup(params: OrbParams): void {
        void params;
      }
    }

    expectTypeOf<
      AbilitySpawnParams<typeof WrongSetup>
    >().toEqualTypeOf<never>();
    spawn({
      at: 0,
      entity: WrongSetup,
      // @ts-expect-error setup must receive AbilitySpawnContext<OrbParams>
      params: { power: 2, label: "invalid" },
    });
  });

  it("requires trait classes to declare abilitySpawnContext", () => {
    class MissingContext extends Entity {
      override setup(): void {}
    }

    // @ts-expect-error AbilitySpawned requires an abilitySpawnContext member
    trait(AbilitySpawned)(MissingContext);
  });
});
