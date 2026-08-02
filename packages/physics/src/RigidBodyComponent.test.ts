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
    _gravityScale = 1;
    setGravityScale(s: number) {
      this._gravityScale = s;
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
    setEnabled() {}
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
    wakeUpSpy = vi.fn();
    resetForcesSpy = vi.fn();
    resetTorquesSpy = vi.fn();
    _enabled = true;

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
    _gravityScale = 1;
    setGravityScaleSpy = vi.fn();
    gravityScale() {
      return this._gravityScale;
    }
    setGravityScale(s: number, _wake?: boolean) {
      this._gravityScale = s;
      this.setGravityScaleSpy(s, _wake);
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
    wakeUp() {
      this.wakeUpSpy();
    }
    setEnabled(enabled: boolean) {
      this._enabled = enabled;
    }
    isEnabled() {
      return this._enabled;
    }
    resetForces() {
      this.resetForcesSpy();
    }
    resetTorques() {
      this.resetTorquesSpy();
    }
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

    createRigidBody(desc: MockRigidBodyDesc): MockRigidBody {
      const body = new MockRigidBody();
      body._gravityScale = desc._gravityScale;
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

import { Transform, Vec2 } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";

describe("RigidBodyComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  describe("onAdd", () => {
    it("creates a body and syncs Transform position", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._bodyHandle).not.toBe(-1);
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
      expect(rb._currPosition.x).toBe(100);
      expect(rb._currPosition.y).toBe(200);
    });

    it("sets initial rotation from Transform", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ rotation: Math.PI / 4 }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._currRotation).toBe(Math.PI / 4);
      expect(rb._prevRotation).toBe(Math.PI / 4);
    });

    it("creates static bodies", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "static" }));

      expect(rb.type).toBe("static");
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
    });

    it("creates kinematic bodies", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      expect(rb.type).toBe("kinematic");
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
    });
  });

  describe("onDestroy", () => {
    it("removes body from PhysicsWorld", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
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
    it("converts force from pixels to meters and delegates to Rapier", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyForce(new Vec2(100, 200));

      expect(body.addForceSpy).toHaveBeenCalledWith(
        { x: 2, y: 4 }, // 100/50, 200/50
        true,
      );
    });
  });

  describe("applyImpulse", () => {
    it("converts impulse from pixels to meters and delegates to Rapier", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyImpulse(new Vec2(50, 100));

      expect(body.applyImpulseSpy).toHaveBeenCalledWith({ x: 1, y: 2 }, true);
    });
  });

  describe("setVelocity", () => {
    it("converts velocity from pixels to meters", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setVelocity(new Vec2(150, 250));

      expect(body.setLinvelSpy).toHaveBeenCalledWith({ x: 3, y: 5 }, true);
    });
  });

  describe("getVelocity", () => {
    it("converts velocity from meters back to pixels", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._linvel = { x: 3, y: 5 }; // meters

      const vel = rb.getVelocity();
      expect(vel.x).toBeCloseTo(150); // 3 * 50
      expect(vel.y).toBeCloseTo(250); // 5 * 50
    });
  });

  describe("velocityX / velocityY / speed / speedSquared", () => {
    it("reads each scalar in pixels/s without allocating a Vec2", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._linvel = { x: 3, y: 4 }; // meters -> 150, 200 px/s

      expect(rb.velocityX).toBeCloseTo(150);
      expect(rb.velocityY).toBeCloseTo(200);
      expect(rb.speed).toBeCloseTo(250); // 3-4-5 triangle scaled by 50
      expect(rb.speedSquared).toBeCloseTo(62500); // 250^2
    });

    it("returns 0 when the body is gone", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      entity.remove(RigidBodyComponent);

      expect(rb.velocityX).toBe(0);
      expect(rb.velocityY).toBe(0);
      expect(rb.speed).toBe(0);
      expect(rb.speedSquared).toBe(0);
    });
  });

  describe("applyTorque", () => {
    it("delegates to Rapier", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.applyTorque(5);

      expect(body.addTorqueSpy).toHaveBeenCalledWith(5, true);
    });
  });

  describe("setAngularVelocity / getAngularVelocity", () => {
    it("sets angular velocity", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setAngularVelocity(2.5);

      expect(body.setAngvelSpy).toHaveBeenCalledWith(2.5, true);
    });

    it("gets angular velocity", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      body._angvel = 3.14;

      expect(rb.getAngularVelocity()).toBeCloseTo(3.14);
    });
  });

  describe("setGravityScale / gravityScale", () => {
    it("applies the scale to the live body", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setGravityScale(2.5);

      expect(body.setGravityScaleSpy).toHaveBeenCalledWith(2.5, true);
      expect(rb.gravityScale).toBe(2.5);
    });

    it("defaults to 1 when never set", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb.gravityScale).toBe(1);
    });

    it("keeps config in sync so a save captures the live scale", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(
        new RigidBodyComponent({ type: "dynamic", gravityScale: 1 }),
      );

      rb.setGravityScale(0);

      expect(rb.serialize().gravityScale).toBe(0);
    });

    it("buffers a pre-add scale in config and applies it at body creation", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());

      const rb = new RigidBodyComponent({ type: "dynamic" });
      expect(() => rb.setGravityScale(3)).not.toThrow();
      expect(rb.gravityScale).toBe(3);

      entity.add(rb);

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      expect(body._gravityScale).toBe(3);
    });
  });

  describe("setPosition", () => {
    it("teleports the body, collapsing prev and curr so no blend survives", async () => {
      const { scene } = await createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      rb.setPosition(200, 300);

      expect(rb._prevPosition.x).toBe(200);
      expect(rb._prevPosition.y).toBe(300);
      expect(rb._currPosition.x).toBe(200);
      expect(rb._currPosition.y).toBe(300);
    });

    it("converts position to meters for Rapier", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setPosition(200, 300);

      expect(body.setTranslationSpy).toHaveBeenCalledWith(
        { x: 4, y: 6 }, // 200/50, 300/50
        true,
      );
    });

    it("moves the kinematic step target with the teleport", async () => {
      const { scene } = await createPhysicsTestContext({ pixelsPerMeter: 50 });
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(50, 50) }));
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      rb.setPosition(200, 300);

      // Without this, the next step would drive the body back toward the
      // stale pre-teleport target.
      expect(rb._kinematicTargetPosition.x).toBe(200);
      expect(rb._kinematicTargetPosition.y).toBe(300);
    });

    it("drops a Transform write superseded by a kinematic setPosition", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      const transform = entity.add(
        new Transform({ position: new Vec2(100, 200) }),
      );
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      // Authored move first, authoritative teleport second: the later call
      // wins, so the earlier write must not resurface as a step target.
      transform.setPosition(500, 500);
      rb.setPosition(300, 50);

      expect(rb._hasPendingTargetPosition()).toBe(false);
      rb._capturePendingTarget();
      expect(rb._kinematicTargetPosition.x).toBe(300);
      expect(rb._kinematicTargetPosition.y).toBe(50);
    });
  });

  describe("setRotation", () => {
    it("teleports the body rotation, collapsing prev and curr", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      rb.setRotation(1.25);

      expect(body.setRotationSpy).toHaveBeenLastCalledWith(1.25, true);
      expect(rb._prevRotation).toBe(1.25);
      expect(rb._currRotation).toBe(1.25);
      expect(rb._kinematicTargetRotation).toBe(1.25);
    });
  });

  describe("interpolation state", () => {
    it("initializes prev and curr to Transform position", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(50, 75) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb._prevPosition.equals(new Vec2(50, 75))).toBe(true);
      expect(rb._currPosition.equals(new Vec2(50, 75))).toBe(true);
    });

    it("seeds the kinematic step target from the spawn Transform", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(50, 75), rotation: 0.5 }));
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      expect(rb._kinematicTargetPosition.equals(new Vec2(50, 75))).toBe(true);
      expect(rb._kinematicTargetRotation).toBe(0.5);
    });
  });
  describe("activeness hooks", () => {
    it("leaves the body disabled when added to a dormant entity", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.setActive(false);
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      // Rapier creates a body enabled and no hook fires on add for a dormant
      // entity, so the body would otherwise keep simulating.
      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as {
        isEnabled(): boolean;
      };
      expect(body.isEnabled()).toBe(false);

      entity.setActive(true);
      expect(body.isEnabled()).toBe(true);
    });

    it("clears momentum and disables the body when the entity goes dormant", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: -120 });
      rb.setAngularVelocity(4);

      const body = physicsWorld.getBody(rb._bodyHandle) as unknown as {
        isEnabled(): boolean;
        resetForcesSpy: { mock: { calls: unknown[] } };
        resetTorquesSpy: { mock: { calls: unknown[] } };
        wakeUpSpy: { mock: { calls: unknown[] } };
      };

      entity.setActive(false);

      expect(body.isEnabled()).toBe(false);
      expect(rb.getVelocity().x).toBe(0);
      expect(rb.getVelocity().y).toBe(0);
      expect(rb.getAngularVelocity()).toBe(0);
      expect(body.resetForcesSpy.mock.calls).toHaveLength(1);
      expect(body.resetTorquesSpy.mock.calls).toHaveLength(1);

      // `onEnable` also ran when the component was added, so this is the
      // second wake.
      entity.setActive(true);
      expect(body.isEnabled()).toBe(true);
      expect(body.wakeUpSpy.mock.calls).toHaveLength(2);
    });

    it("keeps a setPosition made while dormant", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      entity.setActive(false);
      // The documented reuse recipe: reposition through the body, because
      // physics owns a dynamic body's transform.
      rb.setPosition(700, 40);
      entity.setActive(true);

      expect(rb._currPosition.x).toBe(700);
      expect(rb._currPosition.y).toBe(40);
      expect(rb._prevPosition.x).toBe(700);
    });

    it("reactivates a kinematic body at a Transform pose written while dormant", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext({
        pixelsPerMeter: 50,
      });
      const entity = spawnEntityInScene(scene, "test");
      const transform = entity.add(
        new Transform({ position: new Vec2(100, 200) }),
      );
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      entity.setActive(false);
      // Repositioning through the Transform is the documented way to move a
      // kinematic body; on reactivation this must be a teleport, not a
      // glide from where the body slept.
      transform.setPosition(700, 40);
      entity.setActive(true);

      expect(rb._prevPosition.x).toBe(700);
      expect(rb._prevPosition.y).toBe(40);
      expect(rb._currPosition.x).toBe(700);
      expect(rb._kinematicTargetPosition.x).toBe(700);
      const body = physicsWorld.getBody(
        rb._bodyHandle,
      ) as unknown as InstanceType<typeof mocks.MockRigidBody>;
      expect(body._translation.x).toBeCloseTo(14); // 700/50
      expect(body._translation.y).toBeCloseTo(0.8); // 40/50
    });

    it("keeps a kinematic setPosition made while dormant", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

      entity.setActive(false);
      rb.setPosition(300, 50);
      entity.setActive(true);

      // The stale Transform (still at the spawn pose) must not win over the
      // teleport: the target keeps pointing at the setPosition destination.
      expect(rb._prevPosition.x).toBe(300);
      expect(rb._currPosition.x).toBe(300);
      expect(rb._kinematicTargetPosition.x).toBe(300);
      expect(rb._kinematicTargetPosition.y).toBe(50);
    });

    it("snaps interpolation to the body pose on reactivation", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform({ position: new Vec2(100, 200) }));
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      entity.setActive(false);
      // Stale interpolation state from the life before, as a physics step
      // would have left it.
      rb._prevPosition = new Vec2(-500, -500);
      entity.setActive(true);

      expect(rb._prevPosition.x).toBe(rb._currPosition.x);
      expect(rb._prevPosition.y).toBe(rb._currPosition.y);
      expect(rb._currPosition.x).toBe(100);
    });
  });
});
