import { describe, it, expect, vi } from "vitest";

// Real physics: these tests read the geometry Rapier reports for a collider
// pair. The `@dimforge/rapier2d` ESM build crashes when hooks are passed to
// `world.step` under vitest's transform, so the factory swaps in
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
import type { ColliderConfig, ColliderContact } from "./types.js";

function spawnCollider(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  config: ColliderConfig,
  rotation = 0,
): ColliderComponent {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(x, y), rotation }));
  entity.add(new RigidBodyComponent({ type: "kinematic" }));
  return entity.add(new ColliderComponent(config));
}

function expectFinite(contact: ColliderContact | undefined): ColliderContact {
  expect(contact).toBeDefined();
  const c = contact!;
  for (const n of [
    c.point.x,
    c.point.y,
    c.otherPoint.x,
    c.otherPoint.y,
    c.normal.x,
    c.normal.y,
    c.distance,
  ]) {
    expect(Number.isFinite(n)).toBe(true);
  }
  expect(c.normal.length()).toBeCloseTo(1, 5);
  return c;
}

const BOX = { type: "box", width: 20, height: 20 } as const;

describe("ColliderComponent.contactWith", () => {
  it("reports the surface points and the outward normal of a separated pair", async () => {
    const { scene } = await createPhysicsTestContext();
    const a = spawnCollider(scene, "a", 0, 0, { shape: BOX });
    const b = spawnCollider(scene, "b", 30, 0, { shape: BOX });

    expect(a.contactWith(b)).toBeUndefined(); // 10px apart, prediction 0
    const contact = expectFinite(a.contactWith(b, { prediction: 15 }));
    expect(contact.distance).toBeCloseTo(10, 4);
    expect(contact.point.x).toBeCloseTo(10, 4);
    expect(contact.otherPoint.x).toBeCloseTo(20, 4);
    expect(contact.normal.x).toBeCloseTo(1, 5);
    expect(contact.normal.y).toBeCloseTo(0, 5);
  });

  it("reports the penetration of an overlapping sensor pair, seen from either side", async () => {
    const { scene } = await createPhysicsTestContext();
    const sensor = spawnCollider(scene, "sensor", 0, 0, {
      shape: BOX,
      sensor: true,
    });
    const body = spawnCollider(scene, "body", 15, 0, { shape: BOX });

    const fromSensor = expectFinite(sensor.contactWith(body));
    expect(fromSensor.distance).toBeCloseTo(-5, 4);
    expect(fromSensor.normal.x).toBeCloseTo(1, 5);
    expect(fromSensor.point.x).toBeCloseTo(10, 4); // sensor's right face
    expect(fromSensor.otherPoint.x).toBeCloseTo(5, 4); // body's left face

    const fromBody = expectFinite(body.contactWith(sensor));
    expect(fromBody.distance).toBeCloseTo(-5, 4);
    expect(fromBody.normal.x).toBeCloseTo(-1, 5);
    expect(fromBody.point.x).toBeCloseTo(5, 4);
    expect(fromBody.otherPoint.x).toBeCloseTo(10, 4);
  });

  it("measures from the collider's offset and rotated pose, not the body origin", async () => {
    const { scene } = await createPhysicsTestContext();
    // A 20×20 box offset 30px along the body's local +x, with the body
    // rotated 180°: the shape sits at world x = -30.
    const swung = spawnCollider(
      scene,
      "swung",
      0,
      0,
      { shape: BOX, offset: { x: 30, y: 0 }, sensor: true },
      Math.PI,
    );
    const target = spawnCollider(scene, "target", -45, 0, { shape: BOX });

    const contact = expectFinite(swung.contactWith(target));
    expect(contact.distance).toBeCloseTo(-5, 4);
    expect(contact.normal.x).toBeCloseTo(-1, 5);
    expect(contact.otherPoint.x).toBeCloseTo(-35, 4); // target's right face
  });

  it("answers for a shape fully inside another and for coincident shapes", async () => {
    const { scene } = await createPhysicsTestContext();
    const big = spawnCollider(scene, "big", 0, 0, {
      shape: { type: "box", width: 100, height: 100 },
      sensor: true,
    });
    const small = spawnCollider(scene, "small", 30, 0, {
      shape: { type: "circle", radius: 5 },
    });
    const inside = expectFinite(big.contactWith(small));
    expect(inside.distance).toBeLessThan(0);
    expect(inside.normal.x).toBeCloseTo(1, 5); // shortest way out: +x
    expect(inside.point.x).toBeCloseTo(50, 4);

    const twin = spawnCollider(scene, "twin", 0, 0, {
      shape: { type: "box", width: 100, height: 100 },
    });
    expectFinite(big.contactWith(twin));
  });

  it("measures the named shape pair of compound colliders, or the closest pair by default", async () => {
    const { scene } = await createPhysicsTestContext();
    const head = { type: "circle", radius: 10 } as const;
    const target = spawnCollider(scene, "target", 0, 0, {
      parts: [
        { shape: BOX }, // body at the origin
        { shape: head, offset: { x: 0, y: -40 } }, // head 40px up
      ],
    });
    const probe = spawnCollider(scene, "probe", 0, -55, {
      shape: BOX,
      sensor: true,
    });

    const named = expectFinite(
      probe.contactWith(target, { selfShapeIndex: 0, otherShapeIndex: 1 }),
    );
    expect(named.distance).toBeCloseTo(-5, 4); // probe bottom at -45, head top at -50
    expect(named.otherPoint.y).toBeCloseTo(-50, 4);

    expect(
      probe.contactWith(target, { selfShapeIndex: 0, otherShapeIndex: 0 }),
    ).toBeUndefined(); // 35px from the body, beyond prediction 0

    const closest = expectFinite(
      probe.contactWith(target, { prediction: 100 }),
    );
    expect(closest.distance).toBeCloseTo(-5, 4);

    expect(() =>
      probe.contactWith(target, { selfShapeIndex: 0, otherShapeIndex: 5 }),
    ).toThrow(
      "ColliderComponent.contactWith: otherShapeIndex must be an integer in [0, 2), got 5.",
    );
    expect(() => probe.contactWith(target, { selfShapeIndex: 1 })).toThrow(
      "ColliderComponent.contactWith: selfShapeIndex must be an integer in [0, 1), got 1.",
    );
  });

  it("rejects a collider from another scene's physics world", async () => {
    const { scene } = await createPhysicsTestContext();
    const here = spawnCollider(scene, "here", 0, 0, { shape: BOX });
    const elsewhere = await createPhysicsTestContext();
    const there = spawnCollider(elsewhere.scene, "there", 0, 0, { shape: BOX });
    expect(() => here.contactWith(there)).toThrow(
      "ColliderComponent.contactWith: other belongs to a different physics world (scene).",
    );
  });

  it("returns undefined before the collider is added and rejects a bad prediction", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const live = spawnCollider(scene, "live", 0, 0, { shape: BOX });
    const detached = new ColliderComponent({ shape: BOX });
    expect(detached.contactWith(live)).toBeUndefined();
    expect(live.contactWith(detached)).toBeUndefined();
    expect(() => live.contactWith(live, { prediction: -1 })).toThrow(
      "PhysicsWorld.contactBetween: prediction must be finite and >= 0, got -1.",
    );
    expect(physicsWorld.contactBetween(999, 998)).toBeUndefined();
  });
});
