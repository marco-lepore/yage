import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: these tests observe what a body or
// collider switched off while it has a contact does to the rest of the world.
// Its contacts must end with it. Rapier 0.19 kept them and solved them on the
// body that took the switched-off body's slot among the awake bodies, which
// stopped that body in mid-air. The `@dimforge/rapier2d` ESM build crashes
// when hooks are passed to `world.step` under vitest's transform, so the
// factory swaps in `@dimforge/rapier2d-compat` — the same library and
// version, instantiated at runtime.
vi.mock("@dimforge/rapier2d", async () => {
  const mod = (await import("@dimforge/rapier2d-compat")) as {
    default?: { init(): Promise<unknown> };
  };
  const RAPIER =
    mod.default ?? (mod as unknown as { init(): Promise<unknown> });
  await RAPIER.init();
  return { default: RAPIER };
});

import RAPIER from "@dimforge/rapier2d";
import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { CollisionLayers } from "./CollisionLayers.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { PhysicsTestContext } from "./test-helpers.js";
import type { BodyType } from "./types.js";

const DT = 1 / 60;
const GRAVITY = 980;

interface Spawned {
  entity: Entity;
  transform: Transform;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
}

/** A frictionless box body with its centre at (x, y). */
function spawnBox(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: BodyType,
  width = 20,
  height = 20,
): Spawned {
  const entity = spawnEntityInScene(scene, name);
  const transform = entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation: true }));
  const collider = entity.add(
    new ColliderComponent({
      shape: { type: "box", width, height },
      friction: 0,
    }),
  );
  return { entity, transform, rb, collider };
}

/** Static 2000×20 ground centred at y = 300; its top is at y = 290. */
function spawnGround(scene: Scene): Spawned {
  return spawnBox(scene, "ground", 0, 300, "static", 2000, 20);
}

/**
 * The engine's frame, one fixed tick at a time: step and deliver events,
 * then remove the entities destroyed this frame, then interpolate.
 */
function systemsFor(ctx: PhysicsTestContext) {
  const physics = new PhysicsSystem();
  physics._setContext(ctx.context);
  const interpolation = new PhysicsInterpolationSystem();
  interpolation._setContext(ctx.context);
  return {
    physics,
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        physics.update(DT);
        ctx.scene._flushDestroyQueue();
        interpolation.update(DT);
      }
    },
  };
}

/**
 * A crate resting on the ground, and a box spawned after it that is still
 * falling. The faller is the newest awake body, the one that takes the
 * crate's slot when the crate is switched off.
 */
async function restingCrateAndFaller() {
  const ctx = await createPhysicsTestContext({ gravity: { x: 0, y: GRAVITY } });
  const sys = systemsFor(ctx);
  spawnGround(ctx.scene);
  const crate = spawnBox(ctx.scene, "crate", 0, 280, "dynamic");
  sys.tick(30);
  const faller = spawnBox(ctx.scene, "faller", 300, 0, "dynamic");
  sys.tick(5);
  return { ctx, sys, crate, faller };
}

describe("a body switched off while touching the ground (real Rapier)", () => {
  it("destroy() and a spatial query in the same frame leave a falling body falling", async () => {
    const { ctx, sys, crate, faller } = await restingCrateAndFaller();
    const vyBefore = faller.rb.velocityY;

    // destroy() switches the crate off now and removes it at the end of the
    // frame. A query in between runs a zero-duration step to refresh
    // Rapier's query index.
    crate.entity.destroy();
    ctx.physicsWorld.raycast({ x: 500, y: 0 }, { x: 0, y: 1 }, 10);
    ctx.scene._flushDestroyQueue();
    expect(faller.rb.velocityY).toBeCloseTo(vyBefore, 3);

    sys.tick(1);
    expect(faller.rb.velocityY).toBeCloseTo(vyBefore + GRAVITY * DT, 1);
  });

  it("destroy() between two physics steps of one frame leaves a falling body falling", async () => {
    const { ctx, sys, crate, faller } = await restingCrateAndFaller();
    const vyBefore = faller.rb.velocityY;

    // A slow frame runs two fixed steps; a collision handler or fixedUpdate
    // in the first destroys the crate, and the second steps before the
    // end-of-frame removal.
    sys.physics.update(DT);
    crate.entity.destroy();
    sys.physics.update(DT);
    ctx.scene._flushDestroyQueue();

    expect(faller.rb.velocityY).toBeCloseTo(vyBefore + 2 * GRAVITY * DT, 1);
  });

  it("a crate deactivated for a pool leaves a falling body falling", async () => {
    const { sys, crate, faller } = await restingCrateAndFaller();
    const vyBefore = faller.rb.velocityY;

    // A pooled entity stays switched off, still in the world, for every
    // step until it is acquired again.
    crate.entity.setActive(false);
    sys.tick(1);
    expect(faller.rb.velocityY).toBeCloseTo(vyBefore + GRAVITY * DT, 1);

    sys.tick(30);
    expect(faller.rb.positionY).toBeGreaterThan(100);
  });

  it("disabling only the crate's RigidBodyComponent leaves a falling body falling", async () => {
    const { sys, crate, faller } = await restingCrateAndFaller();
    const vyBefore = faller.rb.velocityY;

    crate.rb.enabled = false;
    sys.tick(1);

    expect(faller.rb.velocityY).toBeCloseTo(vyBefore + GRAVITY * DT, 1);
  });

  it("a bullet destroyed on impact does not stop the next bullet in flight", async () => {
    // The shooter example: two bullets fired at a wall, the first destroying
    // itself in its collision handler, and a player ground check (a raycast)
    // in every frame's update.
    const layers = new CollisionLayers();
    const LAYER_PLAYER = layers.define("player");
    const LAYER_WALL = layers.define("wall");
    const LAYER_BULLET = layers.define("bullet");
    const ctx = await createPhysicsTestContext({
      gravity: { x: 0, y: GRAVITY },
    });
    const { scene, physicsWorld } = ctx;
    const sys = systemsFor(ctx);
    const wall = (x: number, y: number, width: number, height: number) => {
      const entity = spawnEntityInScene(scene, "wall");
      entity.add(new Transform({ position: new Vec2(x, y) }));
      entity.add(new RigidBodyComponent({ type: "static" }));
      entity.add(
        new ColliderComponent({
          shape: { type: "box", width, height },
          friction: 0,
          layers: LAYER_WALL,
          mask: LAYER_PLAYER | LAYER_BULLET,
        }),
      );
    };
    wall(600, 750, 1200, 100); // ground
    wall(-5, 400, 10, 800); // left wall
    const player = spawnEntityInScene(scene, "player");
    player.add(new Transform({ position: new Vec2(700, 680) }));
    const playerRb = player.add(
      new RigidBodyComponent({
        type: "dynamic",
        fixedRotation: true,
        ccd: true,
      }),
    );
    player.add(
      new ColliderComponent({
        shape: { type: "box", width: 24, height: 36 },
        friction: 0,
        layers: LAYER_PLAYER,
        mask: LAYER_WALL,
      }),
    );
    const fire = (name: string) => {
      const entity = spawnEntityInScene(scene, name);
      entity.add(new Transform({ position: new Vec2(682, 674) }));
      const rb = entity.add(
        new RigidBodyComponent({
          type: "dynamic",
          fixedRotation: true,
          gravityScale: 0,
          ccd: true,
        }),
      );
      const collider = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 8, height: 4 },
          friction: 0,
          layers: LAYER_BULLET,
          mask: LAYER_WALL,
        }),
      );
      rb.setVelocity(new Vec2(-600, 0));
      collider.onCollision((event) => {
        if (event.started && !entity.isDestroyed) entity.destroy();
      });
      return { entity, rb };
    };
    const frame = () => {
      sys.physics.update(DT);
      physicsWorld.raycast(player.get(Transform).position, Vec2.DOWN, 22);
      playerRb.setVelocityX(0);
      scene._flushDestroyQueue();
    };

    const first = fire("bullet-1");
    for (let i = 0; i < 4; i++) frame();
    const second = fire("bullet-2");
    for (let i = 0; i < 120 && !second.entity.isDestroyed; i++) {
      frame();
      if (first.entity.isDestroyed && !second.entity.isDestroyed) {
        expect(second.rb.velocityX).toBeCloseTo(-600, 3);
      }
    }

    // The second bullet reached the wall and destroyed itself there.
    expect(first.entity.isDestroyed).toBe(true);
    expect(second.entity.isDestroyed).toBe(true);
  });
});

describe("a collider switched off while in contact (real Rapier)", () => {
  it("a collider disabled on a resting body stops blocking other bodies", async () => {
    const ctx = await createPhysicsTestContext({
      gravity: { x: 0, y: GRAVITY },
    });
    const sys = systemsFor(ctx);
    spawnGround(ctx.scene);
    const box = spawnBox(ctx.scene, "box", 0, 280, "dynamic");
    sys.tick(20);

    box.collider.enabled = false;
    const ball = spawnBox(ctx.scene, "ball", 0, 200, "dynamic", 10, 10);
    sys.tick(40);

    // It lands on the ground (centre 285), not on the box's top (265).
    expect(ball.rb.positionY).toBeCloseTo(285, 0);
  });

  it("a zero-area scale on a resting body stops its collider blocking other bodies", async () => {
    const ctx = await createPhysicsTestContext({
      gravity: { x: 0, y: GRAVITY },
    });
    const sys = systemsFor(ctx);
    spawnGround(ctx.scene);
    const box = spawnBox(ctx.scene, "box", 0, 280, "dynamic");
    sys.tick(20);

    box.transform.setScale(0, 0);
    const ball = spawnBox(ctx.scene, "ball", 0, 200, "dynamic", 10, 10);
    sys.tick(40);

    expect(ball.rb.positionY).toBeCloseTo(285, 0);
  });

  it("a moving kinematic platform deactivated under a rider drops the rider", async () => {
    const ctx = await createPhysicsTestContext({
      gravity: { x: 0, y: GRAVITY },
    });
    const sys = systemsFor(ctx);
    const platform = spawnBox(ctx.scene, "platform", 0, 300, "kinematic", 200);
    const rider = spawnBox(ctx.scene, "rider", 0, 280, "dynamic");
    for (let i = 0; i < 20; i++) {
      platform.transform.setPosition(i * 0.5, 300);
      sys.tick(1);
    }

    platform.entity.setActive(false);
    sys.tick(20);

    expect(rider.rb.positionY).toBeGreaterThan(320);
  });
});

describe("Rapier: switching off a body that has a contact (no YAGE code)", () => {
  it("leaves every other body's velocity alone", () => {
    const world = new RAPIER.World({ x: 0, y: 9.8 });
    world.timestep = DT;
    const queue = new RAPIER.EventQueue(true);
    const make = (desc: RAPIER.RigidBodyDesc, hw: number, hh: number) => {
      const body = world.createRigidBody(desc);
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hw, hh)
          .setFriction(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      return { body, collider };
    };
    // Wall with its right face at x = 0.
    make(RAPIER.RigidBodyDesc.fixed().setTranslation(-0.1, 8), 0.1, 8);
    const bulletDesc = () =>
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(6, 12)
        .lockRotations()
        .setGravityScale(0);
    const first = make(bulletDesc(), 0.08, 0.04);
    const second = make(bulletDesc(), 0.08, 0.04);
    first.body.setLinvel({ x: -12, y: 0 }, true);
    second.body.setTranslation({ x: 8, y: 11 }, true);
    second.body.setLinvel({ x: -12, y: 1 }, true);

    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      world.step(queue);
      queue.drainCollisionEvents((h1, h2, started) => {
        const handle = first.collider.handle;
        if (started && (h1 === handle || h2 === handle)) hit = true;
      });
    }
    expect(hit).toBe(true);

    first.body.setEnabled(false);
    world.step(queue);

    expect(second.body.linvel().x).toBeCloseTo(-12, 3);
    expect(second.body.linvel().y).toBeCloseTo(1, 3);
  });
});
