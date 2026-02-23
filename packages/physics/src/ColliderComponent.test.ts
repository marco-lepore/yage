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
    _sensor = false;
    setSensorSpy = vi.fn();

    constructor() {
      this.handle = nextColliderHandle++;
    }

    isSensor() { return this._sensor; }
    setSensor(s: boolean) { this._sensor = s; this.setSensorSpy(s); }
    setShape() {}
  }

  class MockRigidBody {
    handle: number;
    _colliders: MockCollider[] = [];
    _translation = { x: 0, y: 0 };
    _rotation = 0;

    constructor() {
      this.handle = nextBodyHandle++;
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
    numColliders() { return this._colliders.length; }
    collider(i: number) { return this._colliders[i]; }
    isDynamic() { return true; }
    isFixed() { return false; }
    isKinematic() { return false; }
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

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {}

    createRigidBody(): MockRigidBody {
      const body = new MockRigidBody();
      this._bodies.set(body.handle, body);
      return body;
    }

    createCollider(_desc: MockColliderDesc, parent: MockRigidBody): MockCollider {
      const collider = new MockCollider();
      parent._colliders.push(collider);
      this._colliders.set(collider.handle, collider);
      return collider;
    }

    getRigidBody(handle: number): MockRigidBody {
      const body = this._bodies.get(handle);
      if (!body) throw new Error(`No body ${handle}`);
      return body;
    }

    getCollider(handle: number): MockCollider | undefined {
      return this._colliders.get(handle);
    }

    removeRigidBody(body: MockRigidBody) {
      this._bodies.delete(body.handle);
      for (const c of body._colliders) this._colliders.delete(c.handle);
    }

    free() {}
  }

  function resetHandles() {
    nextBodyHandle = 0;
    nextColliderHandle = 0;
  }

  return {
    mocks: { MockWorld, MockRigidBody, MockRigidBodyDesc, MockCollider, MockColliderDesc, MockEventQueue, resetHandles },
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

import { Transform } from "@yage/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import { createPhysicsTestContext, spawnEntityInScene } from "./test-helpers.js";
import type { CollisionEvent, TriggerEvent } from "./types.js";

describe("ColliderComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  describe("onAdd", () => {
    it("creates a collider with the correct body handle", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 50, height: 30 },
        }),
      );

      expect(col._colliderHandle).not.toBe(-1);
      expect(physicsWorld.colliderMap.get(col._colliderHandle)).toBe(entity);
    });

    it("throws if no RigidBodyComponent exists", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());

      expect(() =>
        entity.add(
          new ColliderComponent({
            shape: { type: "box", width: 10, height: 10 },
          }),
        ),
      ).toThrow();
    });
  });

  describe("onCollision / _dispatchCollision", () => {
    it("calls collision handlers when dispatched", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      const received: CollisionEvent[] = [];
      col.onCollision((e) => received.push(e));

      const otherEntity = spawnEntityInScene(scene, "other");
      otherEntity.add(new Transform());
      otherEntity.add(new RigidBodyComponent({ type: "dynamic" }));
      const otherCol = otherEntity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      col._dispatchCollision({
        other: otherEntity,
        otherCollider: otherCol,
        started: true,
      });

      expect(received).toHaveLength(1);
      const ev = received[0] as CollisionEvent;
      expect(ev.other).toBe(otherEntity);
      expect(ev.started).toBe(true);
    });

    it("supports multiple handlers", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      col.onCollision(handler1);
      col.onCollision(handler2);

      col._dispatchCollision({
        other: entity,
        otherCollider: col,
        started: true,
      });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it("unsubscribe removes handler", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      const handler = vi.fn();
      const unsub = col.onCollision(handler);

      col._dispatchCollision({
        other: entity,
        otherCollider: col,
        started: true,
      });
      expect(handler).toHaveBeenCalledOnce();

      unsub();

      col._dispatchCollision({
        other: entity,
        otherCollider: col,
        started: false,
      });
      expect(handler).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe("onTrigger / _dispatchTrigger", () => {
    it("calls trigger handlers when dispatched", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        }),
      );

      const received: TriggerEvent[] = [];
      col.onTrigger((e) => received.push(e));

      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        entered: true,
      });

      expect(received).toHaveLength(1);
      const ev = received[0] as TriggerEvent;
      expect(ev.entered).toBe(true);
    });

    it("unsubscribe removes trigger handler", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        }),
      );

      const handler = vi.fn();
      const unsub = col.onTrigger(handler);

      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        entered: true,
      });
      expect(handler).toHaveBeenCalledOnce();

      unsub();

      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        entered: false,
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("onDestroy", () => {
    it("clears all handlers", () => {
      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      const handler = vi.fn();
      const triggerHandler = vi.fn();
      col.onCollision(handler);
      col.onTrigger(triggerHandler);

      // Remove the component, which triggers onDestroy
      entity.remove(ColliderComponent);

      // Dispatching should not call handlers after destroy
      col._dispatchCollision({
        other: entity,
        otherCollider: col,
        started: true,
      });
      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        entered: true,
      });

      expect(handler).not.toHaveBeenCalled();
      expect(triggerHandler).not.toHaveBeenCalled();
    });
  });

  describe("setSensor", () => {
    it("delegates to Rapier collider", () => {
      const { scene, physicsWorld } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      col.setSensor(true);

      const rapierCollider = physicsWorld.getCollider(col._colliderHandle) as unknown as InstanceType<typeof mocks.MockCollider>;
      expect(rapierCollider?.setSensorSpy).toHaveBeenCalledWith(true);
    });
  });

  describe("subclass pattern", () => {
    it("allows subclasses on the same entity (one component per class)", () => {
      class GroundSensor extends ColliderComponent {}

      const { scene } = createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const mainCol = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 32, height: 32 },
        }),
      );

      const sensor = entity.add(
        new GroundSensor({
          shape: { type: "box", width: 30, height: 4 },
          offset: { x: 0, y: 16 },
          sensor: true,
        }),
      );

      expect(mainCol._colliderHandle).not.toBe(sensor._colliderHandle);
      expect(entity.has(ColliderComponent)).toBe(true);
      expect(entity.has(GroundSensor)).toBe(true);
    });
  });
});
