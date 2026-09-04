import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;
  let nextColliderHandle = 0;

  class MockRigidBodyDesc {
    static dynamic() {
      return new MockRigidBodyDesc();
    }
    static fixed() {
      return new MockRigidBodyDesc();
    }
    static kinematicPositionBased() {
      return new MockRigidBodyDesc();
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
    _sensor = false;
    setSensorSpy = vi.fn();

    constructor() {
      this.handle = nextColliderHandle++;
    }

    _enabled = true;

    _shape: unknown = undefined;
    _rotationWrtParent = 0;
    _translationWrtParent = { x: 0, y: 0 };
    _parent: MockRigidBody | undefined;
    _activeHooks = 0;

    isSensor() {
      return this._sensor;
    }
    setSensor(s: boolean) {
      this._sensor = s;
      this.setSensorSpy(s);
    }
    setShape(shape: unknown) {
      this._shape = shape;
    }
    setRotationWrtParent(angle: number) {
      this._rotationWrtParent = angle;
    }
    setTranslationWrtParent(translation: { x: number; y: number }) {
      this._translationWrtParent = { ...translation };
    }
    parent() {
      return this._parent;
    }
    setEnabled(enabled: boolean) {
      this._enabled = enabled;
    }
    isEnabled() {
      return this._enabled;
    }
    _density = 1;
    _mass = 0;
    setDensity(d: number) {
      this._density = d;
    }
    mass() {
      return this._mass;
    }
    setMass(m: number) {
      this._mass = m;
    }
    setActiveHooks(hooks: number) {
      this._activeHooks = hooks;
    }
    activeHooks() {
      return this._activeHooks;
    }
    translation() {
      return { x: 0, y: 0 };
    }
    rotation() {
      return 0;
    }
  }

  class MockRigidBody {
    handle: number;
    _colliders: MockCollider[] = [];
    _translation = { x: 0, y: 0 };
    _rotation = 0;

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
      return { x: 0, y: 0 };
    }
    angvel() {
      return 0;
    }
    setTranslation(t: { x: number; y: number }) {
      this._translation = { ...t };
    }
    setRotation(r: number) {
      this._rotation = r;
    }
    setLinvel() {}
    setAngvel() {}
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    numColliders() {
      return this._colliders.length;
    }
    collider(i: number) {
      return this._colliders[i];
    }
    _bodyType: "dynamic" | "fixed" | "kinematic" = "dynamic";
    isDynamic() {
      return this._bodyType === "dynamic";
    }
    isFixed() {
      return this._bodyType === "fixed";
    }
    isKinematic() {
      return this._bodyType === "kinematic";
    }
    /** Rapier's `setBodyType` value → the mock's body kind. */
    setBodyType(type: number) {
      this._bodyType =
        type === 1 ? "fixed" : type === 2 ? "kinematic" : "dynamic";
    }
    setNextKinematicTranslation() {}
    setNextKinematicRotation() {}
    sleep() {}
    wakeUp() {}
    setEnabled() {}
    resetForces() {}
    resetTorques() {}
    _massRecomputes = 0;
    recomputeMassPropertiesFromColliders() {
      this._massRecomputes++;
    }
  }

  class MockColliderDesc {
    _sensor = false;
    _activeHooks = 0;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    // Mirrors Rapier's `ColliderDesc.shape`, in meters.
    shape: Record<string, unknown> = { kind: "none" };
    private static of(shape: Record<string, unknown>) {
      const desc = new MockColliderDesc();
      desc.shape = shape;
      return desc;
    }
    static cuboid(hx: number, hy: number) {
      return MockColliderDesc.of({ kind: "cuboid", hx, hy });
    }
    static ball(radius: number) {
      return MockColliderDesc.of({ kind: "ball", radius });
    }
    static capsule(halfHeight: number, radius: number) {
      return MockColliderDesc.of({ kind: "capsule", halfHeight, radius });
    }
    static convexHull() {
      return MockColliderDesc.of({ kind: "convexHull" });
    }
    setTranslation(x: number, y: number) {
      this._translation = { x, y };
      return this;
    }
    setRotation(rotation: number) {
      this._rotation = rotation;
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
    setSensor(s: boolean) {
      this._sensor = s;
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
    setActiveHooks(hooks: number) {
      this._activeHooks = hooks;
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
    _colliders = new Map<number, MockCollider>();
    lastStepHooks: unknown = undefined;

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step(_queue?: unknown, hooks?: unknown) {
      this.lastStepHooks = hooks;
    }

    createRigidBody(): MockRigidBody {
      const body = new MockRigidBody();
      this._bodies.set(body.handle, body);
      return body;
    }

    createCollider(
      desc: MockColliderDesc,
      parent: MockRigidBody,
    ): MockCollider {
      const collider = new MockCollider();
      collider._sensor = desc._sensor;
      collider._shape = desc.shape;
      collider._translationWrtParent = desc._translation;
      collider._rotationWrtParent = desc._rotation;
      collider._parent = parent;
      collider._activeHooks = desc._activeHooks;
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
    mocks: {
      MockWorld,
      MockRigidBody,
      MockRigidBodyDesc,
      MockCollider,
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
    QueryFilterFlags: { EXCLUDE_SENSORS: 8, EXCLUDE_SOLIDS: 16 },
    RigidBodyType: {
      Dynamic: 0,
      Fixed: 1,
      KinematicPositionBased: 2,
      KinematicVelocityBased: 3,
    },
    ActiveCollisionTypes: { ALL: 60943 },
    ActiveHooks: {
      NONE: 0,
      FILTER_CONTACT_PAIRS: 1,
      FILTER_INTERSECTION_PAIRS: 2,
    },
    SolverFlags: { EMPTY: 0, COMPUTE_IMPULSE: 1 },
  },
}));

import { Transform, ErrorBoundaryKey } from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { ColliderComponent } from "./ColliderComponent.js";
import {
  createPhysicsTestContext,
  spawnEntityInScene,
} from "./test-helpers.js";
import type { ColliderConfig, CollisionEvent, TriggerEvent } from "./types.js";

describe("ColliderComponent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  describe("constructor", () => {
    const shape = { type: "box", width: 10, height: 10 } as const;

    it("rejects non-finite or negative material numbers", () => {
      expect(() => new ColliderComponent({ shape, restitution: NaN })).toThrow(
        "ColliderComponent: restitution must be finite and >= 0, got NaN.",
      );
      expect(() => new ColliderComponent({ shape, friction: -1 })).toThrow(
        "ColliderComponent: friction must be finite and >= 0, got -1.",
      );
      expect(() => new ColliderComponent({ shape, density: -2 })).toThrow(
        "ColliderComponent: density must be finite and >= 0, got -2.",
      );
      expect(
        () => new ColliderComponent({ shape, contactSkin: Infinity }),
      ).toThrow(
        "ColliderComponent: contactSkin must be finite and >= 0, got Infinity.",
      );
      // An amplifying bounce is legal.
      expect(
        () => new ColliderComponent({ shape, restitution: 1.5 }),
      ).not.toThrow();
    });

    it("rejects a shape it cannot build, naming the field", () => {
      expect(
        () =>
          new ColliderComponent({
            shape: { type: "box", width: -20, height: 20 },
          }),
      ).toThrow(
        "ColliderComponent: shape.width must be finite and > 0, got -20.",
      );
      expect(
        () => new ColliderComponent({ shape: { type: "circle", radius: 0 } }),
      ).toThrow(
        "ColliderComponent: shape.radius must be finite and > 0, got 0.",
      );
      expect(
        () =>
          new ColliderComponent({
            shape: { type: "capsule", halfHeight: -20, radius: 10 },
          }),
      ).toThrow(
        "ColliderComponent: shape.halfHeight must be finite and >= 0, got -20.",
      );
      expect(
        () =>
          new ColliderComponent({
            shape: {
              type: "polygon",
              vertices: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
              ],
            },
          }),
      ).toThrow(
        "ColliderComponent: shape.vertices must have at least 3 vertices, got 2.",
      );
      // A capsule with no straight section is a circle; the tilemap
      // converter emits it for square capsule objects.
      expect(
        () =>
          new ColliderComponent({
            shape: { type: "capsule", halfHeight: 0, radius: 10 },
          }),
      ).not.toThrow();
    });

    it("rejects a zero or non-finite oneWay direction and a non-finite margin", () => {
      expect(
        () =>
          new ColliderComponent({
            shape,
            oneWay: { direction: { x: 0, y: 0 } },
          }),
      ).toThrow(
        "ColliderComponent: oneWay.direction must be a non-zero vector, got {x: 0, y: 0}.",
      );
      expect(
        () =>
          new ColliderComponent({
            shape,
            oneWay: { direction: { x: NaN, y: -1 } },
          }),
      ).toThrow(
        "ColliderComponent: oneWay.direction.x must be finite, got NaN.",
      );
      expect(
        () => new ColliderComponent({ shape, oneWay: { margin: NaN } }),
      ).toThrow("ColliderComponent: oneWay.margin must be finite, got NaN.");
    });
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

  describe("compound colliders", () => {
    async function setup() {
      const ctx = await createPhysicsTestContext();
      const entity = spawnEntityInScene(ctx.scene, "compound");
      entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          parts: [
            {
              shape: { type: "box", width: 20, height: 10 },
              offset: { x: -15, y: 0 },
            },
            {
              shape: { type: "circle", radius: 5 },
              offset: { x: 15, y: 0 },
              rotation: 0.25,
            },
          ],
        }),
      );
      const rapier = (handle: number) =>
        ctx.physicsWorld.getCollider(handle) as unknown as
          | InstanceType<typeof mocks.MockCollider>
          | undefined;
      return { ...ctx, entity, rb, col, rapier };
    }

    it("rejects an empty part list and mixed single/compound geometry", () => {
      expect(() => new ColliderComponent({ parts: [] })).toThrow(
        "ColliderComponent: parts must contain at least one collider.",
      );
      expect(
        () =>
          new ColliderComponent({
            shape: { type: "circle", radius: 5 },
            parts: [{ shape: { type: "circle", radius: 10 } }],
          } as unknown as ColliderConfig),
      ).toThrow("ColliderComponent: provide either shape or parts, not both.");
    });

    it("creates ordered shapes with their own offsets and rotations on one body", async () => {
      const { physicsWorld, rb, col, rapier } = await setup();

      expect(col.colliderCount).toBe(2);
      expect(col._colliderHandles).toHaveLength(2);
      expect(physicsWorld.getBody(rb._bodyHandle)?.numColliders()).toBe(2);
      expect(
        physicsWorld._colliderShapeIndices.get(col._colliderHandles[0]!),
      ).toBe(0);
      expect(
        physicsWorld._colliderShapeIndices.get(col._colliderHandles[1]!),
      ).toBe(1);
      expect(rapier(col._colliderHandles[0]!)?._shape).toEqual({
        kind: "cuboid",
        hx: 0.2,
        hy: 0.1,
      });
      expect(rapier(col._colliderHandles[0]!)?._translationWrtParent).toEqual({
        x: -0.3,
        y: 0,
      });
      expect(rapier(col._colliderHandles[1]!)?._shape).toEqual({
        kind: "ball",
        radius: 0.1,
      });
      expect(rapier(col._colliderHandles[1]!)?._rotationWrtParent).toBe(0.25);
    });

    it("applies lifecycle, sensor, and contact-filter changes to every part", async () => {
      const { entity, col, rapier } = await setup();

      entity.setActive(false);
      expect(
        col._colliderHandles.every((handle) => !rapier(handle)?.isEnabled()),
      ).toBe(true);
      entity.setActive(true);
      expect(
        col._colliderHandles.every((handle) => rapier(handle)?.isEnabled()),
      ).toBe(true);

      col.setContactFilter(() => true);
      expect(
        col._colliderHandles.every(
          (handle) => rapier(handle)?.activeHooks() === 1,
        ),
      ).toBe(true);

      const oldHandles = [...col._colliderHandles];
      col.setSensor(true);
      expect(col._colliderHandles).not.toEqual(oldHandles);
      expect(
        col._colliderHandles.every((handle) => rapier(handle)?.isSensor()),
      ).toBe(true);
      expect(
        col._colliderHandles.every(
          (handle) => rapier(handle)?.activeHooks() === 1,
        ),
      ).toBe(true);

      entity.remove(ColliderComponent);
      expect(col._colliderHandles).toEqual([]);
    });

    it("replaces only the selected shape and rejects a bad index before mutation", async () => {
      const { col, rapier } = await setup();
      const first = rapier(col._colliderHandles[0]!)?._shape;

      col.setShape({ type: "box", width: 40, height: 30 }, { index: 1 });

      expect(rapier(col._colliderHandles[0]!)?._shape).toBe(first);
      expect(rapier(col._colliderHandles[1]!)?._shape).toEqual({
        kind: "cuboid",
        hx: 0.4,
        hy: 0.3,
      });
      expect(col._part(1).shape).toEqual({
        type: "box",
        width: 40,
        height: 30,
      });

      expect(() =>
        col.setShape({ type: "circle", radius: 1 }, { index: 2 }),
      ).toThrow(
        "ColliderComponent.setShape: index must name an existing collider shape, got 2.",
      );
      expect(col._part(1).shape).toEqual({
        type: "box",
        width: 40,
        height: 30,
      });
    });

    it("deduplicates entities overlapping more than one part", async () => {
      const { physicsWorld, entity, col } = await setup();
      const other = spawnEntityInScene(entity.scene, "other");
      const query = vi
        .spyOn(physicsWorld, "queryOverlapping")
        .mockReturnValueOnce([other])
        .mockReturnValueOnce([other]);

      expect(col.getOverlapping()).toEqual([other]);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it("does not rebuild geometry while world scale is unchanged", async () => {
      const { physicsWorld, col } = await setup();
      const setShape = vi.spyOn(physicsWorld, "setColliderShape");

      col._syncScale();

      expect(setShape).not.toHaveBeenCalled();
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
        started: true,
      });
      expect(handler).toHaveBeenCalledOnce();

      unsub();

      col._dispatchCollision({
        other: entity,
        otherCollider: col,
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
        col._dispatchCollision({
          other: entity,
          otherCollider: col,
          selfShapeIndex: 0,
          otherShapeIndex: 0,
          started: true,
        }),
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
        entered: true,
      });
      expect(handler).toHaveBeenCalledOnce();

      unsub();

      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
        col._dispatchTrigger({
          other: entity,
          otherCollider: col,
          selfShapeIndex: 0,
          otherShapeIndex: 0,
          entered: true,
        }),
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
        selfShapeIndex: 0,
        otherShapeIndex: 0,
        started: true,
      });
      col._dispatchTrigger({
        other: entity,
        otherCollider: col,
        selfShapeIndex: 0,
        otherShapeIndex: 0,
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
    async function setup(sensor?: boolean) {
      const ctx = await createPhysicsTestContext();
      const entity = spawnEntityInScene(ctx.scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
          ...(sensor === undefined ? {} : { sensor }),
        }),
      );
      const rapier = (handle: number) =>
        ctx.physicsWorld.getCollider(handle) as unknown as
          | InstanceType<typeof mocks.MockCollider>
          | undefined;
      return { ...ctx, entity, col, rapier };
    }

    it("recreates the Rapier collider with the new flag, keeping the body's mass", async () => {
      const { physicsWorld, entity, col, rapier } = await setup();
      const oldHandle = col._colliderHandle;
      rapier(oldHandle)!._mass = 0.16;

      col.setSensor(true);

      const newHandle = col._colliderHandle;
      expect(newHandle).not.toBe(oldHandle);
      expect(rapier(oldHandle)).toBeUndefined();
      expect(physicsWorld.colliderMap.get(newHandle)).toBe(entity);
      expect(physicsWorld._colliderComponents.get(newHandle)).toBe(col);
      expect(physicsWorld.colliderMap.has(oldHandle)).toBe(false);
      expect(physicsWorld._colliderComponents.has(oldHandle)).toBe(false);
      expect(rapier(newHandle)!.isSensor()).toBe(true);
      expect(rapier(newHandle)!._mass).toBe(0.16);
      expect(rapier(newHandle)!.isEnabled()).toBe(true);
    });

    it("does nothing when the flag does not change", async () => {
      const { col } = await setup(true);
      const handle = col._colliderHandle;

      col.setSensor(true);

      expect(col._colliderHandle).toBe(handle);
    });

    it("keeps the new collider disabled while the entity is inactive", async () => {
      const { entity, col, rapier } = await setup();
      entity.setActive(false);

      col.setSensor(true);

      expect(rapier(col._colliderHandle)!.isEnabled()).toBe(false);
    });

    it("re-arms a contact filter on the new collider", async () => {
      const { physicsWorld, col, rapier } = await setup();
      const filter = () => true;
      col.setContactFilter(filter);

      col.setSensor(true);

      expect(rapier(col._colliderHandle)!.activeHooks()).toBe(1);
      expect(col._contactFilter).toBe(filter);
      // The world still passes hooks to the step for the new handle.
      physicsWorld.step(1 / 60);
      const world = (
        physicsWorld as unknown as {
          world: InstanceType<typeof mocks.MockWorld>;
        }
      ).world;
      expect(world.lastStepHooks).toBeDefined();
    });

    it("warns once per flip, only when a handler of the silenced kind exists", async () => {
      const { col } = await setup();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // No handlers: silent.
      col.setSensor(true);
      col.setSensor(false);
      expect(warn).not.toHaveBeenCalled();

      col.onCollision(() => {});
      col.setSensor(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain(
        "now a sensor; its 1 onCollision handler(s) will not fire",
      );

      // Flipping back silences no trigger handler.
      col.setSensor(false);
      expect(warn).toHaveBeenCalledTimes(1);

      col.onTrigger(() => {});
      warn.mockClear();
      col.setSensor(true);
      col.setSensor(false);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[1]![0]).toContain(
        "now solid; its 1 onTrigger handler(s) will not fire",
      );
      warn.mockRestore();
    });

    it("keeps config.sensor in sync with the live collider", async () => {
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

      const rapierCollider = physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as InstanceType<typeof mocks.MockCollider>;
      expect(rapierCollider?.isSensor()).toBe(true);
    });
  });

  describe("setShape", () => {
    async function setup() {
      const ctx = await createPhysicsTestContext();
      const entity = spawnEntityInScene(ctx.scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 20, height: 40 },
        }),
      );
      const rapierCollider = ctx.physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as InstanceType<typeof mocks.MockCollider>;
      return { ...ctx, entity, col, rapierCollider };
    }

    it("resizes the live collider without replacing it", async () => {
      const { col, rapierCollider } = await setup();
      const handleBefore = col._colliderHandle;

      col.setShape({ type: "box", width: 20, height: 20 });

      // 20x20 px at the default 50px/m -> 0.2m half-extents.
      expect(rapierCollider._shape).toEqual({
        kind: "cuboid",
        hx: 0.2,
        hy: 0.2,
      });
      expect(col._colliderHandle).toBe(handleBefore);
    });

    it("rejects a shape it cannot build and leaves the config and the live collider unchanged", async () => {
      const { col, rapierCollider } = await setup();
      col.setShape({ type: "box", width: 20, height: 20 });

      expect(() =>
        col.setShape({ type: "box", width: 20, height: -10 }),
      ).toThrow(
        "ColliderComponent.setShape: shape.height must be finite and > 0, got -10.",
      );
      expect(() =>
        col.setShape({ type: "box", width: 10, height: 10, borderRadius: 20 }),
      ).toThrow(
        "ColliderComponent.setShape: shape.borderRadius must be finite, >= 0 and smaller than half the shorter side, got 20.",
      );

      expect(col._part(0).shape).toEqual({
        type: "box",
        width: 20,
        height: 20,
      });
      expect(rapierCollider._shape).toEqual({
        kind: "cuboid",
        hx: 0.2,
        hy: 0.2,
      });
    });

    it("keeps collision subscriptions across the swap", async () => {
      const { col, scene } = await setup();
      const handler = vi.fn();
      col.onCollision(handler);

      col.setShape({ type: "box", width: 20, height: 20 });

      const other = spawnEntityInScene(scene, "other");
      col._dispatchCollision({
        other,
        otherCollider: col,
        selfShapeIndex: 0,
        otherShapeIndex: 0,
        started: true,
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("keeps config.shape in sync with the live collider", async () => {
      const { col } = await setup();

      col.setShape({ type: "circle", radius: 8 });

      expect(col._part(0).shape).toEqual({ type: "circle", radius: 8 });
    });

    it("keeps the body's mass, so a crouch does not change knockback", async () => {
      const { col, rapierCollider } = await setup();
      const body = rapierCollider.parent()!;
      // Enabling the component already summed the body once.
      const recomputesAfterSetup = body._massRecomputes;

      col.setShape({ type: "box", width: 20, height: 20 });

      expect(body._massRecomputes).toBe(recomputesAfterSetup);
    });

    it("recomputes mass from the new shape when asked", async () => {
      const { col, rapierCollider } = await setup();
      const body = rapierCollider.parent()!;
      const recomputesAfterSetup = body._massRecomputes;

      col.setShape(
        { type: "box", width: 40, height: 80 },
        { recomputeMass: true },
      );

      expect(body._massRecomputes).toBe(recomputesAfterSetup + 1);
    });

    it("buffers a pre-add swap in config and applies it at collider creation", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const col = new ColliderComponent({
        shape: { type: "box", width: 20, height: 40 },
      });
      expect(() => col.setShape({ type: "circle", radius: 8 })).not.toThrow();
      expect(col._part(0).shape).toEqual({ type: "circle", radius: 8 });

      entity.add(col);

      const rapierCollider = physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as InstanceType<typeof mocks.MockCollider>;
      expect(rapierCollider._shape).toEqual({ kind: "ball", radius: 0.16 });
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

  describe("activeness hooks", () => {
    it("leaves the collider disabled when added to a dormant entity", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "test");
      entity.setActive(false);
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );

      // Rapier creates a collider enabled and no hook fires on add for a
      // dormant entity, so it would otherwise stay in the simulation.
      const collider = physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as { isEnabled(): boolean };
      expect(collider.isEnabled()).toBe(false);

      entity.setActive(true);
      expect(collider.isEnabled()).toBe(true);
    });
  });

  describe("contact filter wiring", () => {
    function addOneWayCollider(scene: Scene) {
      const entity = spawnEntityInScene(scene, "platform");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "static" }));
      return entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 96, height: 8 },
          oneWay: { direction: { x: 0, y: -1 } },
        }),
      );
    }

    it("installs the one-way preset filter at construction", () => {
      const col = new ColliderComponent({
        shape: { type: "box", width: 96, height: 8 },
        oneWay: {},
      });
      expect(col._contactFilter).not.toBeNull();
    });

    it("arms Rapier's contact-pair hook at collider creation", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const col = addOneWayCollider(scene);

      const collider = physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as { activeHooks(): number };
      expect(collider.activeHooks()).toBe(1); // FILTER_CONTACT_PAIRS
    });

    it("flips the hook flag when a filter is set or cleared at runtime", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "wall");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "static" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );
      const collider = physicsWorld.getCollider(
        col._colliderHandle,
      ) as unknown as { activeHooks(): number };

      expect(collider.activeHooks()).toBe(0);
      col.setContactFilter(() => true);
      expect(collider.activeHooks()).toBe(1);
      col.setContactFilter(null);
      expect(collider.activeHooks()).toBe(0);
    });

    it("passes hooks to the step only while a filter is registered", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const world = (
        physicsWorld as unknown as { world: { lastStepHooks: unknown } }
      ).world;

      physicsWorld.step(1 / 60);
      expect(world.lastStepHooks).toBeUndefined();

      const col = addOneWayCollider(scene);
      physicsWorld.step(1 / 60);
      expect(world.lastStepHooks).toBeDefined();

      col.setContactFilter(null);
      physicsWorld.step(1 / 60);
      expect(world.lastStepHooks).toBeUndefined();
    });

    it("reports a throwing filter once, re-armed by a new filter", async () => {
      const { scene, context } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "wall");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "static" }));
      const col = entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );
      const boundary = context.resolve(ErrorBoundaryKey);
      const candidate = {} as Parameters<typeof col._evaluateContactFilter>[0];

      col.setContactFilter(() => {
        throw new Error("boom");
      });
      expect(col._evaluateContactFilter(candidate)).toBe(true);
      expect(col._evaluateContactFilter(candidate)).toBe(true);
      expect(boundary.getCallbackErrors().length).toBe(1);

      col.setContactFilter(() => {
        throw new Error("boom again");
      });
      expect(col._evaluateContactFilter(candidate)).toBe(true);
      expect(boundary.getCallbackErrors().length).toBe(2);
    });

    it("warns when oneWay is combined with sensor", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { scene } = await createPhysicsTestContext();
      const entity = spawnEntityInScene(scene, "ghost-platform");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "static" }));
      entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 96, height: 8 },
          sensor: true,
          oneWay: {},
        }),
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("oneWay has no effect on a sensor"),
      );
      expect(matching.length).toBe(1);
      warn.mockRestore();
    });
  });

  describe("dropThrough", () => {
    function addRider(scene: Scene) {
      const entity = spawnEntityInScene(scene, "rider");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      return entity.add(
        new ColliderComponent({
          shape: { type: "box", width: 10, height: 10 },
        }),
      );
    }

    it("opens a window measured in simulated time and expires it", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const col = addRider(scene);

      col.dropThrough(0.1);
      expect(col.isDroppingThrough).toBe(true);

      for (let i = 0; i < 5; i++) physicsWorld.step(1 / 60);
      expect(col.isDroppingThrough).toBe(true);
      for (let i = 0; i < 2; i++) physicsWorld.step(1 / 60);
      expect(col.isDroppingThrough).toBe(false);
    });

    it("supports being called before the component is added", async () => {
      const { scene, physicsWorld } = await createPhysicsTestContext();
      const col = new ColliderComponent({
        shape: { type: "box", width: 10, height: 10 },
      });
      col.dropThrough(0.5);
      expect(col.isDroppingThrough).toBe(false);

      const entity = spawnEntityInScene(scene, "rider");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));
      entity.add(col);
      expect(col.isDroppingThrough).toBe(true);

      for (let i = 0; i < 31; i++) physicsWorld.step(1 / 60);
      expect(col.isDroppingThrough).toBe(false);
    });

    it("clears the window when the entity goes dormant", async () => {
      const { scene } = await createPhysicsTestContext();
      const col = addRider(scene);

      col.dropThrough(60);
      expect(col.isDroppingThrough).toBe(true);
      col.entity.setActive(false);
      col.entity.setActive(true);
      expect(col.isDroppingThrough).toBe(false);
    });
  });
});

describe("dispatch iteration safety", () => {
  it("a handler that unsubscribes itself does not skip the next handler", async () => {
    const { scene } = await createPhysicsTestContext();
    const e = scene.spawn("e");
    e.add(new Transform());
    e.add(new RigidBodyComponent({ type: "dynamic" }));
    const col = e.add(
      new ColliderComponent({ shape: { type: "box", width: 10, height: 10 } }),
    );

    const seen: string[] = [];
    const unsub = col.onCollision(() => {
      seen.push("first");
      unsub();
    });
    col.onCollision(() => seen.push("second"));

    col._dispatchCollision({} as never);

    expect(seen).toEqual(["first", "second"]);
  });
});
