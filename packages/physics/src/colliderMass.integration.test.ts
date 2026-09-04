import { describe, it, expect, vi } from "vitest";

// Real physics: the mass a rounded box gets is Rapier's to compute, and the
// density factor that corrects it has to be checked against the real
// library. The `@dimforge/rapier2d` ESM build crashes when hooks are passed
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
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

function spawnBox(
  scene: Scene,
  borderRadius: number,
  density?: number,
): { rb: RigidBodyComponent; collider: ColliderComponent } {
  const entity = spawnEntityInScene(scene, "box");
  entity.add(new Transform({ position: new Vec2(0, 0) }));
  const rb = entity.add(
    new RigidBodyComponent({ type: "dynamic", fixedRotation: true }),
  );
  const collider = entity.add(
    new ColliderComponent({
      shape: { type: "box", width: 20, height: 20, borderRadius },
      ...(density === undefined ? {} : { density }),
    }),
  );
  return { rb, collider };
}

describe("rounded-box mass (real Rapier)", () => {
  it("sums the mass of every collider part on one body", async () => {
    const { scene } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const entity = spawnEntityInScene(scene, "compound");
    entity.add(new Transform());
    const rb = entity.add(
      new RigidBodyComponent({ type: "dynamic", fixedRotation: true }),
    );
    entity.add(
      new ColliderComponent({
        parts: [
          { shape: { type: "box", width: 20, height: 20 } },
          { shape: { type: "circle", radius: 10 } },
        ],
      }),
    );

    // 0.4m square plus a circle with a 0.2m radius, both at density 1.
    expect(rb.getMass()).toBeCloseTo(0.16 + Math.PI * 0.2 ** 2, 5);
  });

  // 20×20 px at 50 px/m and density 1: 0.4 m × 0.4 m = 0.16. Rounding takes
  // off the four corner pieces, (4 − π) r² in pixels, and nothing else.
  it.each([
    [0, 0.16],
    [1, 0.15966],
    [5, 0.15142],
    [9.99, 0.12573],
  ])("weighs a 20×20 box with borderRadius %s at %s", async (r, mass) => {
    const { scene } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { rb } = spawnBox(scene, r);

    expect(rb.getMass()).toBeCloseTo(mass, 5);
  });

  it("gives the same impulse nearly the same speed on a rounded box", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const plain = spawnBox(scene, 0);
    const rounded = spawnBox(scene, 5);
    rounded.rb.setPosition(100, 0);

    plain.rb.applyImpulse({ x: 100, y: 0 });
    rounded.rb.applyImpulse({ x: 100, y: 0 });
    physicsWorld.step(DT);

    expect(plain.rb.velocityX).toBeCloseTo(625, 1);
    // The rounded footprint is smaller, so the box is slightly lighter.
    expect(rounded.rb.velocityX).toBeCloseTo(660.4, 1);
  });

  it("keeps density meaning what it says across setShape, with and without recomputeMass", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { rb, collider } = spawnBox(scene, 5, 2);
    expect(rb.getMass()).toBeCloseTo(0.30283, 5);

    collider.setShape({ type: "box", width: 40, height: 40 });
    physicsWorld.step(DT);
    expect(rb.getMass()).toBeCloseTo(0.30283, 5);

    // A plain 40×40 at density 2: 0.8 m × 0.8 m × 2. The rounded-box factor
    // does not carry over to the new shape.
    collider.setShape(
      { type: "box", width: 40, height: 40 },
      { recomputeMass: true },
    );
    physicsWorld.step(DT);
    expect(rb.getMass()).toBeCloseTo(1.28, 5);
  });

  it.each([
    ["before the first step", 0],
    ["while the body is asleep", 200],
  ])("keeps the mass across a plain setShape %s", async (_label, steps) => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { rb, collider } = spawnBox(scene, 0, 2);
    for (let i = 0; i < steps; i++) physicsWorld.step(DT);
    expect(rb.getMass()).toBeCloseTo(0.32, 5);

    collider.setShape({ type: "box", width: 40, height: 40 });
    physicsWorld.step(DT);
    physicsWorld.step(DT);

    expect(rb.getMass()).toBeCloseTo(0.32, 5);
  });
});
