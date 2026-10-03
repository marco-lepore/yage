import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: the contact-filter hook runs inside
// Rapier's solver, so these tests must observe actual solver behavior.
// The `@dimforge/rapier2d` ESM build crashes when hooks are passed to
// `world.step` under vitest's transform (a wasm-bindgen heap issue in that
// loader path), so the factory swaps in `@dimforge/rapier2d-compat` — the
// same library and version, instantiated at runtime — which runs the hook
// path fine in Node.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import { Transform, Vec2, ErrorBoundaryKey } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { ColliderConfig } from "./types.js";

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
  type: "dynamic" | "static" | "kinematic",
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

/** One-way platform: 200×20 box, solid face up. Top surface at y - 10. */
function spawnPlatform(scene: Scene, x: number, y: number): Spawned {
  return spawnBody(scene, "platform", x, y, "static", {
    shape: { type: "box", width: 200, height: 20 },
    oneWay: {},
  });
}

/** 20×20 dynamic box rider. Resting on a platform top puts its center 10 above. */
function spawnRider(scene: Scene, name: string, x: number, y: number): Spawned {
  return spawnBody(scene, name, x, y, "dynamic", {
    shape: { type: "box", width: 20, height: 20 },
  });
}

function bodyY(world: PhysicsWorld, spawned: Spawned): number {
  const body = world.getBody(spawned.rb._bodyHandle);
  if (!body) throw new Error("body missing");
  return world.toPixels(body.translation().y);
}

/** Step like the engine does: integrate, then drain collision events. */
function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    world.step(DT);
    world.processCollisionEvents();
  }
}

describe("one-way platform (real Rapier)", () => {
  it.each([false, true])(
    "lands after a controller replaces arrival velocity (query refresh: %s)",
    async (refreshQueries) => {
      const { scene, physicsWorld, context } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      spawnBody(scene, "platform", 0, 300, "kinematic", {
        shape: { type: "box", width: 200, height: 16 },
        oneWay: {},
      });
      const rider = spawnRider(scene, "rider", 0, 278);
      const system = new PhysicsSystem();
      system._setContext(context);
      rider.rb.setVelocity({ x: 0, y: 600 });
      system.update(DT);
      // Feet entered the top at 292 by 6 px before the pair is tested.
      expect(bodyY(physicsWorld, rider)).toBeCloseTo(288, 2);
      rider.rb.setVelocity({ x: 0, y: 40 });
      if (refreshQueries) {
        spawnPlatform(scene, 500, 300);
        physicsWorld.queryRadius({ x: 0, y: 300 }, 50);
        physicsWorld.step(0);
      }
      for (let i = 0; i < 90; i++) {
        system.update(DT);
        rider.rb.setVelocity({ x: 0, y: 40 });
      }
      expect(bodyY(physicsWorld, rider)).toBeCloseTo(282, 0);
    },
  );

  it("retains arrival when the last and next steps have different durations", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    spawnBody(scene, "platform", 0, 300, "kinematic", {
      shape: { type: "box", width: 200, height: 16 },
      oneWay: {},
    });
    const rider = spawnRider(scene, "rider", 0, 278);
    rider.rb.setVelocity({ x: 0, y: 300 });
    physicsWorld.step(1 / 30);
    physicsWorld.processCollisionEvents();
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(288, 2);
    rider.rb.setVelocity({ x: 0, y: 0 });
    for (let i = 0; i < 180; i++) {
      physicsWorld.step(1 / 120);
      physicsWorld.processCollisionEvents();
    }
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(282, 0);
  });

  it("catches a platform that moved up into a rider and then stopped", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const platform = spawnBody(scene, "platform", 0, 310, "kinematic", {
      shape: { type: "box", width: 200, height: 16 },
      oneWay: {},
    });
    const rider = spawnRider(scene, "rider", 0, 288);
    const body = physicsWorld.getBody(platform.rb._bodyHandle);
    if (!body) throw new Error("platform body missing");
    body.setNextKinematicTranslation({ x: 0, y: physicsWorld.toMeters(300) });
    step(physicsWorld, 1);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(288, 2);
    platform.rb.setVelocity({ x: 0, y: 0 });
    for (let i = 0; i < 90; i++) {
      step(physicsWorld, 1);
      rider.rb.setVelocity({ x: 0, y: 0 });
    }
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(282, 0);
  });

  it("uses scaled compound-part positions for a fast arrival", async () => {
    const { scene, physicsWorld, context } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const platform = spawnBody(scene, "platform", 0, 250, "kinematic", {
      parts: [
        {
          shape: { type: "box", width: 20, height: 16 },
          offset: { x: 200, y: 0 },
        },
        {
          shape: { type: "box", width: 100, height: 8 },
          offset: { x: 0, y: 25 },
        },
      ],
      oneWay: {},
    });
    platform.entity.get(Transform).setScale(2, 2);
    const rider = spawnBody(scene, "rider", 0, 298, "dynamic", {
      parts: [
        {
          shape: { type: "box", width: 20, height: 20 },
          offset: { x: 0, y: -20 },
        },
      ],
    });
    const system = new PhysicsSystem();
    system._setContext(context);
    rider.rb.setVelocity({ x: 0, y: 600 });
    system.update(DT);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(308, 2);
    for (let i = 0; i < 90; i++) {
      rider.rb.setVelocity({ x: 0, y: 40 });
      system.update(DT);
    }
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(302, 0);
  });

  it("does not catch a jump that reverses before clearing the platform", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    spawnBody(scene, "platform", 0, 300, "kinematic", {
      shape: { type: "box", width: 200, height: 16 },
      oneWay: {},
    });
    const rider = spawnRider(scene, "rider", 0, 310);
    rider.rb.setVelocity({ x: 0, y: -600 });
    step(physicsWorld, 2);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(290, 2);
    rider.rb.setVelocity({ x: 0, y: 600 });
    step(physicsWorld, 5);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(330);
  });

  it.each(["teleport", "reshape", "reactivate"] as const)(
    "does not use a previous landing after %s inside the platform",
    async (change) => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      spawnPlatform(scene, 0, 300);
      const rider = spawnRider(scene, "rider", 0, 100);
      step(physicsWorld, 150);
      expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
      if (change === "teleport") {
        rider.rb.setPosition(0, 300);
      } else if (change === "reshape") {
        rider.collider.setShape({ type: "box", width: 20, height: 60 });
      } else {
        rider.entity.setActive(false);
        step(physicsWorld, 2);
        rider.entity.get(Transform).setPosition(0, 300);
        rider.entity.setActive(true);
      }
      rider.rb.setVelocity({ x: 0, y: 40 });
      physicsWorld.queryRadius({ x: 0, y: 300 }, 50);
      step(physicsWorld, 60);
      expect(bodyY(physicsWorld, rider)).toBeGreaterThan(340);
    },
  );

  it("forgets unfiltered contacts before restoring one-way filtering", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnPlatform(scene, 0, 300);
    const filter = platform.collider._contactFilter;
    if (!filter) throw new Error("one-way filter missing");
    platform.collider.setContactFilter(null);
    const rider = spawnRider(scene, "rider", 0, 100);
    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);

    // Ordinary solid contacts do not establish one-way arrival. The rider
    // moved inside while the platform was absent from the filter registry.
    rider.rb.setPosition(0, 300);
    platform.collider.setContactFilter(filter);
    step(physicsWorld, 60);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(340);
  });

  it("does not turn an expired drop-through into an arrival after velocity changes", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    spawnBody(scene, "platform", 0, 300, "kinematic", {
      shape: { type: "box", width: 200, height: 16 },
      oneWay: {},
    });
    const rider = spawnRider(scene, "rider", 0, 282);
    step(physicsWorld, 2);
    rider.collider.dropThrough(DT);
    rider.rb.setVelocity({ x: 0, y: 600 });
    step(physicsWorld, 1);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(292, 1);
    expect(rider.collider.isDroppingThrough).toBe(false);

    rider.rb.setVelocity({ x: 0, y: 40 });
    step(physicsWorld, 90);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(340);
  });

  it("lands a body falling onto the solid side", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    const rider = spawnRider(scene, "rider", 0, 100);

    step(physicsWorld, 150);

    // Platform top at 290, rider half-height 10.
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
    expect(rider.rb.velocityY).toBeCloseTo(0, 1);
  });

  it("lets a body jump through from below, then lands it on the way down", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    const rider = spawnRider(scene, "rider", 0, 500);
    rider.rb.setVelocity({ x: 0, y: -900 });

    let peak = Infinity;
    for (let i = 0; i < 300; i++) {
      step(physicsWorld, 1);
      peak = Math.min(peak, bodyY(physicsWorld, rider));
    }

    // It rose clear through the platform (top at 290, rider bottom clear
    // when its center is above 280)...
    expect(peak).toBeLessThan(250);
    // ...and came back to rest on top instead of falling to where it started.
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
  });

  it("drops one rider through while the other stays supported", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    const dropper = spawnRider(scene, "dropper", -50, 100);
    const stayer = spawnRider(scene, "stayer", 50, 100);

    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, dropper)).toBeCloseTo(280, 0);
    expect(bodyY(physicsWorld, stayer)).toBeCloseTo(280, 0);

    dropper.collider.dropThrough(0.25);
    expect(dropper.collider.isDroppingThrough).toBe(true);
    step(physicsWorld, 60);

    expect(bodyY(physicsWorld, dropper)).toBeGreaterThan(320);
    expect(bodyY(physicsWorld, stayer)).toBeCloseTo(280, 0);
    expect(dropper.collider.isDroppingThrough).toBe(false);
  });

  it("catches a fast faller instead of letting it tunnel", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    // 1000 px/s is ~17px of travel per step — the pair is still detected
    // in the platform's upper half, so no CCD is needed.
    const rider = spawnRider(scene, "rider", 0, 100);
    rider.rb.setVelocity({ x: 0, y: 1000 });

    step(physicsWorld, 150);

    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
  });

  it("catches an extreme faller when the body has ccd, and ccd still honors drop-through", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    // 2000 px/s crosses more than the platform's half-thickness per step;
    // that regime is what Rapier's own continuous collision detection is
    // for, and the CCD sweep consults the contact filter too.
    const rider = spawnBody(
      scene,
      "rider",
      0,
      100,
      "dynamic",
      { shape: { type: "box", width: 20, height: 20 } },
      true,
    );
    rider.rb.setVelocity({ x: 0, y: 2000 });

    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);

    // The CCD sweep must not re-solidify a platform being dropped through.
    rider.collider.dropThrough(0.25);
    step(physicsWorld, 60);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);
  });

  it("supports a body standing on the platform's edge", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    // Half the rider hangs past the platform's right edge (x = 100).
    const rider = spawnRider(scene, "rider", 100, 100);

    step(physicsWorld, 150);

    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
  });

  it("releases a body already overlapping the platform instead of snapping it up", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    // Spawned dead center inside the platform.
    const rider = spawnRider(scene, "rider", 0, 300);

    step(physicsWorld, 90);

    // It must fall out the passable side, not teleport on top.
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);
  });

  it("gives a one-timestep drop-through its full window", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnPlatform(scene, 0, 300);
    const rider = spawnRider(scene, "rider", 0, 100);
    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);

    // A window of exactly one step must suppress the contact for that
    // step — observable as a contact end (and later restart) on the
    // platform. The rider barely moves in 1/60s, so position alone can't
    // show it.
    const events: boolean[] = [];
    platform.collider.onCollision((ev) => events.push(ev.started));

    rider.collider.dropThrough(DT);
    step(physicsWorld, 5);

    expect(events).toContain(false);
  });

  it("is solid again after the drop-through window expires", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnPlatform(scene, 0, 300);
    const rider = spawnRider(scene, "rider", 0, 100);

    step(physicsWorld, 150);
    rider.collider.dropThrough(0.2);
    step(physicsWorld, 90);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);

    // Back above the platform after the window ended: it lands again.
    rider.rb.setPosition(0, 100);
    rider.rb.setVelocity({ x: 0, y: 0 });
    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
  });
});

describe("contact filter primitive (real Rapier)", () => {
  it("passes the pair while the filter returns false, and reads candidate data", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnBody(scene, "platform", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 20 },
    });
    const rider = spawnRider(scene, "rider", 0, 100);

    let calls = 0;
    let sawOther: Entity | undefined;
    let sawVelocityY = 0;
    platform.collider.setContactFilter((contact) => {
      calls++;
      sawOther = contact.other;
      sawVelocityY = contact.otherVelocityY;
      return false;
    });

    step(physicsWorld, 90);

    expect(calls).toBeGreaterThan(0);
    expect(sawOther).toBe(rider.entity);
    // The rider was falling when the pair was tested.
    expect(sawVelocityY).toBeGreaterThan(0);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);
  });

  it("turns solid again when the filter is cleared", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnBody(scene, "platform", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 20 },
    });
    const rider = spawnRider(scene, "rider", 0, 100);

    platform.collider.setContactFilter(() => false);
    step(physicsWorld, 90);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);

    platform.collider.setContactFilter(null);
    rider.rb.setPosition(0, 100);
    rider.rb.setVelocity({ x: 0, y: 0 });
    step(physicsWorld, 150);
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
  });

  it("needs both sides' filters to agree for the pair to be solid", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const platform = spawnBody(scene, "platform", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 20 },
    });
    const rider = spawnRider(scene, "rider", 0, 100);

    platform.collider.setContactFilter(() => true);
    rider.collider.setContactFilter(() => false);

    step(physicsWorld, 90);
    expect(bodyY(physicsWorld, rider)).toBeGreaterThan(320);
  });

  it("reports a throwing filter and keeps the pair solid", async () => {
    const { scene, physicsWorld, context } = await createPhysicsTestContext();
    const platform = spawnBody(scene, "platform", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 20 },
    });
    const rider = spawnRider(scene, "rider", 0, 100);

    platform.collider.setContactFilter(() => {
      throw new Error("filter boom");
    });

    step(physicsWorld, 150);

    // Conservative fallback: the rider landed anyway. The failure is
    // reported exactly once, not per pair per step.
    expect(bodyY(physicsWorld, rider)).toBeCloseTo(280, 0);
    const boundary = context.resolve(ErrorBoundaryKey);
    const recorded = boundary.getCallbackErrors();
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.kind).toBe("Contact filter");
  });
});
