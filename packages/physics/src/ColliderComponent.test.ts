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
    sleep() {}
    wakeUp() {}
  }

  class MockColliderDesc {
    _sensor = false;
    static cuboid() { return new MockColliderDesc(); }
    static ball() { return new MockColliderDesc(); }
    static capsule() { return new MockColliderDesc(); }
    static convexHull() { return new MockColliderDesc(); }
    setTranslation() { return this; }
    setRestitution() { return this; }
    setFriction() { return this; }
    setDensity() { return this; }
    setSensor(s: boolean) { this._sensor = s; return this; }
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

    createCollider(desc: MockColliderDesc, parent: MockRigidBody): MockCollider {
      const collider = new MockCollider();
      collider._sensor = desc._sensor;
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

    removeCollider(collider: MockCollider) {
      this._colliders.delete(collider.handle);
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
    ActiveCollisionTypes: { ALL: 60943 },
  },
}));

import { Transform, ErrorBoundaryKey } from "@yagejs/core";
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
    it("creates a collider with the correct body handle", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
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

    it("throws if no RigidBodyComponent exists", async () => {
      const { scene } = await createPhysicsTestContext();
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
    it("calls collision handlers when dispatched", async () => {
      const { scene } = await createPhysicsTestContext();
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

    it("supports multiple handlers", async () => {
      const { scene } = await createPhysicsTestContext();
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

    it("unsubscribe removes handler", async () => {
      const { scene } = await createPhysicsTestContext();
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

    it("a throwing collision handler rethrows, stopping later handlers in the same dispatch", async () => {
      const { scene, context } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      const calls: string[] = [];
      col.onCollision(() => calls.push("before"));
      col.onCollision(() => {
        throw new Error("boom");
      });
      col.onCollision(() => calls.push("after"));

      expect(() =>
        col._dispatchCollision({ other: entity, otherCollider: col, started: true }),
      ).toThrow("boom");

      expect(calls).toEqual(["before"]);

      const boundary = context.tryResolve(ErrorBoundaryKey)!;
      const errors = boundary.getCallbackErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        kind: "Collision handler",
        entity: "test",
        scene: "test-scene",
        error: "boom",
      });
    });
  });

  describe("onTrigger / _dispatchTrigger", () => {
    it("calls trigger handlers when dispatched", async () => {
      const { scene } = await createPhysicsTestContext();
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

    it("unsubscribe removes trigger handler", async () => {
      const { scene } = await createPhysicsTestContext();
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

    it("a throwing trigger handler rethrows and is reported once, even when registered twice", async () => {
      const { scene, context } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        }),
      );

      const handler = (): void => {
        throw new Error("door pad exploded");
      };
      // The handler array (unlike the Set-backed entity/scene listeners)
      // permits registering the same function twice. The first entry's throw
      // stops dispatch before the second entry runs.
      col.onTrigger(handler);
      col.onTrigger(handler);

      expect(() =>
        col._dispatchTrigger({ other: entity, otherCollider: col, entered: true }),
      ).toThrow("door pad exploded");

      const boundary = context.tryResolve(ErrorBoundaryKey)!;
      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]).toMatchObject({
        kind: "Trigger handler",
        scene: "test-scene",
      });
    });
  });

  describe("onDestroy", () => {
    it("clears all handlers", async () => {
      // Intentionally mix sensor/non-sensor channels on the same collider to
      // verify both handler arrays are cleared on destroy. Silence the
      // resulting dev mismatch warning so test output stays clean.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = await createPhysicsTestContext();
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
      warn.mockRestore();
    });

    it("removes the Rapier collider and its map entries, leaving the body intact", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );
      const colliderHandle = col._colliderHandle;

      expect(physicsWorld.colliderMap.has(colliderHandle)).toBe(true);

      // Remove only the collider — the sibling body stays alive.
      entity.remove(ColliderComponent);

      expect(physicsWorld.colliderMap.has(colliderHandle)).toBe(false);
      expect(physicsWorld._colliderComponents.has(colliderHandle)).toBe(false);
      expect(col._colliderHandle).toBe(-1);
      expect(physicsWorld.bodyMap.has(rb._bodyHandle)).toBe(true);
    });
  });

  describe("setSensor", () => {
    it("delegates to Rapier collider", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
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

    it("keeps config.sensor in sync so event routing and saves see the toggle", async () => {
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      col.setSensor(true);
      expect(col.config.sensor).toBe(true);
      expect(col.serialize().config.sensor).toBe(true);

      col.setSensor(false);
      expect(col.config.sensor).toBe(false);
    });

    it("buffers a pre-add toggle in config and applies it at collider creation", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const col = new ColliderComponent({
        shape: { type: "box", width: 10, height: 10 },
      });
      expect(() => col.setSensor(true)).not.toThrow();
      expect(col.config.sensor).toBe(true);

      entity.add(col);

      const rapierCollider = physicsWorld.getCollider(col._colliderHandle) as unknown as InstanceType<typeof mocks.MockCollider>;
      expect(rapierCollider?.isSensor()).toBe(true);
    });
  });

  describe("sensor/callback mismatch dev warning", () => {
    it("warns once when onCollision is registered on a sensor collider", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "trigger-zone");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        }),
      );

      col.onCollision(() => {});
      col.onCollision(() => {});

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes(
          "sensor: true colliders fire onTrigger, not onCollision",
        ),
      );
      expect(matching.length).toBe(1);
      expect(String(matching[0]?.[0])).toContain("trigger-zone");
      warn.mockRestore();
    });

    it("warns once when onTrigger is registered on a solid collider", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "wall");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      col.onTrigger(() => {});
      col.onTrigger(() => {});

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes(
          "solid colliders fire onCollision, not onTrigger",
        ),
      );
      expect(matching.length).toBe(1);
      warn.mockRestore();
    });

    it("does not warn when the handler matches the collider kind", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = await createPhysicsTestContext();

      const solid = spawnEntityInScene(scene, "solid");
      solid.add(new Transform());
      solid.add(new RigidBodyComponent({ type: "dynamic" }));
      const solidCol = solid.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );
      solidCol.onCollision(() => {});

      const sensor = spawnEntityInScene(scene, "sensor");
      sensor.add(new Transform());
      sensor.add(new RigidBodyComponent({ type: "dynamic" }));
      const sensorCol = sensor.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        }),
      );
      sensorCol.onTrigger(() => {});

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("ColliderComponent at"),
      );
      expect(matching.length).toBe(0);
      warn.mockRestore();
    });
  });

  describe("subclass pattern", () => {
    it("allows subclasses on the same entity (one component per class)", async () => {
      class GroundSensor extends ColliderComponent {}

      const { scene } = await createPhysicsTestContext();
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

  describe("restore ordering", () => {
    it("declares priorities matching the Transform → RigidBody → Collider onAdd() chain", () => {
      expect(Transform.restorePriority).toBeLessThan(
        RigidBodyComponent.restorePriority,
      );
      expect(RigidBodyComponent.restorePriority).toBeLessThan(
        ColliderComponent.restorePriority,
      );
    });
  });
});
