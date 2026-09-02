import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: these tests observe which collision
// events Rapier queues across several steps, and what its narrow phase does
// with a recreated collider. The `@dimforge/rapier2d` ESM build crashes when
// hooks are passed to `world.step` under vitest's transform (a wasm-bindgen
// heap issue in that loader path), so the factory swaps in
// `@dimforge/rapier2d-compat` — the same library and version, instantiated at
// runtime — which runs the hook path fine in Node.
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
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { ColliderConfig, CollisionEvent, TriggerEvent } from "./types.js";

const DT = 1 / 60;

interface Spawned {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
}

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: "dynamic" | "static",
  collider: ColliderConfig,
  ccd = false,
): Spawned {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(
    new RigidBodyComponent({ type, fixedRotation: true, ccd }),
  );
  const col = entity.add(new ColliderComponent(collider));
  return { entity, rb, collider: col };
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

/** 20×20 dynamic box. Resting on the ground top puts its centre 10 above. */
function spawnBox(scene: Scene, name: string, x: number, y: number): Spawned {
  return spawnBody(scene, name, x, y, "dynamic", {
    shape: { type: "box", width: 20, height: 20 },
  });
}

/**
 * Step `steps` times, delivering events once every `perDrain` steps — the
 * cadence `PhysicsSystem` has at time scale `perDrain` — and once more at the
 * end so nothing is left queued.
 */
function stepBatched(world: PhysicsWorld, steps: number, perDrain: number) {
  for (let i = 1; i <= steps; i++) {
    world.step(DT);
    if (i % perDrain === 0) world.processCollisionEvents();
  }
  world.processCollisionEvents();
}

function recordCollisions(collider: ColliderComponent): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  collider.onCollision((e) => events.push(e));
  return events;
}

function recordTriggers(collider: ColliderComponent): TriggerEvent[] {
  const events: TriggerEvent[] = [];
  collider.onTrigger((e) => events.push(e));
  return events;
}

describe("collision events across several steps per delivery (real Rapier)", () => {
  it.each([3, 4])(
    "delivers a landing start once at %i steps per delivery, with contact data",
    async (perDrain) => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      spawnGround(scene, 0, 300);
      const box = spawnBox(scene, "box", 0, 100);
      const events = recordCollisions(box.collider);

      stepBatched(physicsWorld, 150, perDrain);

      expect(events.map((e) => e.started)).toEqual([true]);
      expect(events[0]!.contactNormal).toBeDefined();
      expect(events[0]!.contactNormal!.y).toBeCloseTo(1, 3);
      expect(box.rb.positionY).toBeCloseTo(280, 0);
    },
  );

  it("pairs enter/exit on both sides of a sensor band at 3 steps per delivery", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const band = spawnBody(scene, "band", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 10 },
      sensor: true,
    });
    const bullet = spawnBody(scene, "bullet", 0, 200, "dynamic", {
      shape: { type: "box", width: 4, height: 4 },
    });
    bullet.rb.setVelocity({ x: 0, y: 300 });
    const bulletEvents = recordCollisions(bullet.collider);
    const bandEvents = recordTriggers(band.collider);

    stepBatched(physicsWorld, 60, 3);

    expect(bulletEvents.map((e) => e.started)).toEqual([true, false]);
    expect(bandEvents.map((e) => e.entered)).toEqual([true, false]);
  });

  it("delivers a CCD bullet's wall hit at 2 steps per delivery from every start offset", async () => {
    let starts = 0;
    for (let offset = 0; offset < 15; offset++) {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      spawnBody(scene, "wall", 300, 0, "static", {
        shape: { type: "box", width: 4, height: 200 },
      });
      const bullet = spawnBody(
        scene,
        "bullet",
        offset,
        0,
        "dynamic",
        { shape: { type: "box", width: 4, height: 4 } },
        true,
      );
      bullet.rb.setVelocity({ x: 900, y: 0 });
      const events = recordCollisions(bullet.collider);

      stepBatched(physicsWorld, 60, 2);

      if (events.some((e) => e.started)) starts++;
    }
    expect(starts).toBe(15);
  });

  it("empties a one-way platform's landed set when the rider leaves at 3 steps per delivery", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnGround(scene, 0, 300, { oneWay: {} });
    const rider = spawnBox(scene, "rider", 0, 100);

    stepBatched(physicsWorld, 150, 1);
    expect(platform.collider._oneWayLanded!.size).toBe(1);

    rider.rb.setVelocity({ x: 0, y: -1500 });
    stepBatched(physicsWorld, 60, 3);
    expect(platform.collider._oneWayLanded!.size).toBe(0);

    // A later jump from below passes through, as the platform's rule says.
    rider.rb.setPosition(0, 500);
    rider.rb.setVelocity({ x: 0, y: -900 });
    let peak = Infinity;
    for (let i = 0; i < 300; i++) {
      stepBatched(physicsWorld, 1, 1);
      peak = Math.min(peak, rider.rb.positionY);
    }
    expect(peak).toBeLessThan(250);
  });

  it("lands a rider on a margin-0 platform at 3 steps per delivery", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnGround(scene, 0, 300, { oneWay: { margin: 0 } });
    const rider = spawnBox(scene, "rider", 0, 100);

    stepBatched(physicsWorld, 150, 3);

    expect(rider.rb.positionY).toBeCloseTo(280, 0);
  });

  it("delivers every step's events, with that step's contact data, from one processCollisionEvents call", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnGround(scene, 0, 300);
    // Already touching the ground: the first step starts the contact.
    const box = spawnBox(scene, "box", 0, 280);
    const events = recordCollisions(box.collider);

    physicsWorld.step(DT);
    physicsWorld.step(DT);
    physicsWorld.step(DT);
    expect(events).toHaveLength(0);
    physicsWorld.processCollisionEvents();

    expect(events.map((e) => e.started)).toEqual([true]);
    expect(events[0]!.contactNormal).toBeDefined();
    expect(events[0]!.contactPoint).toBeDefined();
  });
});

describe("setSensor on a live collider (real Rapier)", () => {
  it("flips a resting, awake box to a sensor: it falls through and both sides see the pair end and re-form", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const ground = spawnGround(scene, 0, 300, { oneWay: {} });
    const box = spawnBox(scene, "box", 0, 280);
    box.collider.setContactFilter(() => true);
    stepBatched(physicsWorld, 60, 1);
    const groundEvents = recordCollisions(ground.collider);
    const boxTriggers = recordTriggers(box.collider);
    const oldHandle = box.collider._colliderHandle;
    const massBefore = box.rb.getMass();
    const body = physicsWorld.getBody(box.rb._bodyHandle)!;
    expect(body.isSleeping()).toBe(false);
    expect(ground.collider._oneWayLanded!.has(oldHandle)).toBe(true);

    box.collider.setSensor(true);

    const newHandle = box.collider._colliderHandle;
    expect(newHandle).not.toBe(oldHandle);
    expect(box.rb.getMass()).toBeCloseTo(massBefore, 6);
    expect(physicsWorld.colliderMap.has(oldHandle)).toBe(false);
    expect(physicsWorld._colliderComponents.has(oldHandle)).toBe(false);
    expect(ground.collider._oneWayLanded!.has(oldHandle)).toBe(false);
    expect(physicsWorld.colliderMap.get(newHandle)).toBe(box.entity);
    expect(physicsWorld._colliderComponents.get(newHandle)).toBe(box.collider);
    expect(box.collider._contactFilter).not.toBeNull();
    expect(physicsWorld.getCollider(newHandle)!.activeHooks()).not.toBe(0);

    stepBatched(physicsWorld, 60, 1);

    expect(box.rb.positionY).toBeGreaterThan(320);
    expect(boxTriggers.map((e) => e.entered)).toEqual([false, true, false]);
    expect(groundEvents.map((e) => e.started)).toEqual([false, true, false]);
  });

  it("flips an overlapping, awake sensor box to solid: it is pushed out to rest and its filter runs", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnGround(scene, 0, 300);
    const box = spawnBody(scene, "box", 0, 285, "dynamic", {
      shape: { type: "box", width: 20, height: 20 },
      sensor: true,
    });
    const filter = vi.fn(() => true);
    box.collider.setContactFilter(filter);
    stepBatched(physicsWorld, 5, 1);
    const events = recordCollisions(box.collider);
    expect(filter).not.toHaveBeenCalled();

    box.collider.setSensor(false);
    stepBatched(physicsWorld, 120, 1);

    expect(box.rb.positionY).toBeCloseTo(280, 0);
    expect(events.some((e) => e.started)).toBe(true);
    expect(filter).toHaveBeenCalled();
  });

  it("keeps a collider flipped while its entity is inactive out of the simulation", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnGround(scene, 0, 300);
    const box = spawnBox(scene, "box", 0, 280);
    stepBatched(physicsWorld, 30, 1);
    const massBefore = box.rb.getMass();
    box.entity.setActive(false);

    box.collider.setSensor(true);

    expect(
      physicsWorld.getCollider(box.collider._colliderHandle)!.isEnabled(),
    ).toBe(false);
    box.entity.setActive(true);
    expect(
      physicsWorld.getCollider(box.collider._colliderHandle)!.isEnabled(),
    ).toBe(true);
    // Rapier's re-sum skips a disabled collider, so without the re-sum on
    // enable the body reads 0 until the next step.
    expect(box.rb.getMass()).toBeCloseTo(massBefore, 6);
    stepBatched(physicsWorld, 60, 1);
    expect(box.rb.positionY).toBeGreaterThan(320);
  });
});
