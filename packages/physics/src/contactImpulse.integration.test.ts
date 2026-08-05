import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: contactImpulse comes from the solver's
// manifolds, so these tests must observe actual solver output. The
// `@dimforge/rapier2d` ESM build crashes under vitest's transform (a
// wasm-bindgen heap issue in that loader path), so the factory swaps in
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
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { ColliderConfig, CollisionEvent } from "./types.js";

const DT = 1 / 60;

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: "dynamic" | "static",
  collider: ColliderConfig,
): { rb: RigidBodyComponent; collider: ColliderComponent } {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation: true }));
  const col = entity.add(new ColliderComponent(collider));
  return { rb, collider: col };
}

/** Step like the engine does: integrate, then drain collision events. */
function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    world.step(DT);
    world.processCollisionEvents();
  }
}

describe("contactImpulse (real Rapier)", () => {
  it("reports mass × approach speed for a straight drop onto a static box", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    spawnBody(scene, "ground", 0, 300, "static", {
      shape: { type: "box", width: 200, height: 20 },
    });
    const box = spawnBody(scene, "box", 0, 240, "dynamic", {
      shape: { type: "box", width: 20, height: 20 },
    });
    const speed = 600;
    box.rb.setVelocity({ x: 0, y: speed });

    const events: CollisionEvent[] = [];
    box.collider.onCollision((e) => {
      if (e.started) events.push(e);
    });
    step(physicsWorld, 30);

    // Zero gravity and zero restitution: stopping the box takes exactly
    // mass × approach speed, in pixel impulse units.
    expect(events).toHaveLength(1);
    const impulse = events[0]!.contactImpulse;
    const expected = box.rb.getMass() * speed;
    expect(impulse).toBeDefined();
    expect(impulse!).toBeGreaterThan(expected * 0.85);
    expect(impulse!).toBeLessThan(expected * 1.3);
  });

  it("sums the impulse across every manifold of a polyline landing", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    // Six 20px segments; a 50px-wide box lands across several of them, and
    // Rapier solves one manifold per touched segment. A read of a single
    // manifold would report only that segment's share of the impulse.
    const vertices: { x: number; y: number }[] = [];
    for (let x = -60; x <= 60; x += 20) {
      vertices.push({ x, y: 0 });
    }
    spawnBody(scene, "ground", 0, 290, "static", {
      shape: { type: "polyline", vertices },
    });
    const box = spawnBody(scene, "box", 0, 240, "dynamic", {
      shape: { type: "box", width: 50, height: 20 },
    });
    const speed = 600;
    box.rb.setVelocity({ x: 0, y: speed });

    const events: CollisionEvent[] = [];
    box.collider.onCollision((e) => {
      if (e.started) events.push(e);
    });
    step(physicsWorld, 30);

    expect(events).toHaveLength(1);
    const impulse = events[0]!.contactImpulse;
    const expected = box.rb.getMass() * speed;
    expect(impulse).toBeDefined();
    expect(impulse!).toBeGreaterThan(expected * 0.7);
    expect(impulse!).toBeLessThan(expected * 1.5);
  });
});
