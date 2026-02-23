import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;

  class MockRigidBodyDesc {
    _type = "dynamic";
    static dynamic() { const d = new MockRigidBodyDesc(); d._type = "dynamic"; return d; }
    static fixed() { const d = new MockRigidBodyDesc(); d._type = "fixed"; return d; }
    static kinematicPositionBased() { const d = new MockRigidBodyDesc(); d._type = "kinematic"; return d; }
    setLinearDamping() { return this; }
    setAngularDamping() { return this; }
    lockRotations() { return this; }
    setGravityScale() { return this; }
    setCcdEnabled() { return this; }
  }

  class MockRigidBody {
    handle: number;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _colliders: unknown[] = [];
    _bodyType: string;

    constructor(bodyType = "dynamic") {
      this.handle = nextBodyHandle++;
      this._bodyType = bodyType;
    }

    translation() { return { ...this._translation }; }
    rotation() { return this._rotation; }
    linvel() { return { x: 0, y: 0 }; }
    angvel() { return 0; }
    setTranslation(t: { x: number; y: number }) { this._translation = { ...t }; }
    setRotation(r: number) { this._rotation = r; }
    setLinvel() {}
    setAngvel() {}
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    setNextKinematicTranslation() {}
    setNextKinematicRotation() {}
    isDynamic() { return this._bodyType === "dynamic"; }
    isFixed() { return this._bodyType === "fixed"; }
    isKinematic() { return this._bodyType === "kinematic"; }
    numColliders() { return this._colliders.length; }
    collider(i: number) { return this._colliders[i]; }
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

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {}
    createRigidBody(desc: MockRigidBodyDesc): MockRigidBody {
      const body = new MockRigidBody(desc._type);
      this._bodies.set(body.handle, body);
      return body;
    }
    createCollider() { return { handle: 0 }; }
    getRigidBody(handle: number) { return this._bodies.get(handle); }
    getCollider() { return undefined; }
    removeRigidBody(body: MockRigidBody) { this._bodies.delete(body.handle); }
    free() {}
  }

  function resetHandles() { nextBodyHandle = 0; }

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
    ActiveEvents: { COLLISION_EVENTS: 1 },
  },
}));

import { Transform, Vec2, Phase } from "@yage/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { createPhysicsTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("PhysicsInterpolationSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  it("has phase LateUpdate and priority 100", () => {
    const system = new PhysicsInterpolationSystem();
    expect(system.phase).toBe(Phase.LateUpdate);
    expect(system.priority).toBe(100);
  });

  it("at alpha=0, transform equals prev position", () => {
    const { scene, context } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(100, 100);
    rb._currPosition = new Vec2(200, 200);
    rb._prevRotation = 0;
    rb._currRotation = Math.PI;

    // alpha = 0 initially (no ticks)
    system.update(0);

    expect(transform.position.x).toBeCloseTo(100);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(0);
  });

  it("at alpha=0.5, transform is midpoint", () => {
    const { scene, context, gameLoop } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    // Simulate partial tick: accumulate 5ms with 10ms fixed step → alpha = 0.5
    const cbs = {
      earlyUpdate: vi.fn(),
      fixedUpdate: vi.fn(),
      update: vi.fn(),
      lateUpdate: vi.fn(),
      render: vi.fn(),
      endOfFrame: vi.fn(),
    };
    gameLoop.setCallbacks(cbs);
    gameLoop.start();
    // GameLoop defaults to ~16.67ms fixed step
    // We need alpha = 0.5, so tick with half of fixedTimestep
    const halfStep = gameLoop.fixedTimestep / 2;
    gameLoop.tick(halfStep);

    system.update(0);

    expect(transform.position.x).toBeCloseTo(50);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(1);
  });

  it("at alpha=1, transform equals curr position", () => {
    const { scene, context, gameLoop } = createPhysicsTestContext();

    // Use custom game loop with precise step so we can get alpha=1
    // We need to tick exactly one fixedStep + remainder = fixedStep
    // Actually alpha=accumulator/fixedStep. After exact step, alpha=0.
    // For alpha≈1, tick just under 2*fixedStep.

    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    // Manually set alpha-equivalent state by ticking appropriately
    // GameLoop fixedTimestep = ~16.67ms
    // Tick 16.67ms → 1 fixed step, accumulator ~0, alpha ~0
    // Tick 16.66ms → no additional fixed step, accumulator ~16.66, alpha ~1
    const cbs = {
      earlyUpdate: vi.fn(),
      fixedUpdate: vi.fn(),
      update: vi.fn(),
      lateUpdate: vi.fn(),
      render: vi.fn(),
      endOfFrame: vi.fn(),
    };
    gameLoop.setCallbacks(cbs);
    gameLoop.start();

    // Tick almost exactly 2 * fixedTimestep - epsilon
    // This gives us 1 fixed step and accumulator near fixedTimestep
    const almostTwoSteps = gameLoop.fixedTimestep * 2 - 0.01;
    gameLoop.tick(almostTwoSteps);

    // alpha should be very close to 1
    const alpha = gameLoop.interpolationAlpha;
    expect(alpha).toBeGreaterThan(0.99);

    system.update(0);

    expect(transform.position.x).toBeCloseTo(100, 0);
    expect(transform.position.y).toBeCloseTo(200, 0);
    expect(transform.rotation).toBeCloseTo(2, 0);
  });

  it("interpolates rotation", () => {
    const { scene, context } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevRotation = 0;
    rb._currRotation = Math.PI;
    rb._prevPosition = Vec2.ZERO;
    rb._currPosition = Vec2.ZERO;

    // alpha = 0
    system.update(0);

    expect(transform.rotation).toBeCloseTo(0);
  });

  it("skips non-dynamic bodies", () => {
    const { scene, context } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    // Static body
    const entity = spawnEntityInScene(scene, "static");
    const transform = entity.add(new Transform({ position: new Vec2(50, 50) }));
    const rb = entity.add(new RigidBodyComponent({ type: "static" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 100);

    system.update(0);

    // Transform should NOT be interpolated for static bodies
    expect(transform.position.x).toBe(50);
    expect(transform.position.y).toBe(50);
  });

  it("skips kinematic bodies", () => {
    const { scene, context } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "kinematic");
    const transform = entity.add(new Transform({ position: new Vec2(75, 75) }));
    const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(200, 200);

    system.update(0);

    // Transform should NOT be interpolated for kinematic bodies
    expect(transform.position.x).toBe(75);
    expect(transform.position.y).toBe(75);
  });

  it("reads alpha from GameLoop.interpolationAlpha", () => {
    const { scene, context, gameLoop } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 0);

    // At start, alpha = 0
    expect(gameLoop.interpolationAlpha).toBe(0);

    system.update(0);
    expect(transform.position.x).toBeCloseTo(0);
  });

  it("handles empty scene gracefully", () => {
    const { context } = createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    expect(() => system.update(0)).not.toThrow();
  });
});
