import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: these tests observe which colliders
// Rapier's query pipeline reports and when its index catches up with a
// change. The `@dimforge/rapier2d` ESM build crashes when hooks are passed
// to `world.step` under vitest's transform, so the factory swaps in
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

import { Entity, EntityPool, Transform, Vec2 } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { PhysicsTestContext } from "./test-helpers.js";
import type { BodyType, ColliderConfig } from "./types.js";

const DT = 1 / 60;

interface Spawned {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
  transform: Transform;
}

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: BodyType,
  collider: ColliderConfig,
): Spawned {
  const entity = spawnEntityInScene(scene, name);
  const transform = entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation: true }));
  const col = entity.add(new ColliderComponent(collider));
  return { entity, rb, collider: col, transform };
}

/** Static 200×20 box centred at (x, y); top surface at y - 10. */
function spawnGround(
  scene: Scene,
  x: number,
  y: number,
  extra: Partial<
    Pick<
      ColliderConfig,
      | "restitution"
      | "friction"
      | "density"
      | "contactSkin"
      | "sensor"
      | "layers"
      | "mask"
      | "oneWay"
    >
  > = {},
): Spawned {
  return spawnBody(scene, "ground", x, y, "static", {
    shape: { type: "box", width: 200, height: 20 },
    ...extra,
  });
}

function spawnStaticBox(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  size = 100,
): Spawned {
  return spawnBody(scene, name, x, y, "static", {
    shape: { type: "box", width: size, height: size },
  });
}

/** 20×20 dynamic box. */
function spawnBox(scene: Scene, name: string, x: number, y: number): Spawned {
  return spawnBody(scene, name, x, y, "dynamic", {
    shape: { type: "box", width: 20, height: 20 },
  });
}

/** Step like the engine does: integrate, then drain collision events. */
function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    world.step(DT);
    world.processCollisionEvents();
  }
}

/** The engine's physics systems, driven one fixed tick at a time. */
function systemsFor(ctx: PhysicsTestContext) {
  const physics = new PhysicsSystem();
  physics._setContext(ctx.context);
  const interpolation = new PhysicsInterpolationSystem();
  interpolation._setContext(ctx.context);
  return {
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        physics.update(DT);
        interpolation.update(DT);
      }
    },
  };
}

const DOWN = { x: 0, y: 1 };
const PROBE = { type: "box", width: 10, height: 10 } as const;

/** Every query family aimed at `at`, as entity names. */
function everything(world: PhysicsWorld, at: Vec2) {
  return {
    ray: world.raycast({ x: at.x, y: at.y - 200 }, DOWN, 400)?.entity.name,
    cast: world.castShape(PROBE, { x: at.x, y: at.y - 200 }, DOWN, 400)?.entity
      .name,
    shape: world.queryShape(PROBE, at).map((e) => e.name),
    radius: world.queryRadius(at, 5).map((e) => e.name),
  };
}

describe("spatial queries (real Rapier)", () => {
  describe("sensor mode", () => {
    async function coinScene() {
      const ctx = await createPhysicsTestContext();
      const { scene, physicsWorld } = ctx;
      spawnGround(scene, 0, 300);
      const coin = spawnBody(scene, "coin", 0, 200, "static", {
        shape: { type: "circle", radius: 10 },
        sensor: true,
      });
      step(physicsWorld, 1);
      return { ...ctx, coin };
    }

    it("skips sensors by default, so a ray through a coin reports the ground", async () => {
      const { physicsWorld } = await coinScene();
      const origin = { x: 0, y: 100 };

      expect(physicsWorld.raycast(origin, DOWN, 300)?.entity.name).toBe(
        "ground",
      );
      expect(
        physicsWorld.castShape(PROBE, origin, DOWN, 300)?.entity.name,
      ).toBe("ground");
      expect(physicsWorld.queryShape(PROBE, { x: 0, y: 200 })).toEqual([]);
      expect(physicsWorld.queryRadius({ x: 0, y: 200 }, 5)).toEqual([]);
    });

    it("reports the coin with sensors included, and only the coin with sensors only", async () => {
      const { physicsWorld } = await coinScene();
      const origin = { x: 0, y: 100 };
      const at = { x: 0, y: 200 };

      expect(
        physicsWorld.raycast(origin, DOWN, 300, { sensors: "include" })?.entity
          .name,
      ).toBe("coin");
      expect(
        physicsWorld.castShape(PROBE, origin, DOWN, 300, {
          sensors: "include",
        })?.entity.name,
      ).toBe("coin");
      expect(
        physicsWorld
          .queryShape(PROBE, at, { sensors: "include" })
          .map((e) => e.name),
      ).toEqual(["coin"]);
      expect(
        physicsWorld
          .queryRadius(at, 5, { sensors: "include" })
          .map((e) => e.name),
      ).toEqual(["coin"]);

      expect(
        physicsWorld.raycast(origin, DOWN, 300, { sensors: "only" })?.entity
          .name,
      ).toBe("coin");
      expect(
        physicsWorld.castShape(PROBE, origin, DOWN, 300, { sensors: "only" })
          ?.entity.name,
      ).toBe("coin");
      expect(
        physicsWorld
          .queryShape(PROBE, at, { sensors: "only" })
          .map((e) => e.name),
      ).toEqual(["coin"]);
      // The ground is solid: a sensors-only ray past the coin finds nothing.
      expect(
        physicsWorld.raycast({ x: 0, y: 250 }, DOWN, 300, { sensors: "only" }),
      ).toBeNull();
    });

    it("leaves getOverlapping reporting the coin's sensor pairs", async () => {
      const { scene, physicsWorld, coin } = await coinScene();
      const box = spawnBox(scene, "box", 0, 200);
      step(physicsWorld, 1);

      expect(coin.collider.getOverlapping().map((e) => e.name)).toEqual([
        "box",
      ]);
      expect(box.collider.getOverlapping().map((e) => e.name)).toEqual([
        "coin",
      ]);
    });
  });

  describe("freshness", () => {
    it("sees a collider created after the last step, from every query", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      step(physicsWorld, 1);
      spawnStaticBox(scene, "wall", 500, 500);
      const elapsed = physicsWorld.elapsed;

      expect(everything(physicsWorld, new Vec2(500, 500))).toEqual({
        ray: "wall",
        cast: "wall",
        shape: ["wall"],
        radius: ["wall"],
      });
      expect(physicsWorld.elapsed).toBe(elapsed);
    });

    it("sees a collider created before the first step", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      spawnStaticBox(scene, "wall", 500, 500);

      expect(
        physicsWorld.queryShape(PROBE, { x: 500, y: 500 }).map((e) => e.name),
      ).toEqual(["wall"]);
    });

    it("reports a fresh sensor overlap through queryOverlapping", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      step(physicsWorld, 1);
      const zone = spawnBody(scene, "zone", 0, 0, "static", {
        shape: { type: "box", width: 100, height: 100 },
        sensor: true,
      });
      spawnBox(scene, "box", 0, 0);

      expect(zone.collider.getOverlapping().map((e) => e.name)).toEqual([
        "box",
      ]);
    });

    it("sees a re-enabled collider and a grown one at its new extent", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const wall = spawnStaticBox(scene, "wall", 500, 500, 20);
      step(physicsWorld, 1);

      // A dormant entity is out of the simulation from the call, not from
      // the next step.
      wall.entity.setActive(false);
      expect(physicsWorld.queryShape(PROBE, { x: 500, y: 500 })).toEqual([]);
      step(physicsWorld, 1);
      expect(physicsWorld.queryShape(PROBE, { x: 500, y: 500 })).toEqual([]);
      wall.entity.setActive(true);
      expect(
        physicsWorld.queryShape(PROBE, { x: 500, y: 500 }).map((e) => e.name),
      ).toEqual(["wall"]);

      step(physicsWorld, 1);
      expect(physicsWorld.queryShape(PROBE, { x: 560, y: 500 })).toEqual([]);
      wall.collider.setShape({ type: "box", width: 140, height: 140 });
      expect(
        physicsWorld.queryShape(PROBE, { x: 560, y: 500 }).map((e) => e.name),
      ).toEqual(["wall"]);
    });

    it("finds a teleported body at its new place and not its old one", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      const wall = spawnStaticBox(scene, "wall", 100, 100);
      const crate = spawnBox(scene, "crate", 100, 300);
      step(physicsWorld, 1);

      wall.rb.setPosition(700, 100);
      crate.rb.setPosition(700, 300);

      expect(physicsWorld.queryShape(PROBE, { x: 100, y: 100 })).toEqual([]);
      expect(physicsWorld.queryShape(PROBE, { x: 100, y: 300 })).toEqual([]);
      expect(
        physicsWorld.queryShape(PROBE, { x: 700, y: 100 }).map((e) => e.name),
      ).toEqual(["wall"]);
      expect(
        physicsWorld.queryShape(PROBE, { x: 700, y: 300 }).map((e) => e.name),
      ).toEqual(["crate"]);
      expect(
        physicsWorld.raycast({ x: 700, y: 0 }, DOWN, 400)?.entity.name,
      ).toBe("wall");
    });

    it("moves nothing: a sleeping body stays asleep and a falling one keeps its velocity", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      spawnGround(scene, 0, 300);
      const resting = spawnBox(scene, "resting", 0, 280);
      step(physicsWorld, 400);
      const restingBody = physicsWorld.getBody(resting.rb._bodyHandle)!;
      expect(restingBody.isSleeping()).toBe(true);
      const falling = spawnBox(scene, "falling", 500, 0);
      falling.rb.setVelocity({ x: 0, y: 500 });
      const before = falling.rb.position;

      spawnStaticBox(scene, "wall", 900, 900);
      physicsWorld.queryShape(PROBE, { x: 900, y: 900 });

      expect(restingBody.isSleeping()).toBe(true);
      expect(falling.rb.velocityY).toBeCloseTo(500);
      expect(falling.rb.position.y).toBe(before.y);
    });

    it("keeps a kinematic body's pending Transform write for the next real step", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene, physicsWorld } = ctx;
      const { tick } = systemsFor(ctx);
      const platform = spawnBody(scene, "platform", 100, 100, "kinematic", {
        shape: { type: "box", width: 40, height: 10 },
      });
      tick(2);

      platform.transform.setPosition(200, 100);
      spawnStaticBox(scene, "wall", 900, 900);
      physicsWorld.queryShape(PROBE, { x: 900, y: 900 });

      expect(platform.rb.position.x).toBeCloseTo(100);
      tick(1);
      expect(platform.rb.position.x).toBeCloseTo(200);
    });

    it("keeps a one-way rider supported across a query", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene, physicsWorld } = ctx;
      spawnGround(scene, 0, 300, { oneWay: {} });
      const rider = spawnBox(scene, "rider", 0, 100);
      step(physicsWorld, 150);
      expect(rider.rb.position.y).toBeCloseTo(280, 0);

      spawnStaticBox(scene, "wall", 900, 900);
      physicsWorld.queryShape(PROBE, { x: 900, y: 900 });
      expect(rider.rb.position.y).toBeCloseTo(280, 0);
      step(physicsWorld, 60);

      expect(rider.rb.position.y).toBeCloseTo(280, 0);
    });

    it("rejects a negative or non-finite step", async () => {
      const { physicsWorld } = await createPhysicsTestContext();
      expect(() => physicsWorld.step(-1)).toThrow(
        "PhysicsWorld.step: dt must be finite and >= 0, got -1.",
      );
      expect(() => physicsWorld.step(NaN)).toThrow(
        "PhysicsWorld.step: dt must be finite and >= 0, got NaN.",
      );
    });
  });

  describe("Transform channel", () => {
    it.each(["static", "dynamic", "kinematic"] as const)(
      "refreshes queries after component-only %s activation teleports",
      async (type) => {
        const { scene, physicsWorld } = await createPhysicsTestContext({
          gravity: { x: 0, y: 0 },
        });
        const wall = spawnBody(scene, "wall", 100, 100, type, {
          shape: { type: "box", width: 80, height: 10 },
        });
        step(physicsWorld, 1);
        const elapsed = physicsWorld.elapsed;

        wall.rb.enabled = false;
        wall.transform.setPosition(300, 120);
        wall.rb.enabled = true;

        expect(physicsWorld.queryShape(PROBE, { x: 330, y: 120 })).toEqual([
          wall.entity,
        ]);
        expect(physicsWorld.queryShape(PROBE, { x: 100, y: 100 })).toEqual([]);

        wall.rb.enabled = false;
        wall.transform.rotation = Math.PI / 2;
        wall.rb.enabled = true;

        expect(physicsWorld.queryShape(PROBE, { x: 300, y: 150 })).toEqual([
          wall.entity,
        ]);
        expect(physicsWorld.queryShape(PROBE, { x: 330, y: 120 })).toEqual([]);
        expect(physicsWorld.elapsed).toBe(elapsed);
      },
    );

    it.each(["static", "dynamic", "kinematic"] as const)(
      "places a dormant %s body and its collider at the written pose on activation",
      async (type) => {
        const ctx = await createPhysicsTestContext({ gravity: { x: 0, y: 0 } });
        const { scene, physicsWorld } = ctx;
        const entity = spawnEntityInScene(scene, "parked");
        entity.setActive(false);
        const transform = entity.add(new Transform());
        const rb = entity.add(new RigidBodyComponent({ type }));
        entity.add(
          new ColliderComponent({
            shape: { type: "box", width: 80, height: 10 },
          }),
        );
        transform.setPosition(300, 120);
        transform.rotation = Math.PI / 2;
        expect(physicsWorld.queryShape(PROBE, { x: 300, y: 150 })).toEqual([]);

        entity.setActive(true);

        expect(rb.positionX).toBeCloseTo(300);
        expect(rb.positionY).toBeCloseTo(120);
        expect(rb.rotation).toBeCloseTo(Math.PI / 2);
        expect(physicsWorld.queryShape(PROBE, { x: 300, y: 150 })).toEqual([
          entity,
        ]);
        expect(physicsWorld.queryShape(PROBE, { x: 330, y: 120 })).toEqual([]);
        expect(physicsWorld.queryShape(PROBE, Vec2.ZERO)).toEqual([]);
        systemsFor(ctx).tick(2);
        expect(transform.worldPosition.x).toBeCloseTo(300);
        expect(transform.worldPosition.y).toBeCloseTo(120);
        expect(transform.worldRotation).toBeCloseTo(Math.PI / 2);
      },
    );

    it("places a prewarmed static member from dormant setup and reuses its allocation", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      class Wall extends Entity {
        override setup(): void {
          const transform = this.add(new Transform());
          this.add(new RigidBodyComponent({ type: "static" }));
          this.add(
            new ColliderComponent({
              shape: { type: "box", width: 20, height: 20 },
            }),
          );
          transform.setPosition(300, 120);
        }
        onAcquire(position?: Vec2): void {
          if (position)
            this.get(RigidBodyComponent).setPosition(position.x, position.y);
        }
      }
      const pool = new EntityPool(scene, Wall, { prewarm: 1 });
      expect(physicsWorld.queryShape(PROBE, { x: 300, y: 120 })).toEqual([]);
      const member = pool.acquire();
      const rb = member.get(RigidBodyComponent);
      const handle = rb._bodyHandle;
      expect(rb.positionX).toBeCloseTo(300);
      expect(rb.positionY).toBeCloseTo(120);
      expect(physicsWorld.queryShape(PROBE, { x: 300, y: 120 })).toEqual([
        member,
      ]);

      pool.release(member);
      member.get(Transform).setPosition(500, 240);
      expect(pool.acquire()).toBe(member);
      expect(rb.positionX).toBeCloseTo(500);
      expect(rb.positionY).toBeCloseTo(240);
      expect(physicsWorld.queryShape(PROBE, { x: 300, y: 120 })).toEqual([]);
      expect(physicsWorld.queryShape(PROBE, { x: 500, y: 240 })).toEqual([
        member,
      ]);

      pool.release(member);
      expect(pool.acquire(new Vec2(700, 360))).toBe(member);
      expect(rb._bodyHandle).toBe(handle);
      expect(rb.positionX).toBeCloseTo(700);
      expect(rb.positionY).toBeCloseTo(360);
      expect(member.get(Transform).worldPosition).toEqual(new Vec2(700, 360));
      pool.dispose();
    });

    it("does not adopt an active static Transform write on a later enable", async () => {
      const ctx = await createPhysicsTestContext();
      const wall = spawnStaticBox(ctx.scene, "wall", 100, 100);
      wall.transform.setPosition(300, 120);
      wall.transform.rotation = 0.5;
      systemsFor(ctx).tick(2);
      wall.entity.setActive(false);
      wall.entity.setActive(true);
      expect(wall.rb.positionX).toBeCloseTo(100);
      expect(wall.rb.positionY).toBeCloseTo(100);
      expect(wall.rb.rotation).toBeCloseTo(0);

      wall.entity.setActive(false);
      wall.transform.setPosition(500, 240);
      wall.transform.rotation = 1;
      wall.entity.setActive(true);
      expect(wall.rb.positionX).toBeCloseTo(500);
      expect(wall.rb.positionY).toBeCloseTo(240);
      expect(wall.rb.rotation).toBeCloseTo(1);
    });

    it("adopts a parent's world pose changes while a static child is dormant", async () => {
      const { scene } = await createPhysicsTestContext();
      const parent = spawnEntityInScene(scene, "parent");
      const parentTransform = parent.add(new Transform());
      const wall = spawnStaticBox(scene, "wall", 20, 0);
      parent.addChild("wall", wall.entity);
      parent.setActive(false);
      parentTransform.setPosition(300, 120);
      parentTransform.rotation = Math.PI / 2;
      parent.setActive(true);
      expect(wall.rb.positionX).toBeCloseTo(300);
      expect(wall.rb.positionY).toBeCloseTo(140);
      expect(wall.rb.rotation).toBeCloseTo(Math.PI / 2);
    });

    it.each([true, false])(
      "preserves dormant static body teleports with syncRotation=%s",
      async (syncRotation) => {
        const { scene } = await createPhysicsTestContext();
        const wall = spawnStaticBox(scene, "wall", 100, 100);
        wall.rb.syncRotation = syncRotation;
        wall.entity.setActive(false);
        wall.transform.setPosition(300, 120);
        wall.transform.rotation = 0.5;
        wall.rb.setPosition(500, 240);
        wall.rb.setRotation(1);
        wall.entity.setActive(true);
        wall.entity.setActive(false);
        wall.entity.setActive(true);
        expect(wall.rb.positionX).toBeCloseTo(500);
        expect(wall.rb.positionY).toBeCloseTo(240);
        expect(wall.rb.rotation).toBeCloseTo(1);
      },
    );

    it("moves a static body's Transform with setPosition", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene } = ctx;
      const { tick } = systemsFor(ctx);
      const wall = spawnStaticBox(scene, "wall", 100, 100);

      wall.rb.setPosition(500, 300);
      tick(1);

      expect(wall.transform.worldPosition.x).toBe(500);
      expect(wall.transform.worldPosition.y).toBe(300);
      expect(wall.rb.position.x).toBeCloseTo(500);
    });

    it("teleports a dynamic body to a Transform pose written while dormant", async () => {
      const ctx = await createPhysicsTestContext({ gravity: { x: 0, y: 0 } });
      const { scene } = ctx;
      const { tick } = systemsFor(ctx);
      const crate = spawnBox(scene, "crate", 100, 100);
      crate.rb.setVelocity({ x: -100, y: 0 });
      tick(5);
      expect(crate.rb.position.x).toBeLessThan(100);

      crate.entity.setActive(false);
      crate.transform.setPosition(50, 50);
      crate.entity.setActive(true);
      tick(1);

      expect(crate.rb.position.x).toBeCloseTo(50);
      expect(crate.rb.position.y).toBeCloseTo(50);
      expect(crate.transform.worldPosition.x).toBeCloseTo(50);
      expect(crate.transform.worldPosition.y).toBeCloseTo(50);
    });

    it("still teleports a kinematic body to a dormant Transform write", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene } = ctx;
      const { tick } = systemsFor(ctx);
      const platform = spawnBody(scene, "platform", 100, 100, "kinematic", {
        shape: { type: "box", width: 40, height: 10 },
      });
      tick(1);

      platform.entity.setActive(false);
      platform.transform.setPosition(60, 60);
      platform.entity.setActive(true);

      expect(platform.rb.position.x).toBeCloseTo(60);
      expect(platform.rb.position.y).toBeCloseTo(60);
    });
  });

  it("never warns about masks for a level's worth of default-layer colliders", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { scene } = await createPhysicsTestContext();
    for (let i = 0; i < 3000; i++) {
      spawnStaticBox(
        scene,
        `tile${i}`,
        (i % 60) * 20,
        Math.floor(i / 60) * 20,
        20,
      );
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
