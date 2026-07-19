import { describe, expect, it, vi } from "vitest";
import {
  Entity,
  ProcessComponent,
  Transform,
  Vec2,
  createMockEntity,
  trait,
} from "@yagejs/core";
import { AbilitySpawned } from "../../core/AbilitySpawned.js";
import type { AbilitySpawnContext } from "../../core/AbilitySpawned.js";
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
    pc._tick(0.01);

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
    pc._tick(0.01);

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
    pc._tick(0.01);
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
    expect(() => pc._tick(0.01)).toThrow(/step "spawn".*AbilitySpawned trait/);
    expect(InvalidSpawn.latest).toBeUndefined();
  });

  it("removes the spawned entity when its setup throws", () => {
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
    expect(() => pc._tick(0.01)).toThrow("broken attack");
    expect(BrokenSpawn.latest?.isDestroyed).toBe(true);
    expect(
      scene
        .findEntities()
        .some((candidate) => candidate instanceof BrokenSpawn),
    ).toBe(false);
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
    pc._tick(0.01);

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
    pc._tick(0.01);
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
    orbPc._tick(0.01);

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
    spawn({
      at: 0,
      entity: Orb,
      // @ts-expect-error power must be a number
      params: { power: "high", label: "typed" },
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
