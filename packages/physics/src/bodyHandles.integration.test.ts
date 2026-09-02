import { describe, it, expect, vi } from "vitest";

// Real physics, not the usual mocks: these tests observe how Rapier decodes
// a handle it never issued, how it reuses a freed one, and what a body-type
// switch does to velocity and mass. The `@dimforge/rapier2d` ESM build
// crashes when hooks are passed to `world.step` under vitest's transform, so
// the factory swaps in `@dimforge/rapier2d-compat` — the same library and
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

import { Transform, Vec2 } from "@yagejs/core";
import type { Entity, Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import type { PhysicsWorld } from "./PhysicsWorld.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { PhysicsTestContext } from "./test-helpers.js";
import type { BodyType, ColliderConfig } from "./types.js";

const DT = 1 / 60;

interface Spawned {
  entity: Entity;
  rb: RigidBodyComponent;
  collider: ColliderComponent;
  transform: Transform;
}

function spawnBody(
  scene: Scene,
  name: string,
  x: number,
  y: number,
  type: BodyType,
  collider: ColliderConfig,
  fixedRotation = true,
): Spawned {
  const entity = spawnEntityInScene(scene, name);
  const transform = entity.add(new Transform({ position: new Vec2(x, y) }));
  const rb = entity.add(new RigidBodyComponent({ type, fixedRotation }));
  const col = entity.add(new ColliderComponent(collider));
  return { entity, rb, collider: col, transform };
}

/** Static 200×20 box centred at (x, y); top surface at y - 10. */
function spawnGround(scene: Scene, x: number, y: number): Spawned {
  return spawnBody(scene, "ground", x, y, "static", {
    shape: { type: "box", width: 200, height: 20 },
  });
}

/** 20×20 density-1 dynamic box: mass 0.16 at 50 px/m. */
function spawnBox(scene: Scene, name: string, x: number, y: number): Spawned {
  return spawnBody(scene, name, x, y, "dynamic", {
    shape: { type: "box", width: 20, height: 20 },
  });
}

/** Step like the engine does: integrate, then drain collision events. */
function step(world: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    world.step(DT);
    world.processCollisionEvents();
  }
}

/** The engine's physics systems, driven one fixed tick at a time. */
function systemsFor(ctx: PhysicsTestContext) {
  const physics = new PhysicsSystem();
  physics._setContext(ctx.context);
  const interpolation = new PhysicsInterpolationSystem();
  interpolation._setContext(ctx.context);
  return {
    tick(frames = 1) {
      for (let i = 0; i < frames; i++) {
        physics.update(DT);
        interpolation.update(DT);
      }
    },
  };
}

describe("body and collider handles (real Rapier)", () => {
  it("a destroyed component reads its own Transform and writes nothing", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    spawnGround(scene, 0, 300);
    const player = spawnBox(scene, "player", 100, 100);
    const bullet = spawnBox(scene, "bullet", 300, 300);
    step(physicsWorld, 3);

    bullet.entity.destroy();
    scene._flushDestroyQueue();

    // Rapier decodes -1 to the first body created, the player's; the
    // wrapper must not.
    expect(bullet.rb._bodyHandle).toBe(-1);
    expect(bullet.rb.position.x).toBe(bullet.transform.worldPosition.x);
    expect(bullet.rb.position.y).toBe(bullet.transform.worldPosition.y);
    expect(bullet.rb.position.x).not.toBe(player.rb.position.x);

    bullet.rb.applyImpulse({ x: 1000, y: 0 });
    bullet.rb.setVelocity({ x: 1000, y: 0 });
    step(physicsWorld, 1);
    expect(player.rb.velocityX).toBe(0);
    expect(physicsWorld.getBody(-1)).toBeUndefined();
    expect(physicsWorld.getBody(NaN)).toBeUndefined();
    expect(physicsWorld.getCollider(-1)).toBeUndefined();
  });

  it("a freed handle resolves only under the generation that reissued it", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const first = spawnBox(scene, "first", 0, 0);
    const oldBody = first.rb._bodyHandle;
    const oldCollider = first.collider._colliderHandle;

    first.entity.destroy();
    scene._flushDestroyQueue();
    expect(physicsWorld.getBody(oldBody)).toBeUndefined();
    expect(physicsWorld.getCollider(oldCollider)).toBeUndefined();

    // Rapier reuses the freed index with a bumped generation.
    const second = spawnBox(scene, "second", 50, 50);
    expect(second.rb._bodyHandle).not.toBe(oldBody);
    expect(physicsWorld.getBody(oldBody)).toBeUndefined();
    expect(physicsWorld.getCollider(oldCollider)).toBeUndefined();
    expect(physicsWorld.getBody(second.rb._bodyHandle)).toBeDefined();
    expect(
      physicsWorld.getCollider(second.collider._colliderHandle),
    ).toBeDefined();
  });

  it("removing the RigidBodyComponent leaves the collider component inert", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const stale = spawnBox(scene, "stale", 0, 0);
    const staleCollider = stale.collider;

    stale.entity.remove(RigidBodyComponent);
    expect(staleCollider._colliderHandle).toBe(-1);

    // The next collider takes the freed index.
    const fresh = spawnBody(scene, "fresh", 100, 100, "dynamic", {
      shape: { type: "box", width: 40, height: 40 },
    });
    const freshCollider = () =>
      physicsWorld.getCollider(fresh.collider._colliderHandle)!;
    const freshBody = () => physicsWorld.getBody(fresh.rb._bodyHandle)!;
    expect(freshCollider().halfExtents().x).toBeCloseTo(0.4);

    staleCollider.setShape({ type: "box", width: 10, height: 10 });
    staleCollider.setSensor(true);
    stale.entity.remove(ColliderComponent);

    expect(freshCollider().halfExtents().x).toBeCloseTo(0.4);
    expect(freshCollider().isSensor()).toBe(false);
    expect(freshBody().numColliders()).toBe(1);
    expect(physicsWorld.colliderMap.has(fresh.collider._colliderHandle)).toBe(
      true,
    );
  });

  it("applies locks set before add: an impulse cannot move or spin the locked axes", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext({
      gravity: { x: 0, y: 0 },
    });
    const entity = spawnEntityInScene(scene, "locked");
    entity.add(new Transform({ position: new Vec2(0, 0) }));
    const rb = new RigidBodyComponent({ type: "dynamic" });
    rb.setEnabledTranslations(false, true);
    rb.lockRotations(true);
    entity.add(rb);
    entity.add(
      new ColliderComponent({ shape: { type: "box", width: 20, height: 20 } }),
    );
    const unlocked = spawnBox(scene, "unlocked", 200, 0);

    // 16 px·kg/s on a 0.16 kg body is 100 px/s.
    rb.applyImpulse({ x: 16, y: 16 });
    rb.applyTorque(1);
    unlocked.rb.applyImpulse({ x: 16, y: 16 });
    step(physicsWorld, 10);

    expect(rb.position.x).toBe(0);
    expect(rb.position.y).toBeCloseTo(100 * 10 * DT, 3);
    expect(rb.rotation).toBe(0);
    expect(unlocked.rb.position.x).toBeCloseTo(200 + 100 * 10 * DT, 3);
  });

  it("rejects a degenerate polygon at construction and keeps the world stepping", async () => {
    const { scene, physicsWorld } = await createPhysicsTestContext();
    const inputs: Array<{ x: number; y: number }[]> = [
      [],
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      [
        { x: 0, y: 0 },
        { x: NaN, y: 0 },
        { x: 0, y: 10 },
      ],
    ];
    for (const vertices of inputs) {
      expect(
        () => new ColliderComponent({ shape: { type: "polygon", vertices } }),
      ).toThrow(/^ColliderComponent: shape\.vertices/);
    }

    const box = spawnBox(scene, "box", 0, 0);
    step(physicsWorld, 10);
    expect(box.rb.position.y).toBeGreaterThan(0);
  });

  describe("setType", () => {
    it("dynamic → static: a ram stops against the corpse, a rider rests on it, the Transform matches", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene, physicsWorld } = ctx;
      const { tick } = systemsFor(ctx);
      spawnGround(scene, 0, 300);
      const corpse = spawnBox(scene, "corpse", 0, 280);
      const massBefore = corpse.rb.getMass();
      tick(30);

      corpse.rb.setType("static");
      expect(corpse.rb.type).toBe("static");
      expect(corpse.rb.getMass()).toBeCloseTo(massBefore);
      expect(corpse.transform.worldPosition.x).toBeCloseTo(
        corpse.rb.position.x,
      );
      expect(corpse.transform.worldPosition.y).toBeCloseTo(
        corpse.rb.position.y,
      );

      const ram = spawnBox(scene, "ram", -80, 280);
      ram.rb.setVelocity({ x: 600, y: 0 });
      const rider = spawnBox(scene, "rider", 0, 200);
      tick(120);

      expect(corpse.rb.position.x).toBeCloseTo(0, 3);
      expect(ram.rb.position.x).toBeLessThan(-19);
      // Corpse top at 270, rider half-height 10.
      expect(rider.rb.position.y).toBeCloseTo(260, 0);
      expect(physicsWorld.getBody(corpse.rb._bodyHandle)!.isFixed()).toBe(true);
    });

    it("static → dynamic: an impulse on the very next step moves the body by impulse / mass", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        gravity: { x: 0, y: 0 },
      });
      const box = spawnBox(scene, "box", 0, 0);
      const mass = box.rb.getMass();
      expect(mass).toBeCloseTo(0.16);
      step(physicsWorld, 1);

      box.rb.setType("static");
      step(physicsWorld, 1);
      box.rb.setType("dynamic");
      expect(box.rb.type).toBe("dynamic");
      expect(box.rb.getMass()).toBeCloseTo(mass);

      box.rb.applyImpulse({ x: 100, y: 0 });
      step(physicsWorld, 1);
      expect(box.rb.velocityX).toBeCloseTo(625, 3);
    });

    it("dynamic → kinematic: still until the Transform is written, then at the written pose next step", async () => {
      const ctx = await createPhysicsTestContext();
      const { scene } = ctx;
      const { tick } = systemsFor(ctx);
      const crate = spawnBox(scene, "crate", 100, 100);
      crate.rb.setVelocity({ x: 200, y: 0 });
      tick(1);

      crate.rb.setType("kinematic");
      expect(crate.rb.type).toBe("kinematic");
      const held = crate.rb.position;
      tick(5);
      expect(crate.rb.position.x).toBeCloseTo(held.x);
      expect(crate.rb.position.y).toBeCloseTo(held.y);
      expect(crate.transform.worldPosition.x).toBeCloseTo(held.x);

      crate.transform.setPosition(400, 50);
      tick(1);
      expect(crate.rb.position.x).toBeCloseTo(400);
      expect(crate.rb.position.y).toBeCloseTo(50);
    });

    it("creates the body as the type set before add", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "pre");
      entity.add(new Transform());
      const rb = new RigidBodyComponent({ type: "dynamic" });
      rb.setType("static");
      entity.add(rb);

      expect(rb.type).toBe("static");
      expect(physicsWorld.getBody(rb._bodyHandle)!.isFixed()).toBe(true);
    });
  });
});
