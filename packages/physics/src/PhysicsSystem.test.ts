import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;
  let nextColliderHandle = 0;

  class MockRigidBodyDesc {
    static dynamic() { return new MockRigidBodyDesc(); }
    static fixed() { return new MockRigidBodyDesc(); }
    static kinematicPositionBased() { return new MockRigidBodyDesc(); }
    setLinearDamping() { return this; }
    setAngularDamping() { return this; }
    lockRotations() { return this; }
    setGravityScale() { return this; }
    setCcdEnabled() { return this; }
  }

  class MockCollider {
    handle: number;
    constructor() { this.handle = nextColliderHandle++; }
    isSensor() { return false; }
  }

  class MockRigidBody {
    handle: number;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _linvel = { x: 0, y: 0 };
    _angvel = 0;
    _colliders: MockCollider[] = [];
    _bodyType: string;

    setNextKinematicTranslationSpy = vi.fn();
    setNextKinematicRotationSpy = vi.fn();

    constructor(bodyType = "dynamic") {
      this.handle = nextBodyHandle++;
      this._bodyType = bodyType;
    }

    translation() { return { ...this._translation }; }
    rotation() { return this._rotation; }
    linvel() { return { ...this._linvel }; }
    angvel() { return this._angvel; }
    setTranslation(t: { x: number; y: number }) { this._translation = { ...t }; }
    setRotation(r: number) { this._rotation = r; }
    setLinvel() {}
    setAngvel() {}
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    setNextKinematicTranslation(t: { x: number; y: number }) {
      this._translation = { ...t };
      this.setNextKinematicTranslationSpy(t);
    }
    setNextKinematicRotation(r: number) {
      this._rotation = r;
      this.setNextKinematicRotationSpy(r);
    }
    isDynamic() { return this._bodyType === "dynamic"; }
    isFixed() { return this._bodyType === "fixed"; }
    isKinematic() { return this._bodyType === "kinematic"; }
    numColliders() { return this._colliders.length; }
    collider(i: number) { return this._colliders[i]; }
    sleep() {}
    wakeUp() {}
  }

  class MockColliderDesc {
    static cuboid() { return new MockColliderDesc(); }
    static ball() { return new MockColliderDesc(); }
    static capsule() { return new MockColliderDesc(); }
    static convexHull() { return new MockColliderDesc(); }
    setTranslation() { return this; }
    setRestitution() { return this; }
    setFriction() { return this; }
    setDensity() { return this; }
    setSensor() { return this; }
    setCollisionGroups() { return this; }
    setActiveEvents() { return this; }
  }

  class MockEventQueue {
    drainCollisionEvents() {}
    free() {}
  }

  class MockWorld {
    gravity = { x: 0, y: 0 };
    timestep = 0;
    _bodies = new Map<number, MockRigidBody>();
    _colliders = new Map<number, MockCollider>();
    stepSpy = vi.fn();

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step(eq: MockEventQueue) { this.stepSpy(eq); }

    createRigidBody(desc: MockRigidBodyDesc): MockRigidBody {
      const body = new MockRigidBody((desc as unknown as { _type?: string })._type ?? "dynamic");
      this._bodies.set(body.handle, body);
      return body;
    }

    createCollider(_desc: MockColliderDesc, parent: MockRigidBody): MockCollider {
      const collider = new MockCollider();
      parent._colliders.push(collider);
      this._colliders.set(collider.handle, collider);
      return collider;
    }

    getRigidBody(handle: number) {
      return this._bodies.get(handle);
    }

    getCollider(handle: number) {
      return this._colliders.get(handle);
    }

    removeRigidBody(body: MockRigidBody) {
      this._bodies.delete(body.handle);
    }

    free() {}
  }

  function resetHandles() {
    nextBodyHandle = 0;
    nextColliderHandle = 0;
  }

  return {
    mocks: { MockWorld, MockRigidBody, MockRigidBodyDesc, MockColliderDesc, MockEventQueue, resetHandles },
  };
});

vi.mock("@dimforge/rapier2d", () => ({
  default: {
    World: mocks.MockWorld,
    RigidBodyDesc: mocks.MockRigidBodyDesc,
    ColliderDesc: mocks.MockColliderDesc,
    EventQueue: mocks.MockEventQueue,
    ActiveEvents: { COLLISION_EVENTS: 1, CONTACT_FORCE_EVENTS: 2 },
  },
}));

import { Transform, Vec2, Phase } from "@yage/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import { createPhysicsTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("PhysicsSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  it("has phase FixedUpdate and priority 0", () => {
    const system = new PhysicsSystem();
    expect(system.phase).toBe(Phase.FixedUpdate);
    expect(system.priority).toBe(0);
  });

  describe("update", () => {
    it("calls physicsWorld.step with dt converted to seconds", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      // Get underlying mock world
      const world = (physicsWorld as unknown as { world: InstanceType<typeof mocks.MockWorld> }).world;

      system.update(16.67); // ms

      expect(world.stepSpy).toHaveBeenCalled();
      expect(world.timestep).toBeCloseTo(16.67 / 1000);
    });

    it("stores prev state before updating curr for dynamic bodies", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      // Simulate Rapier updating position after step
      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._translation = { x: 2.2, y: 4.2 }; // meters = 110px, 210px
      body._rotation = 0.5;

      system.update(16.67);

      // prev should be the old position
      expect(rb._prevPosition.x).toBeCloseTo(100);
      expect(rb._prevPosition.y).toBeCloseTo(200);

      // curr should be updated from Rapier
      expect(rb._currPosition.x).toBeCloseTo(110);
      expect(rb._currPosition.y).toBeCloseTo(210);
      expect(rb._currRotation).toBeCloseTo(0.5);
    });

    it("syncs Transform → Rapier for kinematic bodies", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      const transform = entity.add(new Transform({ position: new Vec2(150, 250) }));
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._bodyType = "kinematic";

      transform.setPosition(200, 300);

      system.update(16.67);

      expect(body.setNextKinematicTranslationSpy).toHaveBeenCalledWith({
        x: 4, // 200/50
        y: 6, // 300/50
      });
    });

    it("does not sync static bodies to Rapier", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 100) }));
      const rb = entity.add(new RigidBodyComponent({ type: "static" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._bodyType = "fixed";

      system.update(16.67);

      // Static body should not have kinematic methods called
      expect(body.setNextKinematicTranslationSpy).not.toHaveBeenCalled();
      // And isDynamic is false so curr shouldn't be updated from Rapier
    });

    it("updates Transform for dynamic bodies after step", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._translation = { x: 3, y: 4 }; // meters = 150px, 200px
      body._rotation = 1.0;

      system.update(16.67);

      expect(transform.position.x).toBeCloseTo(150);
      expect(transform.position.y).toBeCloseTo(200);
      expect(transform.rotation).toBeCloseTo(1.0);
    });

    it("clears teleport flag", () => {
      const { scene, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      rb._teleported = true;

      system.update(16.67);

      expect(rb._teleported).toBe(false);
    });

    it("processes collision events", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      // Spy on processCollisionEvents
      const spy = vi.spyOn(physicsWorld, "processCollisionEvents");

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      system.update(16.67);

      expect(spy).toHaveBeenCalled();
    });

    it("skips destroyed entities", () => {
      const { scene, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      entity.destroy(); // Mark for destruction

      // Should not throw
      system.update(16.67);
    });

    it("handles empty scene", () => {
      const { context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      // Should not throw
      system.update(16.67);
    });

    it("sleeps bodies in paused scenes", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      const sleepSpy = vi.spyOn(body, "sleep");

      // Pause the scene
      scene.paused = true;
      system.update(16.67);

      expect(sleepSpy).toHaveBeenCalled();
      expect(rb._pauseSleeping).toBe(true);
    });

    it("wakes bodies when scene resumes", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      const wakeUpSpy = vi.spyOn(body, "wakeUp");

      // Pause then resume
      scene.paused = true;
      system.update(16.67);
      scene.paused = false;
      system.update(16.67);

      expect(wakeUpSpy).toHaveBeenCalled();
      expect(rb._pauseSleeping).toBe(false);
    });

    it("does not double-sleep already paused bodies", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      const sleepSpy = vi.spyOn(body, "sleep");

      scene.paused = true;
      system.update(16.67);
      system.update(16.67);

      expect(sleepSpy).toHaveBeenCalledTimes(1);
    });

    it("returns early when all scenes are paused", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const world = (physicsWorld as unknown as { world: InstanceType<typeof mocks.MockWorld> }).world;

      // First update to initialize
      system.update(16.67);
      world.stepSpy.mockClear();

      // Pause everything
      scene.paused = true;
      system.update(16.67);

      // Step should not be called when all paused
      expect(world.stepSpy).not.toHaveBeenCalled();
    });

    it("caps accumulator to prevent unbounded growth at high timeScale", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext();
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const world = (physicsWorld as unknown as { world: InstanceType<typeof mocks.MockWorld> }).world;

      scene.timeScale = 5;

      // Run several frames — step count should be bounded, not growing
      for (let i = 0; i < 10; i++) {
        world.stepSpy.mockClear();
        system.update(16.67);
        // maxSteps = ceil(5) + 1 = 6, but accumulator is capped,
        // so we should never see more than 6 steps per frame
        expect(world.stepSpy.mock.calls.length).toBeLessThanOrEqual(6);
      }
    });

    it("stores prev/curr correctly across multiple steps", () => {
      const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const system = new PhysicsSystem();
      system._setContext(context);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;

      // First step: body moves to (1, 1) meters = (50, 50) pixels
      body._translation = { x: 1, y: 1 };
      system.update(16.67);

      expect(rb._prevPosition.equals(Vec2.ZERO)).toBe(true); // was at origin
      expect(rb._currPosition.x).toBeCloseTo(50);
      expect(rb._currPosition.y).toBeCloseTo(50);

      // Second step: body moves to (2, 2) meters = (100, 100) pixels
      body._translation = { x: 2, y: 2 };
      system.update(16.67);

      expect(rb._prevPosition.x).toBeCloseTo(50); // was at (50,50)
      expect(rb._currPosition.x).toBeCloseTo(100);
      expect(rb._currPosition.y).toBeCloseTo(100);
    });
  });
});
