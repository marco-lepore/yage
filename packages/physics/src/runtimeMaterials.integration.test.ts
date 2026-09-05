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
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

function addBody(
  scene: Scene,
  name: string,
): {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
} {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform());
  const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
  const collider = entity.add(
    new ColliderComponent({
      parts: [
        { shape: { type: "box", width: 20, height: 20 } },
        {
          shape: { type: "circle", radius: 5 },
          offset: { x: 15, y: 0 },
        },
      ],
    }),
  );
  return { entity, rb, collider };
}

function collidersOf(world: PhysicsWorld, collider: ColliderComponent) {
  return collider._colliderHandles.map((handle) => {
    const rapierCollider = world.getCollider(handle);
    if (!rapierCollider) throw new Error(`Missing collider ${handle}.`);
    return rapierCollider;
  });
}

function bodyOf(world: PhysicsWorld, rb: RigidBodyComponent) {
  const body = world.getBody(rb._bodyHandle);
  if (!body) throw new Error(`Missing body ${rb._bodyHandle}.`);
  return body;
}

function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) world.step(DT);
}

describe("runtime physics materials (real Rapier)", () => {
  it("applies values set before add when Rapier creates the objects", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const entity = spawnEntityInScene(scene, "pre-add");
    entity.add(new Transform());

    const rb = new RigidBodyComponent({ type: "dynamic" });
    rb.setLinearDamping(3);
    rb.setAngularDamping(4);
    entity.add(rb);

    const collider = new ColliderComponent({
      parts: [
        { shape: { type: "box", width: 20, height: 20 } },
        { shape: { type: "circle", radius: 5 } },
      ],
    });
    collider.setRestitution(1.5);
    collider.setFriction(0.25);
    entity.add(collider);

    const body = bodyOf(physicsWorld, rb);
    expect(body.linearDamping()).toBe(3);
    expect(body.angularDamping()).toBe(4);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.restitution()).toBe(1.5);
      expect(part.friction()).toBe(0.25);
    }
  });

  it("updates a live body and every live collider part", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { rb, collider } = addBody(scene, "live");

    rb.setLinearDamping(6);
    rb.setAngularDamping(7);
    collider.setRestitution(0.8);
    collider.setFriction(0.1);

    const body = bodyOf(physicsWorld, rb);
    expect(body.linearDamping()).toBe(6);
    expect(body.angularDamping()).toBe(7);
    expect(collidersOf(physicsWorld, collider)).toHaveLength(2);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.restitution()).toBeCloseTo(0.8);
      expect(part.friction()).toBeCloseTo(0.1);
    }

    rb.setLinearDamping(0);
    rb.setAngularDamping(0);
    collider.setRestitution(0);
    collider.setFriction(0);

    expect(body.linearDamping()).toBe(0);
    expect(body.angularDamping()).toBe(0);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.restitution()).toBe(0);
      expect(part.friction()).toBe(0);
    }
  });

  it("keeps dormant allocations disabled and preserves values through collider recreation", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const { entity, rb, collider } = addBody(scene, "dormant");
    entity.setActive(false);
    const oldHandles = [...collider._colliderHandles];

    rb.setLinearDamping(8);
    rb.setAngularDamping(9);
    collider.setRestitution(1.25);
    collider.setFriction(0.4);
    collider.setSensor(true);

    const body = bodyOf(physicsWorld, rb);
    expect(body.isEnabled()).toBe(false);
    expect(body.linearDamping()).toBe(8);
    expect(body.angularDamping()).toBe(9);
    expect(collider._colliderHandles).not.toEqual(oldHandles);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.isEnabled()).toBe(false);
      expect(part.isSensor()).toBe(true);
      expect(part.restitution()).toBe(1.25);
      expect(part.friction()).toBeCloseTo(0.4);
    }

    entity.setActive(true);
    expect(body.isEnabled()).toBe(true);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.isEnabled()).toBe(true);
      expect(part.restitution()).toBe(1.25);
      expect(part.friction()).toBeCloseTo(0.4);
    }
  });

  it("rejects invalid values before changing stored or live values", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const entity = spawnEntityInScene(scene, "invalid");
    entity.add(new Transform());
    const rb = new RigidBodyComponent({ type: "dynamic" });
    const collider = new ColliderComponent({
      shape: { type: "box", width: 20, height: 20 },
    });
    rb.setLinearDamping(2);
    rb.setAngularDamping(3);
    collider.setRestitution(0.7);
    collider.setFriction(0.2);

    expect(() => rb.setLinearDamping(undefined as never)).toThrow(
      "RigidBodyComponent.setLinearDamping: damping must be finite and >= 0, got undefined.",
    );
    expect(() => rb.setAngularDamping(undefined as never)).toThrow(
      "RigidBodyComponent.setAngularDamping: damping must be finite and >= 0, got undefined.",
    );
    expect(() => collider.setRestitution(undefined as never)).toThrow(
      "ColliderComponent.setRestitution: restitution must be finite and >= 0, got undefined.",
    );
    expect(() => collider.setFriction(undefined as never)).toThrow(
      "ColliderComponent.setFriction: friction must be finite and >= 0, got undefined.",
    );

    entity.add(rb);
    entity.add(collider);
    const body = bodyOf(physicsWorld, rb);
    expect(body.linearDamping()).toBe(2);
    expect(body.angularDamping()).toBe(3);
    expect(collidersOf(physicsWorld, collider)[0]?.restitution()).toBeCloseTo(
      0.7,
    );
    expect(collidersOf(physicsWorld, collider)[0]?.friction()).toBeCloseTo(0.2);

    rb.setLinearDamping(4);
    rb.setAngularDamping(5);
    collider.setRestitution(0.9);
    collider.setFriction(0.3);

    expect(() => rb.setLinearDamping(NaN)).toThrow(
      "RigidBodyComponent.setLinearDamping: damping must be finite and >= 0, got NaN.",
    );
    expect(() => rb.setAngularDamping(-1)).toThrow(
      "RigidBodyComponent.setAngularDamping: damping must be finite and >= 0, got -1.",
    );
    expect(() => collider.setRestitution(Infinity)).toThrow(
      "ColliderComponent.setRestitution: restitution must be finite and >= 0, got Infinity.",
    );
    expect(() => collider.setFriction(-1)).toThrow(
      "ColliderComponent.setFriction: friction must be finite and >= 0, got -1.",
    );
    expect(() => rb.setLinearDamping(undefined as never)).toThrow();
    expect(() => rb.setAngularDamping(undefined as never)).toThrow();
    expect(() => collider.setRestitution(undefined as never)).toThrow();
    expect(() => collider.setFriction(undefined as never)).toThrow();

    // Recreation reads the stored config, so these checks cover both the
    // live Rapier values and the values retained by the components.
    collider.setSensor(true);
    expect(body.linearDamping()).toBe(4);
    expect(body.angularDamping()).toBe(5);
    for (const part of collidersOf(physicsWorld, collider)) {
      expect(part.restitution()).toBeCloseTo(0.9);
      expect(part.friction()).toBeCloseTo(0.3);
    }
  });

  it("changes linear and angular velocity decay during simulation", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const undamped = addBody(scene, "undamped");
    const damped = addBody(scene, "damped");
    undamped.rb.setPosition(-100, 0);
    damped.rb.setPosition(100, 0);

    for (const body of [undamped.rb, damped.rb]) {
      body.setVelocity({ x: 100, y: 0 });
      body.setAngularVelocity(4);
    }
    damped.rb.setLinearDamping(10);
    damped.rb.setAngularDamping(10);

    step(physicsWorld, 30);

    expect(undamped.rb.velocityX).toBeCloseTo(100);
    expect(undamped.rb.getAngularVelocity()).toBeCloseTo(4);
    expect(damped.rb.velocityX).toBeLessThan(5);
    expect(damped.rb.getAngularVelocity()).toBeLessThan(0.2);
  });
});
