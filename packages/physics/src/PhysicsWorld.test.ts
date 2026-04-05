import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;
  let nextColliderHandle = 0;

  class MockRigidBodyDesc {
    linearDamping = 0;
    angularDamping = 0;
    _locked = false;
    _gravityScale = 1;
    _ccdEnabled = false;
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

    setLinearDamping(d: number) {
      this.linearDamping = d;
      return this;
    }
    setAngularDamping(d: number) {
      this.angularDamping = d;
      return this;
    }
    lockRotations() {
      this._locked = true;
      return this;
    }
    setGravityScale(s: number) {
      this._gravityScale = s;
      return this;
    }
    setCcdEnabled(e: boolean) {
      this._ccdEnabled = e;
      return this;
    }
  }

  class MockCollider {
    handle: number;
    _sensor = false;

    constructor() {
      this.handle = nextColliderHandle++;
    }

    isSensor() {
      return this._sensor;
    }
    setSensor(s: boolean) {
      this._sensor = s;
    }
    setShape() {}
  }

  class MockRigidBody {
    handle: number;
    _colliders: MockCollider[] = [];
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _linvel = { x: 0, y: 0 };
    _angvel = 0;

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
    setTranslation(t: { x: number; y: number }) {
      this._translation = { ...t };
    }
    setRotation(r: number) {
      this._rotation = r;
    }
    setLinvel(v: { x: number; y: number }) {
      this._linvel = { ...v };
    }
    setAngvel(v: number) {
      this._angvel = v;
    }
    setNextKinematicTranslation(t: { x: number; y: number }) {
      this._translation = { ...t };
    }
    setNextKinematicRotation(r: number) {
      this._rotation = r;
    }
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    applyTorqueImpulse() {}
    isFixed() {
      return false;
    }
    isKinematic() {
      return false;
    }
    isDynamic() {
      return true;
    }
    numColliders() {
      return this._colliders.length;
    }
    collider(i: number) {
      return this._colliders[i];
    }
    sleep() {}
    wakeUp() {}
  }

  class MockColliderDesc {
    _translation = { x: 0, y: 0 };
    _restitution = 0;
    _friction = 0.5;
    _density = 1;
    _sensor = false;
    _collisionGroups = 0;
    _activeEvents = 0;

    static cuboid() {
      return new MockColliderDesc();
    }
    static ball() {
      return new MockColliderDesc();
    }
    static capsule() {
      return new MockColliderDesc();
    }
    static convexHull(): MockColliderDesc | null {
      return new MockColliderDesc();
    }

    setTranslation(x: number, y: number) {
      this._translation = { x, y };
      return this;
    }
    setRestitution(r: number) {
      this._restitution = r;
      return this;
    }
    setFriction(f: number) {
      this._friction = f;
      return this;
    }
    setDensity(d: number) {
      this._density = d;
      return this;
    }
    setSensor(s: boolean) {
      this._sensor = s;
      return this;
    }
    setCollisionGroups(g: number) {
      this._collisionGroups = g;
      return this;
    }
    setActiveEvents(e: number) {
      this._activeEvents = e;
      return this;
    }
  }

  type DrainCallback = (h1: number, h2: number, started: boolean) => void;

  class MockEventQueue {
    _events: Array<[number, number, boolean]> = [];

    _autoDrain = false;

    drainCollisionEvents(f: DrainCallback) {
      for (const [h1, h2, started] of this._events) {
        f(h1, h2, started);
      }
      this._events = [];
    }

    free() {}
  }

  class MockWorld {
    gravity = { x: 0, y: 0 };
    timestep = 0;
    _bodies = new Map<number, MockRigidBody>();
    _colliders = new Map<number, MockCollider>();
    _stepCalled = false;

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {
      this._stepCalled = true;
    }

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
      this._colliders.set(collider.handle, collider);
      return collider;
    }

    getRigidBody(handle: number): MockRigidBody {
      const body = this._bodies.get(handle);
      if (!body) throw new Error(`No body with handle ${handle}`);
      return body;
    }

    getCollider(handle: number): MockCollider {
      const collider = this._colliders.get(handle);
      if (!collider) throw new Error(`No collider with handle ${handle}`);
      return collider;
    }

    removeRigidBody(body: MockRigidBody) {
      this._bodies.delete(body.handle);
      for (const col of body._colliders) {
        this._colliders.delete(col.handle);
      }
    }

    castRayAndGetNormal() {
      return null;
    }

    free() {}
  }

  class MockRay {
    origin: { x: number; y: number };
    dir: { x: number; y: number };

    constructor(
      origin: { x: number; y: number },
      dir: { x: number; y: number },
    ) {
      this.origin = origin;
      this.dir = dir;
    }

    pointAt(t: number) {
      return {
        x: this.origin.x + this.dir.x * t,
        y: this.origin.y + this.dir.y * t,
      };
    }
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
      MockRay,
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
    Ray: mocks.MockRay,
    ActiveEvents: { COLLISION_EVENTS: 1, CONTACT_FORCE_EVENTS: 2 },
  },
}));

import { Vec2, Entity } from "@yage/core";
import { PhysicsWorld } from "./PhysicsWorld.js";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { CollisionEvent, TriggerEvent } from "./types.js";

// Helper to create a mock ColliderComponent for event dispatch testing
function createMockColliderComponent(
  opts: { sensor?: boolean } = {},
): ColliderComponent {
  const handlers: Array<(e: CollisionEvent) => void> = [];
  const triggerHandlers: Array<(e: TriggerEvent) => void> = [];
  return {
    config: { shape: { type: "box", width: 10, height: 10 }, sensor: opts.sensor },
    _colliderHandle: -1,
    _dispatchCollision(e: CollisionEvent) {
      for (const h of handlers) h(e);
    },
    _dispatchTrigger(e: TriggerEvent) {
      for (const h of triggerHandlers) h(e);
    },
    onCollision(h: (e: CollisionEvent) => void) {
      handlers.push(h);
      return () => {
        const idx = handlers.indexOf(h);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    },
    onTrigger(h: (e: TriggerEvent) => void) {
      triggerHandlers.push(h);
      return () => {
        const idx = triggerHandlers.indexOf(h);
        if (idx !== -1) triggerHandlers.splice(idx, 1);
      };
    },
  } as unknown as ColliderComponent;
}

describe("PhysicsWorld", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  describe("constructor", () => {
    it("uses default gravity (0, 980px/s²) and 50 px/m", () => {
      const pw = new PhysicsWorld();
      expect(pw.pixelsPerMeter).toBe(50);
      // gravity should be converted to meters: 980/50 = 19.6
    });

    it("accepts custom config", () => {
      const pw = new PhysicsWorld({
        gravity: { x: 0, y: 500 },
        pixelsPerMeter: 100,
      });
      expect(pw.pixelsPerMeter).toBe(100);
    });
  });

  describe("toMeters/toPixels", () => {
    it("round-trips correctly", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      expect(pw.toPixels(pw.toMeters(100))).toBeCloseTo(100);
      expect(pw.toMeters(pw.toPixels(2))).toBeCloseTo(2);
    });

    it("converts with default scale", () => {
      const pw = new PhysicsWorld();
      expect(pw.toMeters(50)).toBe(1);
      expect(pw.toPixels(1)).toBe(50);
    });

    it("converts with custom scale", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 100 });
      expect(pw.toMeters(100)).toBe(1);
      expect(pw.toPixels(1)).toBe(100);
    });
  });

  describe("createBody", () => {
    it("creates a dynamic body and returns its handle", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const handle = pw.createBody(entity, { type: "dynamic" });
      expect(typeof handle).toBe("number");
      expect(pw.bodyMap.get(handle)).toBe(entity);
    });

    it("creates a static body", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const handle = pw.createBody(entity, { type: "static" });
      expect(pw.bodyMap.has(handle)).toBe(true);
    });

    it("creates a kinematic body", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const handle = pw.createBody(entity, { type: "kinematic" });
      expect(pw.bodyMap.has(handle)).toBe(true);
    });

    it("applies optional config properties", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      // Should not throw
      const handle = pw.createBody(entity, {
        type: "dynamic",
        linearDamping: 0.5,
        angularDamping: 0.3,
        fixedRotation: true,
        gravityScale: 0.5,
        ccd: true,
      });
      expect(pw.bodyMap.has(handle)).toBe(true);
    });
  });

  describe("createCollider", () => {
    it("creates a box collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "box", width: 100, height: 50 },
      }, comp);
      expect(typeof colliderHandle).toBe("number");
      expect(pw.colliderMap.get(colliderHandle)).toBe(entity);
    });

    it("creates a circle collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "circle", radius: 25 },
      }, comp);
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("creates a capsule collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "capsule", halfHeight: 20, radius: 10 },
      }, comp);
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("creates a polygon collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: {
          type: "polygon",
          vertices: [new Vec2(0, 0), new Vec2(50, 0), new Vec2(25, 50)],
        },
      }, comp);
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("applies collider properties", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "box", width: 10, height: 10 },
        offset: { x: 5, y: 10 },
        restitution: 0.8,
        friction: 0.2,
        density: 2.0,
        sensor: true,
      }, comp);
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("applies collision groups from layers and mask", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "box", width: 10, height: 10 },
        layers: 0x0001,
        mask: 0x0003,
      }, comp);
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });
  });

  describe("collision event dispatch", () => {
    it("dispatches collision events to non-sensor colliders", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(entity1, body1, {
        shape: { type: "box", width: 10, height: 10 },
      }, comp1);
      const col2 = pw.createCollider(entity2, body2, {
        shape: { type: "box", width: 10, height: 10 },
      }, comp2);

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));

      // Simulate a collision event by injecting into the mock event queue
      const eq = (pw as unknown as { eventQueue: InstanceType<typeof mocks.MockEventQueue> }).eventQueue;
      eq._events.push([col1, col2, true]);

      pw.processCollisionEvents();

      expect(events1).toHaveLength(1);
      const ev1 = events1[0] as CollisionEvent;
      expect(ev1.other).toBe(entity2);
      expect(ev1.started).toBe(true);

      expect(events2).toHaveLength(1);
      const ev2 = events2[0] as CollisionEvent;
      expect(ev2.other).toBe(entity1);
      expect(ev2.started).toBe(true);
    });

    it("dispatches trigger events to sensor colliders", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent({ sensor: true });
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(entity1, body1, {
        shape: { type: "box", width: 10, height: 10 },
        sensor: true,
      }, comp1);
      const col2 = pw.createCollider(entity2, body2, {
        shape: { type: "box", width: 10, height: 10 },
      }, comp2);

      const triggers: TriggerEvent[] = [];
      const collisions: CollisionEvent[] = [];
      comp1.onTrigger((e) => triggers.push(e));
      comp2.onCollision((e) => collisions.push(e));

      const eq = (pw as unknown as { eventQueue: InstanceType<typeof mocks.MockEventQueue> }).eventQueue;
      eq._events.push([col1, col2, true]);

      pw.processCollisionEvents();

      expect(triggers).toHaveLength(1);
      const trig = triggers[0] as TriggerEvent;
      expect(trig.other).toBe(entity2);
      expect(trig.entered).toBe(true);

      expect(collisions).toHaveLength(1);
      const col = collisions[0] as CollisionEvent;
      expect(col.other).toBe(entity1);
    });
  });

  describe("removeBody", () => {
    it("removes body and collider mappings", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(entity, bodyHandle, {
        shape: { type: "box", width: 10, height: 10 },
      }, comp);

      expect(pw.bodyMap.has(bodyHandle)).toBe(true);
      expect(pw.colliderMap.has(colHandle)).toBe(true);

      pw.removeBody(bodyHandle);

      expect(pw.bodyMap.has(bodyHandle)).toBe(false);
      expect(pw.colliderMap.has(colHandle)).toBe(false);
    });
  });

  describe("getBody", () => {
    it("returns the body for a valid handle", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const handle = pw.createBody(entity, { type: "dynamic" });
      const body = pw.getBody(handle);
      expect(body).toBeDefined();
    });

    it("returns undefined for an invalid handle", () => {
      const pw = new PhysicsWorld();
      const body = pw.getBody(999);
      expect(body).toBeUndefined();
    });
  });

  describe("step", () => {
    it("sets timestep and calls world.step", () => {
      const pw = new PhysicsWorld();
      pw.step(1 / 60);
      const world = (pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }).world;
      expect(world._stepCalled).toBe(true);
      expect(world.timestep).toBeCloseTo(1 / 60);
    });
  });

  describe("setGravity", () => {
    it("converts gravity from pixels to meters", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      pw.setGravity(0, 500);
      const world = (pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }).world;
      expect(world.gravity.y).toBeCloseTo(10); // 500/50 = 10
    });
  });

  describe("destroy", () => {
    it("clears all maps and frees resources", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(entity, bodyHandle, {
        shape: { type: "box", width: 10, height: 10 },
      }, comp);

      pw.destroy();

      expect(pw.bodyMap.size).toBe(0);
      expect(pw.colliderMap.size).toBe(0);
    });
  });
});
