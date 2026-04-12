import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;
  let nextColliderHandle = 0;

  class MockRigidBodyDesc {
    _type: string;

    constructor(type: string) {
      this._type = type;
    }

    static dynamic() {
      return new MockRigidBodyDesc("dynamic");
    }
    static fixed() {
      return new MockRigidBodyDesc("fixed");
    }
    static kinematicPositionBased() {
      return new MockRigidBodyDesc("kinematic");
    }

    setLinearDamping() {
      return this;
    }
    setAngularDamping() {
      return this;
    }
    lockRotations() {
      return this;
    }
    setGravityScale() {
      return this;
    }
    setCcdEnabled() {
      return this;
    }
  }

  class MockCollider {
    handle: number;
    constructor() {
      this.handle = nextColliderHandle++;
    }
    isSensor() {
      return false;
    }
  }

  class MockRigidBody {
    handle: number;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _linvel = { x: 0, y: 0 };
    _angvel = 0;
    _colliders: MockCollider[] = [];

    addForceSpy = vi.fn();
    applyImpulseSpy = vi.fn();
    setLinvelSpy = vi.fn();
    setAngvelSpy = vi.fn();
    addTorqueSpy = vi.fn();
    setTranslationSpy = vi.fn();
    setRotationSpy = vi.fn();

    constructor() {
      this.handle = nextBodyHandle++;
    }

    translation() {
      return { ...this._translation };
    }
    rotation() {
      return this._rotation;
    }
    linvel() {
      return { ...this._linvel };
    }
    angvel() {
      return this._angvel;
    }
    setTranslation(t: { x: number; y: number }, _wake?: boolean) {
      this._translation = { ...t };
      this.setTranslationSpy(t, _wake);
    }
    setRotation(r: number, _wake?: boolean) {
      this._rotation = r;
      this.setRotationSpy(r, _wake);
    }
    setLinvel(v: { x: number; y: number }, _wake?: boolean) {
      this._linvel = { ...v };
      this.setLinvelSpy(v, _wake);
    }
    setAngvel(v: number, _wake?: boolean) {
      this._angvel = v;
      this.setAngvelSpy(v, _wake);
    }
    addForce(f: { x: number; y: number }, _wake?: boolean) {
      this.addForceSpy(f, _wake);
    }
    applyImpulse(i: { x: number; y: number }, _wake?: boolean) {
      this.applyImpulseSpy(i, _wake);
    }
    addTorque(t: number, _wake?: boolean) {
      this.addTorqueSpy(t, _wake);
    }
    numColliders() {
      return this._colliders.length;
    }
    collider(i: number) {
      return this._colliders[i];
    }
    isDynamic() {
      return true;
    }
    isFixed() {
      return false;
    }
    isKinematic() {
      return false;
    }
    sleep() {}
    wakeUp() {}
  }

  class MockColliderDesc {
    static cuboid() {
      return new MockColliderDesc();
    }
    static ball() {
      return new MockColliderDesc();
    }
    static capsule() {
      return new MockColliderDesc();
    }
    static convexHull() {
      return new MockColliderDesc();
    }
    setTranslation() {
      return this;
    }
    setRestitution() {
      return this;
    }
    setFriction() {
      return this;
    }
    setDensity() {
      return this;
    }
    setSensor() {
      return this;
    }
    setCollisionGroups() {
      return this;
    }
    setActiveEvents() {
      return this;
    }
    setActiveCollisionTypes() {
      return this;
    }
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

    createRigidBody(): MockRigidBody {
      const body = new MockRigidBody();
      this._bodies.set(body.handle, body);
      return body;
    }

    createCollider(
      _desc: MockColliderDesc,
      parent: MockRigidBody,
    ): MockCollider {
      const collider = new MockCollider();
      parent._colliders.push(collider);
      return collider;
    }

    getRigidBody(handle: number): MockRigidBody {
      const body = this._bodies.get(handle);
      if (!body) throw new Error(`No body ${handle}`);
      return body;
    }

    getCollider() {
      return undefined;
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
    mocks: {
      MockWorld,
      MockRigidBody,
      MockRigidBodyDesc,
      MockColliderDesc,
      MockEventQueue,
      resetHandles,
    },
  };
});

vi.mock("@dimforge/rapier2d", () => ({
  default: {
    World: mocks.MockWorld,
    RigidBodyDesc: mocks.MockRigidBodyDesc,
    ColliderDesc: mocks.MockColliderDesc,
    EventQueue: mocks.MockEventQueue,
    ActiveEvents: { COLLISION_EVENTS: 1, CONTACT_FORCE_EVENTS: 2 },
    ActiveCollisionTypes: { ALL: 60943 },
  },
}));

import { Transform, Vec2 } from "@yage/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { createPhysicsTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("RigidBodyComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  describe("onAdd", () => {
    it("creates a body and syncs Transform position", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._bodyHandle).not.toBe(-1);
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
      expect(rb._currPosition.x).toBe(100);
      expect(rb._currPosition.y).toBe(200);
    });

    it("sets initial rotation from Transform", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ rotation: Math.PI / 4 }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._currRotation).toBe(Math.PI / 4);
      expect(rb._prevRotation).toBe(Math.PI / 4);
    });

    it("creates static bodies", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "static" }));

      expect(rb.type).toBe("static");
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
    });

    it("creates kinematic bodies", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      expect(rb.type).toBe("kinematic");
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
    });
  });

  describe("onDestroy", () => {
    it("removes body from PhysicsWorld", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const handle = rb._bodyHandle;

      expect(physicsWorld.bodyMap.has(handle)).toBe(true);

      entity.remove(RigidBodyComponent);

      expect(physicsWorld.bodyMap.has(handle)).toBe(false);
      expect(rb._bodyHandle).toBe(-1);
    });
  });

  describe("applyForce", () => {
    it("converts force from pixels to meters and delegates to Rapier", () => {
      const { scene, physicsWorld } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyForce(new Vec2(100, 200));

      expect(body.addForceSpy).toHaveBeenCalledWith(
        { x: 2, y: 4 }, // 100/50, 200/50
        true,
      );
    });
  });

  describe("applyImpulse", () => {
    it("converts impulse from pixels to meters and delegates to Rapier", () => {
      const { scene, physicsWorld } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyImpulse(new Vec2(50, 100));

      expect(body.applyImpulseSpy).toHaveBeenCalledWith(
        { x: 1, y: 2 },
        true,
      );
    });
  });

  describe("setVelocity", () => {
    it("converts velocity from pixels to meters", () => {
      const { scene, physicsWorld } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setVelocity(new Vec2(150, 250));

      expect(body.setLinvelSpy).toHaveBeenCalledWith(
        { x: 3, y: 5 },
        true,
      );
    });
  });

  describe("getVelocity", () => {
    it("converts velocity from meters back to pixels", () => {
      const { scene, physicsWorld } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._linvel = { x: 3, y: 5 }; // meters

      const vel = rb.getVelocity();
      expect(vel.x).toBeCloseTo(150); // 3 * 50
      expect(vel.y).toBeCloseTo(250); // 5 * 50
    });
  });

  describe("applyTorque", () => {
    it("delegates to Rapier", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyTorque(5);

      expect(body.addTorqueSpy).toHaveBeenCalledWith(5, true);
    });
  });

  describe("setAngularVelocity / getAngularVelocity", () => {
    it("sets angular velocity", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setAngularVelocity(2.5);

      expect(body.setAngvelSpy).toHaveBeenCalledWith(2.5, true);
    });

    it("gets angular velocity", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._angvel = 3.14;

      expect(rb.getAngularVelocity()).toBeCloseTo(3.14);
    });
  });

  describe("setPosition", () => {
    it("teleports body and sets _teleported flag", () => {
      const { scene } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._teleported).toBe(false);

      rb.setPosition(200, 300);

      expect(rb._teleported).toBe(true);
      expect(rb._prevPosition.x).toBe(200);
      expect(rb._prevPosition.y).toBe(300);
      expect(rb._currPosition.x).toBe(200);
      expect(rb._currPosition.y).toBe(300);
    });

    it("converts position to meters for Rapier", () => {
      const { scene, physicsWorld } = createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setPosition(200, 300);

      expect(body.setTranslationSpy).toHaveBeenCalledWith(
        { x: 4, y: 6 }, // 200/50, 300/50
        true,
      );
    });
  });

  describe("interpolation state", () => {
    it("initializes prev and curr to Transform position", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(50, 75) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._prevPosition.equals(new Vec2(50, 75))).toBe(true);
      expect(rb._currPosition.equals(new Vec2(50, 75))).toBe(true);
    });

    it("_teleported starts as false", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._teleported).toBe(false);
    });
  });
});
