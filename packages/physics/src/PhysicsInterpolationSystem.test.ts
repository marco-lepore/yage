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
    setActiveCollisionTypes() { return this; }
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
    ActiveCollisionTypes: { ALL: 60943 },
  },
}));

import { Transform, Vec2, Phase } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { createPhysicsTestContext, createTestScene, spawnEntityInScene } from "./test-helpers.js";

describe("PhysicsInterpolationSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  it("has phase LateUpdate and priority 100", async () => {
    const system = new PhysicsInterpolationSystem();
    expect(system.phase).toBe(Phase.LateUpdate);
    expect(system.priority).toBe(100);
  });

  it("at alpha=0, transform equals prev position", async () => {
    const { scene, manager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(100, 100);
    rb._currPosition = new Vec2(200, 200);
    rb._prevRotation = 0;
    rb._currRotation = Math.PI;

    // alpha = 0 initially
    manager.getContext(scene)!.alphaRef.value = 0;
    system.update(0);

    expect(transform.position.x).toBeCloseTo(100);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(0);
  });

  it("at alpha=0.5, transform is midpoint", async () => {
    const { scene, manager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    manager.getContext(scene)!.alphaRef.value = 0.5;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(50);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(1);
  });

  it("at alpha=1, transform equals curr position", async () => {
    const { scene, manager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    manager.getContext(scene)!.alphaRef.value = 1;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(100, 0);
    expect(transform.position.y).toBeCloseTo(200, 0);
    expect(transform.rotation).toBeCloseTo(2, 0);
  });

  it("interpolates rotation", async () => {
    const { scene, manager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevRotation = 0;
    rb._currRotation = Math.PI;
    rb._prevPosition = Vec2.ZERO;
    rb._currPosition = Vec2.ZERO;

    manager.getContext(scene)!.alphaRef.value = 0;
    system.update(0);

    expect(transform.rotation).toBeCloseTo(0);
  });

  it("skips non-dynamic bodies", async () => {
    const { scene, context } = await createPhysicsTestContext();
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

  it("skips kinematic bodies", async () => {
    const { scene, context } = await createPhysicsTestContext();
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

  it("reads alpha from per-scene context", async () => {
    const { scene, manager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 0);

    const ctx = manager.getContext(scene)!;

    // At start, alpha = 0
    expect(ctx.alphaRef.value).toBe(0);
    system.update(0);
    expect(transform.position.x).toBeCloseTo(0);

    // Set alpha to 0.75 and re-run
    ctx.alphaRef.value = 0.75;
    system.update(0);
    expect(transform.position.x).toBeCloseTo(75);
  });

  it("uses per-scene alpha independently", async () => {
    const { scene, manager, sceneManager, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    // Scene 1: alpha=0.5
    const e1 = spawnEntityInScene(scene, "e1");
    const t1 = e1.add(new Transform());
    const rb1 = e1.add(new RigidBodyComponent({ type: "dynamic" }));
    rb1._prevPosition = new Vec2(0, 0);
    rb1._currPosition = new Vec2(100, 0);
    manager.getContext(scene)!.alphaRef.value = 0.5;

    // Scene 2: alpha=1.0
    const scene2 = await createTestScene(sceneManager, "scene2", { pauseBelow: false });
    manager.getOrCreateWorld(scene2);
    const e2 = spawnEntityInScene(scene2, "e2");
    const t2 = e2.add(new Transform());
    const rb2 = e2.add(new RigidBodyComponent({ type: "dynamic" }));
    rb2._prevPosition = new Vec2(0, 0);
    rb2._currPosition = new Vec2(100, 0);
    manager.getContext(scene2)!.alphaRef.value = 1.0;

    system.update(0);

    // Each scene uses its own alpha
    expect(t1.position.x).toBeCloseTo(50);
    expect(t2.position.x).toBeCloseTo(100);
  });

  it("handles empty scene gracefully", async () => {
    const { context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    expect(() => system.update(0)).not.toThrow();
  });
});
