import { describe, expect, it, vi } from "vitest";

// Real physics, not the usual mocks. Vitest uses the compat build because the
// ESM build cannot receive physics hooks through its transformed WASM module.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import { Transform } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { ColliderComponent } from "./ColliderComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

function addCollider(
  scene: Scene,
  config: ConstructorParameters<typeof ColliderComponent>[0],
  transformConfig?: ConstructorParameters<typeof Transform>[0],
): {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
} {
  const entity = spawnEntityInScene(scene, "shape-offset");
  entity.add(new Transform(transformConfig));
  const rb = entity.add(
    new RigidBodyComponent({ type: "dynamic", fixedRotation: true }),
  );
  const collider = entity.add(new ColliderComponent(config));
  return { entity, rb, collider };
}

function rawPart(world: PhysicsWorld, collider: ColliderComponent, index = 0) {
  const raw = world.getCollider(collider._colliderHandles[index] as number);
  if (!raw) throw new Error(`Missing collider part ${index}.`);
  return raw;
}

function localPixels(
  world: PhysicsWorld,
  collider: ColliderComponent,
  index = 0,
): { x: number; y: number } {
  const translation = rawPart(world, collider, index).translationWrtParent();
  if (!translation) throw new Error(`Missing translation for part ${index}.`);
  return {
    x: translation.x * world.pixelsPerMeter,
    y: translation.y * world.pixelsPerMeter,
  };
}

function expectLocalPixels(
  world: PhysicsWorld,
  collider: ColliderComponent,
  expected: { x: number; y: number },
  index = 0,
): void {
  const actual = localPixels(world, collider, index);
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}

describe("setShape offset (real Rapier)", () => {
  it("keeps rounded standing and crouched shapes anchored at the feet and updates queries immediately", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { rb, collider } = addCollider(
      scene,
      {
        shape: {
          type: "box",
          width: 24,
          height: 48,
          borderRadius: 4,
        },
        offset: { x: 0, y: -24 },
      },
      { position: { x: 100, y: 100 } },
    );
    const initialMass = rb.getMass();

    expect(
      physicsWorld.queryShape({ type: "circle", radius: 1 }, { x: 100, y: 60 }),
    ).toContain(collider.entity);

    collider.setShape(
      { type: "box", width: 24, height: 24, borderRadius: 4 },
      { offset: { x: 0, y: -12 } },
    );

    expect(rb.position).toEqual({ x: 100, y: 100 });
    expect(localPixels(physicsWorld, collider).y).toBeCloseTo(-12);
    expect(
      physicsWorld.queryShape({ type: "circle", radius: 1 }, { x: 100, y: 60 }),
    ).not.toContain(collider.entity);
    expect(
      physicsWorld.queryShape({ type: "circle", radius: 1 }, { x: 100, y: 99 }),
    ).toContain(collider.entity);
    expect(rb.getMass()).toBeCloseTo(initialMass);

    collider.setShape(
      { type: "box", width: 24, height: 24, borderRadius: 4 },
      { offset: { x: 0, y: -12 }, recomputeMass: true },
    );
    expect(rb.getMass()).toBeLessThan(initialMass);

    collider.setShape(
      { type: "box", width: 24, height: 48, borderRadius: 4 },
      { offset: { x: 0, y: -24 }, recomputeMass: true },
    );
    expect(rb.getMass()).toBeCloseTo(initialMass);
  });

  it("changes only the selected compound part", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { collider } = addCollider(scene, {
      parts: [
        {
          shape: { type: "box", width: 20, height: 10 },
          offset: { x: -15, y: 0 },
        },
        {
          shape: { type: "circle", radius: 5 },
          offset: { x: 15, y: 0 },
          rotation: 0.25,
        },
      ],
    });
    const firstShape = rawPart(physicsWorld, collider, 0).shape;
    const firstTranslation = localPixels(physicsWorld, collider, 0);

    collider.setShape(
      { type: "box", width: 12, height: 8 },
      { index: 1, offset: { x: 25, y: -6 } },
    );

    expect(rawPart(physicsWorld, collider, 0).shape).toBe(firstShape);
    expect(localPixels(physicsWorld, collider, 0)).toEqual(firstTranslation);
    expect(rawPart(physicsWorld, collider, 1).halfExtents().x).toBeCloseTo(
      0.12,
    );
    expect(rawPart(physicsWorld, collider, 1).halfExtents().y).toBeCloseTo(
      0.08,
    );
    expectLocalPixels(physicsWorld, collider, { x: 25, y: -6 }, 1);
    expect(collider._part(1)).toEqual({
      shape: { type: "box", width: 12, height: 8 },
      offset: { x: 25, y: -6 },
      rotation: 0.25,
    });
  });

  it("applies authored offsets through uniform and mirrored non-uniform scale", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const uniform = addCollider(
      scene,
      { shape: { type: "box", width: 10, height: 10 } },
      { scale: { x: 2, y: 2 } },
    ).collider;

    uniform.setShape(
      { type: "box", width: 14, height: 8 },
      { offset: { x: 4, y: -5 } },
    );

    expect(rawPart(physicsWorld, uniform).halfExtents().x).toBeCloseTo(0.28);
    expect(rawPart(physicsWorld, uniform).halfExtents().y).toBeCloseTo(0.16);
    expectLocalPixels(physicsWorld, uniform, { x: 8, y: -10 });

    const mirrored = addCollider(
      scene,
      { shape: { type: "box", width: 10, height: 10 } },
      { scale: { x: -2, y: 3 } },
    ).collider;
    mirrored.setShape(
      { type: "box", width: 10, height: 20 },
      { offset: { x: 4, y: -5 } },
    );

    const raw = rawPart(physicsWorld, mirrored);
    const vertices = Array.from(raw.vertices());
    const xs = vertices.filter((_, index) => index % 2 === 0);
    const ys = vertices.filter((_, index) => index % 2 === 1);
    expectLocalPixels(physicsWorld, mirrored, { x: 0, y: 0 });
    expect(Math.min(...xs) * physicsWorld.pixelsPerMeter).toBeCloseTo(-18);
    expect(Math.max(...xs) * physicsWorld.pixelsPerMeter).toBeCloseTo(2);
    expect(Math.min(...ys) * physicsWorld.pixelsPerMeter).toBeCloseTo(-45);
    expect(Math.max(...ys) * physicsWorld.pixelsPerMeter).toBeCloseTo(15);
  });

  it("copies pre-add offsets, preserves omitted offsets, and resets explicitly", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const entity = spawnEntityInScene(scene, "pre-add");
    entity.add(new Transform());
    entity.add(new RigidBodyComponent({ type: "dynamic" }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: 20, height: 40 },
      offset: { x: 3, y: -20 },
    });
    const supplied = { x: 5, y: -10 };

    collider.setShape(
      { type: "box", width: 20, height: 20 },
      { offset: supplied },
    );
    supplied.x = 500;
    supplied.y = 500;
    collider.setShape({ type: "box", width: 18, height: 18 });
    entity.add(collider);

    expect(collider._part(0).offset).toEqual({ x: 5, y: -10 });
    expectLocalPixels(physicsWorld, collider, { x: 5, y: -10 });

    collider.setShape(
      { type: "box", width: 16, height: 16 },
      { offset: { x: 0, y: 0 } },
    );
    expect(collider._part(0).offset).toEqual({ x: 0, y: 0 });
    expectLocalPixels(physicsWorld, collider, { x: 0, y: 0 });
  });

  it("updates dormant geometry without enabling the collider", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { entity, collider } = addCollider(scene, {
      shape: { type: "box", width: 20, height: 40 },
    });
    entity.setActive(false);

    collider.setShape(
      { type: "box", width: 20, height: 20 },
      { offset: { x: 2, y: -10 } },
    );

    const raw = rawPart(physicsWorld, collider);
    expect(raw.isEnabled()).toBe(false);
    expect(raw.halfExtents().y).toBeCloseTo(0.2);
    expectLocalPixels(physicsWorld, collider, { x: 2, y: -10 });
    entity.setActive(true);
    expect(raw.isEnabled()).toBe(true);
  });

  it("rejects invalid offsets and indices before changing authored, effective, or live state", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { collider } = addCollider(scene, {
      shape: { type: "box", width: 20, height: 40 },
      offset: { x: 1, y: -20 },
    });
    const raw = rawPart(physicsWorld, collider);
    const shapeBefore = raw.shape;
    const effectiveBefore = collider._effectivePart(0);

    expect(() =>
      collider.setShape(
        { type: "box", width: 20, height: 20 },
        { offset: { x: undefined, y: 0 } as never },
      ),
    ).toThrow(
      "ColliderComponent.setShape: offset.x must be finite, got undefined.",
    );
    expect(() =>
      collider.setShape(
        { type: "box", width: 20, height: 20 },
        { offset: { x: 0, y: Number.NaN } },
      ),
    ).toThrow("ColliderComponent.setShape: offset.y must be finite, got NaN.");
    expect(() =>
      collider.setShape(
        { type: "box", width: 20, height: 20 },
        { index: 1, offset: { x: 2, y: -10 } },
      ),
    ).toThrow(
      "ColliderComponent.setShape: index must name an existing collider shape, got 1.",
    );

    expect(collider._part(0)).toEqual({
      shape: { type: "box", width: 20, height: 40 },
      offset: { x: 1, y: -20 },
    });
    expect(collider._effectivePart(0)).toBe(effectiveBefore);
    expect(raw.shape).toBe(shapeBefore);
    expectLocalPixels(physicsWorld, collider, { x: 1, y: -20 });
  });

  it("rejects a scaled offset overflow before changing authored, effective, or live state", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { collider } = addCollider(
      scene,
      {
        shape: { type: "box", width: 1e-150, height: 1e-150 },
        offset: { x: 0, y: 0 },
      },
      { scale: { x: 1e154, y: 1e154 } },
    );
    const raw = rawPart(physicsWorld, collider);
    const shapeBefore = raw.shape;
    const effectiveBefore = collider._effectivePart(0);

    expect(() =>
      collider.setShape(
        { type: "box", width: 1e-150, height: 1e-150 },
        { offset: { x: 1e155, y: 0 } },
      ),
    ).toThrow(
      "ColliderComponent.setShape after Transform.worldScale: offset.x must be finite, got Infinity.",
    );

    expect(collider._part(0).offset).toEqual({ x: 0, y: 0 });
    expect(collider._effectivePart(0)).toBe(effectiveBefore);
    expect(raw.shape).toBe(shapeBefore);
    expectLocalPixels(physicsWorld, collider, { x: 0, y: 0 });
  });

  it("rejects a pre-add offset that overflows at the entity's initial scale", async () => {
    const { scene } = await createPhysicsTestContext();
    const entity = spawnEntityInScene(scene, "pre-add-overflow");
    entity.add(new Transform({ scale: { x: 1e154, y: 1e154 } }));
    entity.add(new RigidBodyComponent({ type: "dynamic" }));
    const collider = new ColliderComponent({
      shape: { type: "box", width: 1e-150, height: 1e-150 },
    });
    collider.setShape(
      { type: "box", width: 1e-150, height: 1e-150 },
      { offset: { x: 1e155, y: 0 } },
    );

    expect(() => entity.add(collider)).toThrow(
      "ColliderComponent after Transform.worldScale: offset.x must be finite, got Infinity.",
    );
    expect(collider._colliderHandles).toEqual([]);
  });

  it("rejects every retry of an overflowing Transform scale before changing live geometry", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const { collider, entity } = addCollider(scene, {
      shape: { type: "box", width: 20, height: 20 },
      offset: { x: 1, y: 0 },
    });
    const transform = entity.get(Transform);
    const raw = rawPart(physicsWorld, collider);
    const shapeBefore = raw.shape;

    transform.setScale(1e308, 1e308);
    expect(() => collider._syncScale()).toThrow(
      "ColliderComponent after Transform.worldScale: shape.width must be finite and > 0, got Infinity.",
    );
    expect(() => collider._syncScale()).toThrow(
      "ColliderComponent after Transform.worldScale: shape.width must be finite and > 0, got Infinity.",
    );
    expect(raw.shape).toBe(shapeBefore);
    expectLocalPixels(physicsWorld, collider, { x: 1, y: 0 });

    transform.setScale(2, 2);
    expect(() => collider._syncScale()).not.toThrow();
    expect(raw.halfExtents().x).toBeCloseTo(0.4);
    expectLocalPixels(physicsWorld, collider, { x: 2, y: 0 });
  });
});
