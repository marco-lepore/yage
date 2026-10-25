import { describe, it, expect, vi } from "vitest";

// Real physics: which filter Rapier's hook consults first is its handle
// order, so the both-filters-run rule can only be checked against the real
// narrow phase. The `@dimforge/rapier2d` ESM build crashes when hooks are
// passed to `world.step` under vitest's transform, so the factory swaps in
// `@dimforge/rapier2d-compat` — the same library and version, instantiated
// at runtime.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import { Transform, Vec2 } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import type { ContactCandidate } from "./types.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

describe("shape casts with contact filters (real Rapier)", () => {
  it("skips rejected surfaces, checks both filters, and reads current poses", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const sourceFilter = vi.fn(() => true);
    const source = spawnFilteredBox(scene, "source", sourceFilter);
    const rejected = spawnFilteredBox(scene, "rejected", () => false);
    rejected.entity.get(RigidBodyComponent).setPosition(0, 50);
    const accepted = spawnFilteredBox(scene, "accepted", () => true);
    accepted.entity.get(RigidBodyComponent).setPosition(0, 100);
    physicsWorld.step(DT);
    source.entity.get(RigidBodyComponent).setPosition(0, 5);
    source.entity.get(RigidBodyComponent).setVelocityY(30);
    const rejectedFilter = vi.fn((contact: ContactCandidate) => {
      expect(contact.dt).toBe(0);
      expect(contact.otherY).toBeCloseTo(5);
      expect(contact.otherVelocityY).toBeCloseTo(30);
      return false;
    });
    rejected.setContactFilter(rejectedFilter);
    const shape = { type: "box", width: 10, height: 10 } as const;
    const cast = (filtered: boolean) =>
      physicsWorld.castShape(shape, { x: 0, y: 25 }, { x: 0, y: 1 }, 150, {
        ...(filtered ? { solidFor: source } : {}),
      });

    expect(cast(false)?.entity).toBe(rejected.entity);
    expect(rejectedFilter).not.toHaveBeenCalled();
    expect(cast(true)?.entity).toBe(accepted.entity);
    expect(rejectedFilter).toHaveBeenCalled();
    expect(sourceFilter).toHaveBeenCalled();
    // The source veto also rejects surfaces that permit the pair.
    sourceFilter.mockReturnValue(false);
    rejectedFilter.mockClear();
    expect(cast(true)).toBeNull();
    expect(rejectedFilter).toHaveBeenCalled();
    // Starting inside the source never reports the source itself.
    sourceFilter.mockReturnValue(true);
    expect(
      physicsWorld.castShape(shape, { x: 0, y: 5 }, { x: 0, y: 1 }, 150, {
        solidFor: source,
      })?.entity,
    ).toBe(accepted.entity);
  });

  it("rejects an unattached or foreign source collider", async () => {
    const { physicsWorld } = await createPhysicsTestContext();
    const other = await createPhysicsTestContext();
    const unattached = new ColliderComponent({
      shape: { type: "box", width: 10, height: 10 },
    });
    const foreign = spawnFilteredBox(other.scene, "foreign", () => true);
    for (const source of [unattached, foreign]) {
      expect(() =>
        physicsWorld.castShape(
          { type: "box", width: 10, height: 10 },
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          100,
          { solidFor: source },
        ),
      ).toThrow("solidFor must have live colliders in this world");
    }
  });
});

describe("solidFor across query kinds (real Rapier)", () => {
  const PLAYER = 1;
  const SOLID = 2;
  const GHOST = 4;

  function spawnStatic(
    scene: Scene,
    name: string,
    y: number,
    extra: { layers?: number; sensor?: boolean; oneWay?: boolean } = {},
  ): ColliderComponent {
    const entity = spawnEntityInScene(scene, name);
    entity.add(new Transform({ position: new Vec2(0, y) }));
    entity.add(new RigidBodyComponent({ type: "static" }));
    return entity.add(
      new ColliderComponent({
        shape: { type: "box", width: 100, height: 10 },
        layers: extra.layers ?? SOLID,
        mask: PLAYER,
        ...(extra.sensor ? { sensor: true } : {}),
        ...(extra.oneWay ? { oneWay: {} } : {}),
      }),
    );
  }

  function spawnActor(scene: Scene, y: number): ColliderComponent {
    const entity = spawnEntityInScene(scene, "actor");
    entity.add(new Transform({ position: new Vec2(0, y) }));
    entity.add(
      new RigidBodyComponent({
        type: "dynamic",
        gravityScale: 0,
        fixedRotation: true,
      }),
    );
    return entity.add(
      new ColliderComponent({
        shape: { type: "box", width: 16, height: 44 },
        layers: PLAYER,
        mask: SOLID,
      }),
    );
  }

  it("reports only colliders the source's groups admit, and no sensors", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const actor = spawnActor(scene, 0);
    const ghost = spawnStatic(scene, "ghost", 50, { layers: GHOST });
    const trigger = spawnStatic(scene, "trigger", 70, { sensor: true });
    const floor = spawnStatic(scene, "floor", 100);
    const box = { type: "box", width: 10, height: 10 } as const;
    const down = { x: 0, y: 1 };

    expect(
      physicsWorld.castShape(box, { x: 0, y: 30 }, down, 200)?.entity,
    ).toBe(ghost.entity);
    expect(
      physicsWorld.castShape(box, { x: 0, y: 30 }, down, 200, {
        solidFor: actor,
      })?.entity,
    ).toBe(floor.entity);
    expect(
      physicsWorld.raycast({ x: 0, y: 30 }, down, 200, {
        solidFor: actor,
        sensors: "include",
      })?.entity,
    ).toBe(floor.entity);
    const tall = { type: "box", width: 10, height: 80 } as const;
    expect(physicsWorld.queryShape(tall, { x: 0, y: 80 })).toEqual(
      expect.arrayContaining([ghost.entity, floor.entity]),
    );
    expect(
      physicsWorld.queryShape(
        tall,
        { x: 0, y: 80 },
        { solidFor: actor, sensors: "include" },
      ),
    ).toEqual([floor.entity]);
    expect(
      physicsWorld.raycast({ x: 0, y: 60 }, down, 200, { sensors: "include" })
        ?.entity,
    ).toBe(trigger.entity);
    expect(() =>
      physicsWorld.queryShape(
        tall,
        { x: 0, y: 80 },
        { solidFor: actor, sensors: "only" },
      ),
    ).toThrow(/sensors: "only"/);
  });

  it("answers a one-way platform from the source's side of it", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const platform = spawnStatic(scene, "platform", 100, { oneWay: true });
    const actor = spawnActor(scene, 130);
    physicsWorld.step(DT);
    const headroom = { type: "box", width: 12, height: 10 } as const;

    // Below the platform: the space above the head overlaps it, but the
    // actor would pass through, so a solid query reports it clear.
    expect(physicsWorld.queryShape(headroom, { x: 0, y: 100 })).toEqual([
      platform.entity,
    ]);
    expect(
      physicsWorld.queryShape(headroom, { x: 0, y: 100 }, { solidFor: actor }),
    ).toEqual([]);

    // Above the platform: the same platform supports the actor.
    actor.entity.get(RigidBodyComponent).setPosition(0, 72);
    const hit = physicsWorld.castShape(
      { type: "box", width: 16, height: 44 },
      { x: 0, y: 72 },
      { x: 0, y: 1 },
      10,
      { solidFor: actor },
    );
    expect(hit?.entity).toBe(platform.entity);
    expect(hit?.distance).toBeCloseTo(1, 1);
    expect(
      physicsWorld.raycast({ x: 0, y: 72 }, { x: 0, y: 1 }, 40, {
        solidFor: actor,
      })?.entity,
    ).toBe(platform.entity);
  });
});

function spawnFilteredBox(
  scene: Scene,
  name: string,
  filter: (candidate: ContactCandidate) => boolean,
  mask = 0xffff,
): ColliderComponent {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(0, 0) }));
  entity.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
  const collider = entity.add(
    new ColliderComponent({
      shape: { type: "box", width: 20, height: 20 },
      mask,
    }),
  );
  collider.setContactFilter(filter);
  return collider;
}

describe("contact filters on both sides of a pair (real Rapier)", () => {
  it.each([0.5, 1, 2.5])(
    "reads the kinematic body's last completed velocity at time scale %s",
    async (scale) => {
      const { scene, context } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      scene.timeScale = scale;
      const system = new PhysicsSystem();
      system._setContext(context);
      const platform = spawnEntityInScene(scene, "platform");
      const transform = platform.add(new Transform());
      const body = platform.add(new RigidBodyComponent({ type: "kinematic" }));
      const collider = platform.add(
        new ColliderComponent({
          shape: { type: "box", width: 100, height: 100 },
        }),
      );
      const selfVelocities: Array<{ x: number; y: number }> = [];
      const otherVelocities: Array<{ x: number; y: number }> = [];
      collider.setContactFilter((contact) => {
        selfVelocities.push({
          x: contact.selfVelocityX,
          y: contact.selfVelocityY,
        });
        return false;
      });
      spawnFilteredBox(scene, "actor", (contact) => {
        otherVelocities.push({
          x: contact.otherVelocityX,
          y: contact.otherVelocityY,
        });
        return true;
      });

      for (let update = 1; update <= 4; update++) {
        transform.setPosition(
          60 * DT * scale * update,
          -120 * DT * scale * update,
        );
        system.update(DT);
      }

      expect(body.velocityX).toBeCloseTo(60);
      expect(body.velocityY).toBeCloseTo(-120);
      for (const velocities of [selfVelocities, otherVelocities]) {
        expect(velocities.length).toBeGreaterThan(1);
        expect(velocities[0]).toEqual({ x: 0, y: 0 });
        for (const velocity of velocities.slice(1)) {
          expect(velocity.x).toBeCloseTo(60);
          expect(velocity.y).toBeCloseTo(-120);
        }
      }
    },
  );

  it("identifies the participating compound shape", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const compoundEntity = spawnEntityInScene(scene, "compound");
    compoundEntity.add(new Transform());
    compoundEntity.add(
      new RigidBodyComponent({ type: "static", fixedRotation: true }),
    );
    const compound = compoundEntity.add(
      new ColliderComponent({
        parts: [
          {
            shape: { type: "box", width: 20, height: 20 },
            offset: { x: -100, y: 0 },
          },
          { shape: { type: "box", width: 20, height: 20 } },
        ],
      }),
    );
    const seen: Array<[number, number]> = [];
    compound.setContactFilter((contact) => {
      seen.push([contact.selfShapeIndex, contact.otherShapeIndex]);
      return true;
    });
    const other = spawnEntityInScene(scene, "other");
    other.add(new Transform());
    other.add(new RigidBodyComponent({ type: "dynamic", fixedRotation: true }));
    other.add(
      new ColliderComponent({ shape: { type: "box", width: 20, height: 20 } }),
    );

    physicsWorld.step(DT);

    expect(seen).toContainEqual([1, 0]);
    expect(seen).not.toContainEqual([0, 0]);
  });

  it.each(["first", "second"])(
    "runs both filters every step when the %s collider vetoes",
    async (vetoSide) => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      const first = vi.fn(() => vetoSide !== "first");
      const second = vi.fn(() => vetoSide !== "second");
      spawnFilteredBox(scene, "first", first);
      spawnFilteredBox(scene, "second", second);

      for (let i = 0; i < 5; i++) {
        physicsWorld.step(DT);
        physicsWorld.processCollisionEvents();
      }

      expect(first).toHaveBeenCalledTimes(5);
      expect(second).toHaveBeenCalledTimes(5);
    },
  );
});

describe("solid contact queries (real Rapier)", () => {
  it.each(["sourceFilter", "otherFilter", "sourceMask", "otherMask", "sensor"])(
    "excludes %s while retaining geometric contact queries",
    async (reason) => {
      const { scene } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      const source = spawnFilteredBox(
        scene,
        "source",
        () => reason !== "sourceFilter",
        reason === "sourceMask" ? 0 : 0xffff,
      );
      const other = spawnFilteredBox(
        scene,
        "other",
        () => reason !== "otherFilter",
        reason === "otherMask" ? 0 : 0xffff,
      );
      if (reason === "sensor") other.setSensor(true);
      expect(source.contactWith(other)).toBeDefined();
      expect(source.contactWith(other, { solidOnly: true })).toBeUndefined();
    },
  );

  it("runs both filters with current poses and zero dt", async () => {
    const { scene } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const first = vi.fn(() => false);
    const source = spawnFilteredBox(scene, "source", first);
    const second = vi.fn((c: ContactCandidate) => {
      expect(c.dt).toBe(0);
      expect(c.otherX).toBeCloseTo(3);
      expect(c.otherVelocityX).toBeCloseTo(20);
      return true;
    });
    const other = spawnFilteredBox(scene, "other", second);
    source.entity.get(RigidBodyComponent).setPosition(3, 0);
    source.entity.get(RigidBodyComponent).setVelocityX(20);
    expect(source.contactWith(other, { solidOnly: true })).toBeUndefined();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    first.mockReturnValue(true);
    expect(source.contactWith(other, { solidOnly: true })).toBeDefined();
  });

  it("only snapshots participating colliders during repeated filtered casts", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const source = spawnFilteredBox(scene, "source", () => true);
    const target = spawnFilteredBox(scene, "target", () => true);
    target.entity.get(RigidBodyComponent).setPosition(0, 50);
    const unrelated: number[] = [];
    for (let i = 0; i < 50; i++) {
      const far = spawnFilteredBox(scene, `far-${i}`, () => true);
      far.entity.get(RigidBodyComponent).setPosition(1000 + i * 30, 0);
      unrelated.push(...far._colliderHandles);
    }
    physicsWorld.step(DT);
    const getCollider = vi.spyOn(physicsWorld, "getCollider");
    for (let i = 0; i < 3; i++) {
      expect(
        physicsWorld.castShape(
          { type: "box", width: 10, height: 10 },
          { x: 0, y: 25 },
          { x: 0, y: 1 },
          100,
          { solidFor: source },
        )?.entity,
      ).toBe(target.entity);
    }
    expect(
      getCollider.mock.calls.some(([handle]) => unrelated.includes(handle)),
    ).toBe(false);
    getCollider.mockRestore();
  });
});

it("solid contact queries respect one-way drop-through", async () => {
  const { scene } = await createPhysicsTestContext({ gravity: { x: 0, y: 0 } });
  const rider = spawnFilteredBox(scene, "rider", () => true);
  const platform = spawnEntityInScene(scene, "platform");
  platform.add(new Transform({ position: new Vec2(0, 20) }));
  platform.add(new RigidBodyComponent({ type: "static" }));
  const collider = platform.add(
    new ColliderComponent({
      shape: { type: "box", width: 100, height: 20 },
      oneWay: {},
    }),
  );
  expect(
    collider.contactWith(rider, { solidOnly: true, prediction: 1 }),
  ).toBeDefined();
  rider.dropThrough(0.3);
  expect(
    collider.contactWith(rider, { solidOnly: true, prediction: 1 }),
  ).toBeUndefined();
  expect(collider.contactWith(rider, { prediction: 1 })).toBeDefined();
});

it("solid contact queries choose the closest permitted compound part", async () => {
  const { scene, physicsWorld } = await createPhysicsTestContext({
    gravity: { x: 0, y: 0 },
  });
  const actor = spawnFilteredBox(scene, "actor", () => true);
  actor.entity.get(RigidBodyComponent).setPosition(10, 0);
  const platform = spawnEntityInScene(scene, "compound");
  platform.add(new Transform());
  platform.add(new RigidBodyComponent({ type: "static" }));
  const collider = platform.add(
    new ColliderComponent({
      parts: [
        { shape: { type: "box", width: 20, height: 20 } },
        {
          shape: { type: "box", width: 20, height: 20 },
          offset: { x: 40, y: 0 },
        },
      ],
    }),
  );
  collider.setContactFilter((c) => c.selfShapeIndex === 1);
  physicsWorld.step(0);
  expect(collider.contactWith(actor, { prediction: 30 })?.distance).toBeCloseTo(
    -10,
  );
  expect(
    collider.contactWith(actor, { prediction: 30, solidOnly: true })?.distance,
  ).toBeCloseTo(10);
});
