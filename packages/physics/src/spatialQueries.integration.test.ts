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

import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
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
  extra: Partial<ColliderConfig> = {},
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
