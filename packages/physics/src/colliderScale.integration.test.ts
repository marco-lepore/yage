import { describe, expect, it, vi } from "vitest";

vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const rapier =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await rapier.init();
  return { default: rapier };
});

import { Transform } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

function spawnScaledBox(
  scene: Scene,
  scaleX: number,
  scaleY = scaleX,
): {
  transform: Transform;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
} {
  const entity = spawnEntityInScene(scene, "scaled");
  const transform = entity.add(
    new Transform({ scale: { x: scaleX, y: scaleY } }),
  );
  const rb = entity.add(
    new RigidBodyComponent({ type: "dynamic", fixedRotation: true }),
  );
  const collider = entity.add(
    new ColliderComponent({
      shape: { type: "box", width: 20, height: 20 },
    }),
  );
  return { transform, rb, collider };
}

describe("collider Transform scale (real Rapier)", () => {
  it("creates the reported 20px box at its 3x visible size", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { collider } = spawnScaledBox(scene, 3);
    const raw = physicsWorld.getCollider(collider._colliderHandle)!;

    expect(raw.halfExtents().x * physicsWorld.pixelsPerMeter).toBeCloseTo(30);
    expect(raw.halfExtents().y * physicsWorld.pixelsPerMeter).toBeCloseTo(30);
  });

  it("applies a live scale at the next PhysicsSystem step", async () => {
    const { scene, physicsWorld, context } = await createPhysicsTestContext();
    const { transform, collider } = spawnScaledBox(scene, 1);
    const system = new PhysicsSystem();
    system._setContext(context);

    transform.setScale(2, 2);
    system.update(DT);

    const raw = physicsWorld.getCollider(collider._colliderHandle)!;
    expect(raw.halfExtents().x * physicsWorld.pixelsPerMeter).toBeCloseTo(20);
  });

  it("uses composed parent scale at creation", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const parent = spawnEntityInScene(scene, "parent");
    parent.add(new Transform({ scale: { x: 2, y: 2 } }));
    const child = parent.spawnChild("child");
    child.add(new Transform({ scale: { x: 3, y: 3 } }));
    child.add(new RigidBodyComponent({ type: "static" }));
    const collider = child.add(
      new ColliderComponent({
        shape: { type: "box", width: 20, height: 20 },
      }),
    );

    const raw = physicsWorld.getCollider(collider._colliderHandle)!;
    expect(raw.halfExtents().x * physicsWorld.pixelsPerMeter).toBeCloseTo(60);

    parent.get(Transform).setScale(4, 4);
    collider._syncScale();
    expect(raw.halfExtents().x * physicsWorld.pixelsPerMeter).toBeCloseTo(120);
  });

  it("scales compound offsets with their signed axes", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const entity = spawnEntityInScene(scene, "compound");
    entity.add(new Transform({ scale: { x: -2, y: 3 } }));
    entity.add(new RigidBodyComponent({ type: "static" }));
    const collider = entity.add(
      new ColliderComponent({
        parts: [
          {
            shape: { type: "box", width: 10, height: 10 },
            offset: { x: 5, y: -4 },
          },
          { shape: { type: "circle", radius: 2 } },
        ],
      }),
    );

    const raw = physicsWorld.getCollider(collider._colliderHandles[0]!)!;
    const center = raw.translationWrtParent()!;
    expect(center.x * physicsWorld.pixelsPerMeter).toBeCloseTo(0);
    expect(center.y * physicsWorld.pixelsPerMeter).toBeCloseTo(0);
    const vertices = raw.vertices();
    const xs = Array.from(vertices).filter((_, index) => index % 2 === 0);
    const ys = Array.from(vertices).filter((_, index) => index % 2 === 1);
    expect(Math.min(...xs) * physicsWorld.pixelsPerMeter).toBeCloseTo(-20);
    expect(Math.max(...xs) * physicsWorld.pixelsPerMeter).toBeCloseTo(0);
    expect(Math.min(...ys) * physicsWorld.pixelsPerMeter).toBeCloseTo(-27);
    expect(Math.max(...ys) * physicsWorld.pixelsPerMeter).toBeCloseTo(3);
  });

  it("disables zero-area scale and restores geometry and mass", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { transform, rb, collider } = spawnScaledBox(scene, 2);
    expect(rb.getMass()).toBeCloseTo(0.64, 5);

    transform.setScale(0, 2);
    collider._syncScale();
    expect(
      physicsWorld.getCollider(collider._colliderHandle)!.isEnabled(),
    ).toBe(false);
    expect(rb.getMass()).toBe(0);

    collider.setSensor(true);
    expect(
      physicsWorld.getCollider(collider._colliderHandle)!.isEnabled(),
    ).toBe(false);
    expect(rb.getMass()).toBe(0);

    transform.setScale(3, 3);
    collider._syncScale();
    expect(
      physicsWorld.getCollider(collider._colliderHandle)!.isEnabled(),
    ).toBe(true);
    expect(rb.getMass()).toBeCloseTo(1.44, 5);
  });

  it("rejects non-finite scale before changing Rapier geometry", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { transform, collider } = spawnScaledBox(scene, 2);
    const raw = physicsWorld.getCollider(collider._colliderHandle)!;
    const before = raw.halfExtents().x;

    expect(() => transform.setScale(Number.NaN, 2)).toThrow(
      "Transform.setScale: x must be finite, got NaN.",
    );
    expect(raw.halfExtents().x).toBe(before);
  });

  it("keeps setShape mass unless recomputation is requested", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { rb, collider } = spawnScaledBox(scene, 2);
    expect(rb.getMass()).toBeCloseTo(0.64, 5);

    collider.setShape({ type: "box", width: 40, height: 40 });
    physicsWorld.step(DT);
    expect(rb.getMass()).toBeCloseTo(0.64, 5);

    collider.setShape(
      { type: "box", width: 40, height: 40 },
      { recomputeMass: true },
    );
    expect(rb.getMass()).toBeCloseTo(2.56, 5);
  });
});
