import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: joint tests must observe Rapier's actual
// constraint solver. The `@dimforge/rapier2d` ESM build can crash under
// vitest's transform when wasm-bindgen is initialized there, so the factory
// swaps in `@dimforge/rapier2d-compat` — the same library and version,
// instantiated at runtime — which runs the solver in Node.
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
import { ColliderComponent } from "./ColliderComponent.js";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

const DT = 1 / 60;

interface SpawnedBody {
  entity: Entity;
  rb: RigidBodyComponent;
}

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: "dynamic" | "static",
): SpawnedBody {
  const entity = spawnEntityInScene(scene, name);
  entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation: true }));
  if (type === "dynamic") {
    entity.add(
      new ColliderComponent({
        shape: { type: "circle", radius: 5 },
      }),
    );
  }
  return { entity, rb };
}

function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    world.step(DT);
    world.processCollisionEvents();
  }
}

function distance(a: RigidBodyComponent, b: RigidBodyComponent): number {
  return Math.hypot(a.positionX - b.positionX, a.positionY - b.positionY);
}

describe("spring and rope joints (real Rapier)", () => {
  it("spring converges to its rest length from stretched and compressed positions", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const stretchedA = spawnBody(scene, "stretched-a", 0, 0, "dynamic");
    const stretchedB = spawnBody(scene, "stretched-b", 200, 0, "dynamic");
    physicsWorld.addJoint(stretchedA.rb, stretchedB.rb, {
      type: "spring",
      restLength: 100,
      stiffness: 40,
      damping: 4,
    });

    step(physicsWorld, 240);

    expect(distance(stretchedA.rb, stretchedB.rb)).toBeCloseTo(100, -1);

    const compressedA = spawnBody(scene, "compressed-a", 300, 0, "dynamic");
    const compressedB = spawnBody(scene, "compressed-b", 350, 0, "dynamic");
    physicsWorld.addJoint(compressedA.rb, compressedB.rb, {
      type: "spring",
      restLength: 100,
      stiffness: 40,
      damping: 4,
    });

    step(physicsWorld, 240);

    expect(distance(compressedA.rb, compressedB.rb)).toBeCloseTo(100, -1);
  });

  it("rope constrains a dynamic body while it swings around a static anchor", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const anchor = spawnBody(scene, "anchor", 0, 100, "static");
    const ball = spawnBody(scene, "ball", 80, 100, "dynamic");
    physicsWorld.addJoint(ball.rb, anchor.rb, {
      type: "rope",
      length: 100,
    });

    let crossedUnder = false;
    for (let i = 0; i < 600; i++) {
      step(physicsWorld, 1);
      if (ball.rb.positionX < 0) crossedUnder = true;
    }

    expect(distance(ball.rb, anchor.rb)).toBeLessThanOrEqual(105);
    expect(crossedUnder).toBe(true);
  });

  it("rope length is converted from pixels to meters", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const anchor = spawnBody(scene, "anchor", 0, 0, "static");
    const ball = spawnBody(scene, "ball", 0, 0, "dynamic");
    physicsWorld.addJoint(ball.rb, anchor.rb, {
      type: "rope",
      length: 100,
    });

    step(physicsWorld, 300);

    expect(ball.rb.positionX).toBeCloseTo(0, 0);
    expect(ball.rb.positionY).toBeCloseTo(100, -1);
  });

  it("remove detaches the joint idempotently", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const anchor = spawnBody(scene, "anchor", 0, 0, "static");
    const ball = spawnBody(scene, "ball", 0, 100, "dynamic");
    const handle = physicsWorld.addJoint(ball.rb, anchor.rb, {
      type: "rope",
      length: 100,
    });

    handle.remove();
    handle.remove();
    step(physicsWorld, 60);

    expect(handle.attached).toBe(false);
    expect(ball.rb.positionY).toBeGreaterThan(100);
  });

  it("destroying a jointed body detaches the joint and leaves stepping safe", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const anchor = spawnBody(scene, "anchor", 0, 0, "static");
    const ball = spawnBody(scene, "ball", 0, 100, "dynamic");
    const handle = physicsWorld.addJoint(ball.rb, anchor.rb, {
      type: "rope",
      length: 100,
    });

    anchor.entity.destroy();
    scene._flushDestroyQueue();

    expect(handle.attached).toBe(false);
    expect(() => step(physicsWorld, 60)).not.toThrow();
    expect(ball.rb.positionY).toBeGreaterThan(100);
    expect(() => handle.remove()).not.toThrow();
  });

  it("rejects an unadded body, a body from another world, and a self-joint", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const live = spawnBody(scene, "live", 0, 0, "dynamic");
    const notAdded = new RigidBodyComponent({ type: "dynamic" });
    const config = { type: "rope" as const, length: 100 };

    expect(() => physicsWorld.addJoint(notAdded, live.rb, config)).toThrow(
      "must be added to this physics world first",
    );
    expect(() => physicsWorld.addJoint(live.rb, live.rb, config)).toThrow(
      "body and itself",
    );

    // A body from another scene's world can share a raw handle value with one
    // of this world's bodies, so the check must compare entities, not handles.
    const other = await createPhysicsTestContext({ gravity: { x: 0, y: 0 } });
    const foreign = spawnBody(other.scene, "foreign", 0, 0, "dynamic");
    expect(() => physicsWorld.addJoint(live.rb, foreign.rb, config)).toThrow(
      "different scene's physics world",
    );
  });

  it("anchors are converted from pixels to meters", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const anchor = spawnBody(scene, "anchor", 300, 300, "static");
    const ball = spawnBody(scene, "ball", 420, 300, "dynamic");
    // Zero rest length pulls the ball's origin onto the anchor point 100 px
    // to the anchor body's right. An unconverted anchor would sit 5000 px out
    // (100 px misread as 100 m at the default 50 px/m).
    physicsWorld.addJoint(anchor.rb, ball.rb, {
      type: "spring",
      restLength: 0,
      stiffness: 40,
      damping: 4,
      anchorA: { x: 100, y: 0 },
    });

    step(physicsWorld, 300);

    expect(ball.rb.positionX).toBeCloseTo(400, -1);
    expect(ball.rb.positionY).toBeCloseTo(300, -1);
  });

  it("disabling a jointed entity detaches the joint", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const anchor = spawnBody(scene, "anchor", 0, 0, "static");
    const ball = spawnBody(scene, "ball", 0, 100, "dynamic");
    const handle = physicsWorld.addJoint(ball.rb, anchor.rb, {
      type: "rope",
      length: 100,
    });

    ball.entity.setActive(false);

    expect(handle.attached).toBe(false);

    // Re-enabling does not restore the joint: the ball free-falls well past
    // the old rope length.
    ball.entity.setActive(true);
    step(physicsWorld, 60);

    expect(ball.rb.positionY).toBeGreaterThan(150);
  });

  it("removing a jointed body clears both registry entries", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const first = spawnBody(scene, "first", 0, 0, "dynamic");
    const second = spawnBody(scene, "second", 100, 0, "dynamic");
    physicsWorld.addJoint(first.rb, second.rb, {
      type: "rope",
      length: 100,
    });
    const firstHandle = first.rb._bodyHandle;
    const secondHandle = second.rb._bodyHandle;

    expect(physicsWorld._jointsByBody.has(firstHandle)).toBe(true);
    expect(physicsWorld._jointsByBody.has(secondHandle)).toBe(true);

    first.entity.destroy();
    scene._flushDestroyQueue();

    expect(physicsWorld._jointsByBody.has(firstHandle)).toBe(false);
    expect(physicsWorld._jointsByBody.has(secondHandle)).toBe(false);
  });
});
