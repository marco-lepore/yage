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
    _shape: unknown = undefined;
    _rotationWrtParent = 0;
    _parent: MockRigidBody | undefined;

    constructor() {
      this.handle = nextColliderHandle++;
    }

    isSensor() {
      return this._sensor;
    }
    setSensor(s: boolean) {
      this._sensor = s;
    }
    setShape(shape: unknown) {
      this._shape = shape;
    }
    setRotationWrtParent(angle: number) {
      this._rotationWrtParent = angle;
    }
    parent() {
      return this._parent;
    }
    setEnabled() {}
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
    _bodyType: "dynamic" | "fixed" | "kinematic" = "dynamic";
    isFixed() {
      return this._bodyType === "fixed";
    }
    isKinematic() {
      return this._bodyType === "kinematic";
    }
    isDynamic() {
      return this._bodyType === "dynamic";
    }
    /** Rapier's `setBodyType` value → the mock's body kind. */
    setBodyType(type: number) {
      this._bodyType =
        type === 1 ? "fixed" : type === 2 ? "kinematic" : "dynamic";
    }
    numColliders() {
      return this._colliders.length;
    }
    collider(i: number) {
      return this._colliders[i];
    }
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
    _translation = { x: 0, y: 0 };
    _restitution = 0;
    _friction = 0.5;
    _density = 1;
    _contactSkin = 0;
    _sensor = false;
    _collisionGroups = 0;
    _activeEvents = 0;

    // Mirrors Rapier's `ColliderDesc.shape`, in meters. Recorded so tests can
    // assert which shape reached Rapier, not just that one did.
    shape: Record<string, unknown> = { kind: "none" };

    private static of(shape: Record<string, unknown>) {
      const desc = new MockColliderDesc();
      desc.shape = shape;
      return desc;
    }

    static cuboid(hx: number, hy: number) {
      return MockColliderDesc.of({ kind: "cuboid", hx, hy });
    }
    static roundCuboid(hx: number, hy: number, borderRadius: number) {
      return MockColliderDesc.of({ kind: "roundCuboid", hx, hy, borderRadius });
    }
    static ball(radius: number) {
      return MockColliderDesc.of({ kind: "ball", radius });
    }
    static capsule(halfHeight: number, radius: number) {
      return MockColliderDesc.of({ kind: "capsule", halfHeight, radius });
    }
    static convexHull(vertices: Float32Array): MockColliderDesc | null {
      return MockColliderDesc.of({ kind: "convexHull", vertices });
    }
    static polyline(vertices: Float32Array) {
      return MockColliderDesc.of({ kind: "polyline", vertices });
    }

    _rotation = 0;

    setTranslation(x: number, y: number) {
      this._translation = { x, y };
      return this;
    }
    setRotation(angle: number) {
      this._rotation = angle;
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
    setContactSkin(thickness: number) {
      this._contactSkin = thickness;
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
    setActiveCollisionTypes() {
      return this;
    }
  }

  type DrainCallback = (h1: number, h2: number, started: boolean) => void;

  class MockManifold {
    constructor(
      private _normal: { x: number; y: number },
      private _solverContacts: Array<{ x: number; y: number; dist: number }>,
      private _impulses: number[] = [],
    ) {}

    normal() {
      return this._normal;
    }
    numSolverContacts() {
      return this._solverContacts.length;
    }
    solverContactPoint(i: number) {
      const c = this._solverContacts[i]!;
      return { x: c.x, y: c.y };
    }
    solverContactDist(i: number) {
      return this._solverContacts[i]!.dist;
    }
    numContacts() {
      return this._impulses.length;
    }
    contactImpulse(i: number) {
      return this._impulses[i]!;
    }
  }

  class MockNarrowPhase {
    _pairs = new Map<
      string,
      Array<{ manifold: MockManifold; flipped: boolean }>
    >();

    _setPair(h1: number, h2: number, manifold: MockManifold, flipped = false) {
      const key = `${h1}:${h2}`;
      const entries = this._pairs.get(key) ?? [];
      entries.push({ manifold, flipped });
      this._pairs.set(key, entries);
    }

    contactPair(
      h1: number,
      h2: number,
      f: (manifold: MockManifold, flipped: boolean) => void,
    ) {
      for (const entry of this._pairs.get(`${h1}:${h2}`) ?? []) {
        f(entry.manifold, entry.flipped);
      }
    }
  }

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
    _stepCount = 0;
    narrowPhase = new MockNarrowPhase();

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {
      this._stepCalled = true;
      this._stepCount++;
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
      collider._parent = parent;
      parent._colliders.push(collider);
      this._colliders.set(collider.handle, collider);
      return collider;
    }

    castShape(): unknown {
      return null;
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

    removeCollider(collider: MockCollider) {
      this._colliders.delete(collider.handle);
    }

    /** Narrow-phase pairs any `intersectionPairsWith` call reports. */
    _pairs: MockCollider[] = [];

    intersectionPairsWith(
      _collider: MockCollider,
      cb: (other: MockCollider) => boolean,
    ) {
      for (const other of this._pairs) cb(other);
    }

    castRayAndGetNormal() {
      return null;
    }

    intersectionsWithShape() {}

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
      MockManifold,
      MockNarrowPhase,
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
    QueryFilterFlags: { EXCLUDE_SENSORS: 8, EXCLUDE_SOLIDS: 16 },
    RigidBodyType: {
      Dynamic: 0,
      Fixed: 1,
      KinematicPositionBased: 2,
      KinematicVelocityBased: 3,
    },
    ActiveCollisionTypes: { ALL: 60943 },
  },
}));

import { Vec2, Entity, EntityPool, createMockScene } from "@yagejs/core";
import { PhysicsWorld } from "./PhysicsWorld.js";
import type { ColliderComponent } from "./ColliderComponent.js";
import type { RigidBodyComponent } from "./RigidBodyComponent.js";
import type { CollisionEvent, TriggerEvent } from "./types.js";

// Helper to create a mock ColliderComponent for event dispatch testing
function createMockColliderComponent(
  opts: { sensor?: boolean } = {},
): ColliderComponent {
  const handlers: Array<(e: CollisionEvent) => void> = [];
  const triggerHandlers: Array<(e: TriggerEvent) => void> = [];
  return {
    config: {
      shape: { type: "box", width: 10, height: 10 },
      sensor: opts.sensor,
    },
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

    it("rejects a pixelsPerMeter that is not finite and above 0", () => {
      expect(() => new PhysicsWorld({ pixelsPerMeter: 0 })).toThrow(
        "PhysicsWorld: pixelsPerMeter must be finite and > 0, got 0.",
      );
      expect(() => new PhysicsWorld({ pixelsPerMeter: -50 })).toThrow(
        "PhysicsWorld: pixelsPerMeter must be finite and > 0, got -50.",
      );
    });

    it("rejects non-finite gravity", () => {
      expect(() => new PhysicsWorld({ gravity: { x: 0, y: NaN } })).toThrow(
        "PhysicsWorld: gravity.y must be finite, got NaN.",
      );
    });
  });

  describe("addJoint", () => {
    // The config is checked before the bodies, so no body is needed here.
    const unused = {} as RigidBodyComponent;

    it("rejects a negative spring damping", () => {
      const pw = new PhysicsWorld();
      expect(() =>
        pw.addJoint(unused, unused, {
          type: "spring",
          restLength: 80,
          stiffness: 40,
          damping: -4,
        }),
      ).toThrow(
        "PhysicsWorld.addJoint: damping must be finite and >= 0, got -4.",
      );
    });

    it("rejects a non-finite rope length and anchor", () => {
      const pw = new PhysicsWorld();
      expect(() =>
        pw.addJoint(unused, unused, { type: "rope", length: Infinity }),
      ).toThrow(
        "PhysicsWorld.addJoint: length must be finite and >= 0, got Infinity.",
      );
      expect(() =>
        pw.addJoint(unused, unused, {
          type: "rope",
          length: 10,
          anchorB: { x: NaN, y: 0 },
        }),
      ).toThrow("PhysicsWorld.addJoint: anchorB.x must be finite, got NaN.");
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

  describe("queryOverlapping", () => {
    function setupPair() {
      const pw = new PhysicsWorld();
      const self = new Entity("self");
      const other = new Entity("other");
      const selfHandle = pw.createCollider(
        self,
        pw.createBody(self, { type: "dynamic" }),
        { shape: { type: "box", width: 10, height: 10 } },
        createMockColliderComponent(),
      );
      const otherHandle = pw.createCollider(
        other,
        pw.createBody(other, { type: "dynamic" }),
        { shape: { type: "box", width: 10, height: 10 } },
        createMockColliderComponent(),
      );
      const world = (
        pw as unknown as {
          world: { _pairs: unknown[]; getCollider(h: number): unknown };
        }
      ).world;
      world._pairs = [world.getCollider(otherHandle)];
      return { pw, self, other, selfHandle };
    }

    it("reports an overlapping active peer", () => {
      const { pw, other, selfHandle } = setupPair();
      expect(pw.queryOverlapping(selfHandle)).toEqual([other]);
    });

    it("returns nothing when the querying entity is dormant", () => {
      const { pw, self, selfHandle } = setupPair();
      self.setActive(false);
      expect(pw.queryOverlapping(selfHandle)).toEqual([]);
    });

    it("skips a dormant peer", () => {
      const { pw, other, selfHandle } = setupPair();
      other.setActive(false);
      expect(pw.queryOverlapping(selfHandle)).toEqual([]);
    });
  });

  describe("createCollider", () => {
    it("creates a box collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 100, height: 50 },
        },
        comp,
      );
      expect(typeof colliderHandle).toBe("number");
      expect(pw.colliderMap.get(colliderHandle)).toBe(entity);
    });

    it("creates a rounded box with the same outer footprint", () => {
      const spy = vi.spyOn(mocks.MockColliderDesc, "roundCuboid");
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });

      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 12, height: 44, borderRadius: 2 },
        },
        createMockColliderComponent(),
      );

      expect(spy).toHaveBeenCalledWith(0.08, 0.4, 0.04);
      spy.mockRestore();
    });

    it("creates a circle collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "circle", radius: 25 },
        },
        comp,
      );
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("creates a capsule collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "capsule", halfHeight: 20, radius: 10 },
        },
        comp,
      );
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("creates a polygon collider", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: {
            type: "polygon",
            vertices: [new Vec2(0, 0), new Vec2(50, 0), new Vec2(25, 50)],
          },
        },
        comp,
      );
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("applies collider properties", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
          offset: { x: 5, y: 10 },
          restitution: 0.8,
          friction: 0.2,
          density: 2.0,
          contactSkin: 1,
          sensor: true,
        },
        comp,
      );
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });

    it("converts contact skin to meters", () => {
      const spy = vi.spyOn(mocks.MockColliderDesc.prototype, "setContactSkin");
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });

      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
          contactSkin: 2,
        },
        createMockColliderComponent(),
      );

      expect(spy).toHaveBeenCalledWith(0.04);
      spy.mockRestore();
    });

    it("applies config rotation to the collider desc", () => {
      const spy = vi.spyOn(mocks.MockColliderDesc.prototype, "setRotation");
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
          rotation: Math.PI / 4,
        },
        comp,
      );
      expect(spy).toHaveBeenCalledWith(Math.PI / 4);
      spy.mockRestore();
    });

    it("adds config rotation on top of the horizontal-capsule axis rotation", () => {
      const spy = vi.spyOn(mocks.MockColliderDesc.prototype, "setRotation");
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "capsule", halfHeight: 20, radius: 10, axis: "x" },
          rotation: Math.PI / 6,
        },
        comp,
      );
      expect(spy).toHaveBeenCalledWith(Math.PI / 2 + Math.PI / 6);
      spy.mockRestore();
    });

    it("applies collision groups from layers and mask", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0001,
          mask: 0x0003,
        },
        comp,
      );
      expect(pw.colliderMap.has(colliderHandle)).toBe(true);
    });
  });

  describe("collision event dispatch", () => {
    function createCollisionPair(pw: PhysicsWorld): {
      comp1: ColliderComponent;
      comp2: ColliderComponent;
      collider1: number;
      collider2: number;
    } {
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent({});
      const comp2 = createMockColliderComponent({});
      const collider1 = pw.createCollider(
        entity1,
        body1,
        { shape: { type: "box", width: 10, height: 10 } },
        comp1,
      );
      const collider2 = pw.createCollider(
        entity2,
        body2,
        { shape: { type: "box", width: 10, height: 10 } },
        comp2,
      );
      return { comp1, comp2, collider1, collider2 };
    }

    it("delivers the events of every step since the last processCollisionEvents, in order", () => {
      const pw = new PhysicsWorld();
      const { comp1, collider1, collider2 } = createCollisionPair(pw);
      const events: CollisionEvent[] = [];
      comp1.onCollision((e) => events.push(e));
      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;

      eq._events.push([collider1, collider2, true]);
      pw.step(1 / 60);
      eq._events.push([collider1, collider2, false]);
      pw.step(1 / 60);
      expect(events).toHaveLength(0);

      pw.processCollisionEvents();

      expect(events.map((e) => e.started)).toEqual([true, false]);
      pw.processCollisionEvents();
      expect(events).toHaveLength(2);
    });

    function queueCollision(
      pw: PhysicsWorld,
      collider1: number,
      collider2: number,
      started: boolean,
    ): void {
      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([collider1, collider2, started]);
    }

    it("dispatches collision events to non-sensor colliders", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));

      // Simulate a collision event by injecting into the mock event queue
      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
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
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
          sensor: true,
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const triggers: TriggerEvent[] = [];
      const collisions: CollisionEvent[] = [];
      comp1.onTrigger((e) => triggers.push(e));
      comp2.onCollision((e) => collisions.push(e));

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
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

    it("populates contactNormal/contactPoint/penetrationDepth on started non-sensor collisions, oriented from self toward other", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const manifold = new mocks.MockManifold({ x: 1, y: 0 }, [
        { x: 2, y: 3, dist: -0.1 },
      ]);
      world.narrowPhase._setPair(col1, col2, manifold, false);

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([col1, col2, true]);
      pw.processCollisionEvents();

      const ev1 = events1[0] as CollisionEvent;
      expect(ev1.contactNormal?.x).toBeCloseTo(1);
      expect(ev1.contactNormal?.y).toBeCloseTo(0);
      expect(ev1.contactPoint).toEqual({ x: 100, y: 150 });
      expect(ev1.penetrationDepth).toBeCloseTo(5);

      const ev2 = events2[0] as CollisionEvent;
      expect(ev2.contactNormal?.x).toBeCloseTo(-1);
      expect(ev2.contactNormal?.y).toBeCloseTo(0);
      expect(ev2.contactPoint).toEqual({ x: 100, y: 150 });
      expect(ev2.penetrationDepth).toBeCloseTo(5);
    });

    it("sets contactImpulse on started non-sensor collisions in pixels and shares it between both sides", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { comp1, comp2, collider1, collider2 } = createCollisionPair(pw);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold(
          { x: 1, y: 0 },
          [{ x: 0, y: 0, dist: -0.1 }],
          [0.25],
        ),
      );

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));
      queueCollision(pw, collider1, collider2, true);
      pw.processCollisionEvents();

      expect((events1[0] as CollisionEvent).contactImpulse).toBeCloseTo(12.5);
      expect((events2[0] as CollisionEvent).contactImpulse).toBeCloseTo(12.5);
      // The vector is oriented like contactNormal: self toward other.
      const v1 = (events1[0] as CollisionEvent).contactImpulseVector;
      const v2 = (events2[0] as CollisionEvent).contactImpulseVector;
      expect(v1?.x).toBeCloseTo(12.5);
      expect(v1?.y).toBeCloseTo(0);
      expect(v2?.x).toBeCloseTo(-12.5);
      expect(v2?.y).toBeCloseTo(0);
    });

    it("sums contactImpulse across all manifold contact points", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { comp1, collider1, collider2 } = createCollisionPair(pw);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold(
          { x: 1, y: 0 },
          [{ x: 0, y: 0, dist: -0.1 }],
          [0.2, 0.3],
        ),
      );

      const events: CollisionEvent[] = [];
      comp1.onCollision((e) => events.push(e));
      queueCollision(pw, collider1, collider2, true);
      pw.processCollisionEvents();

      expect((events[0] as CollisionEvent).contactImpulse).toBeCloseTo(25);
    });

    it("leaves contactImpulse undefined on ended collisions", () => {
      const pw = new PhysicsWorld();
      const { comp1, collider1, collider2 } = createCollisionPair(pw);
      const events: CollisionEvent[] = [];
      comp1.onCollision((e) => events.push(e));
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold(
          { x: 1, y: 0 },
          [{ x: 0, y: 0, dist: -0.1 }],
          [1],
        ),
      );
      queueCollision(pw, collider1, collider2, false);
      pw.processCollisionEvents();

      expect((events[0] as CollisionEvent).contactImpulse).toBeUndefined();
      expect(
        (events[0] as CollisionEvent).contactImpulseVector,
      ).toBeUndefined();
    });

    it("reports a zero contactImpulse for a grazing contact start", () => {
      // A grazing start has contact points but the solver applied nothing:
      // impulses are all 0, not absent.
      const pw = new PhysicsWorld();
      const { comp1, comp2, collider1, collider2 } = createCollisionPair(pw);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold(
          { x: 1, y: 0 },
          [
            { x: 0, y: 0, dist: 0 },
            { x: 0, y: 0.2, dist: 0 },
          ],
          [0, 0],
        ),
      );

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));
      queueCollision(pw, collider1, collider2, true);
      pw.processCollisionEvents();

      expect((events1[0] as CollisionEvent).contactImpulse).toBe(0);
      expect((events2[0] as CollisionEvent).contactImpulse).toBe(0);
      expect((events1[0] as CollisionEvent).contactImpulseVector?.x).toBe(0);
      expect((events1[0] as CollisionEvent).contactImpulseVector?.y).toBe(0);
    });

    it("accumulates contactImpulse across manifolds along their normals and skips manifolds with no solver contact", () => {
      // Multiple manifolds per pair happen against polyline and compound
      // colliders — one manifold per segment, each with its own normal.
      // The reported impulse is the magnitude of the vector total.
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { comp1, collider1, collider2 } = createCollisionPair(pw);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold({ x: 0, y: 1 }, [], [0.1]),
      );
      world.narrowPhase._setPair(
        collider1,
        collider2,
        new mocks.MockManifold(
          { x: 1, y: 0 },
          [{ x: 0, y: 0, dist: -0.1 }],
          [0.2, 0.3],
        ),
      );

      const events: CollisionEvent[] = [];
      comp1.onCollision((e) => events.push(e));
      queueCollision(pw, collider1, collider2, true);
      pw.processCollisionEvents();

      const ev = events[0] as CollisionEvent;
      // 0.1 along {0,1} plus 0.5 along {1,0}, pixel-scaled.
      expect(ev.contactImpulse).toBeCloseTo(50 * Math.hypot(0.5, 0.1));
      expect(ev.contactImpulseVector?.x).toBeCloseTo(25);
      expect(ev.contactImpulseVector?.y).toBeCloseTo(5);
      expect(ev.contactNormal?.x).toBeCloseTo(1);
      expect(ev.contactNormal?.y).toBeCloseTo(0);
      expect(ev.penetrationDepth).toBeCloseTo(5);
    });

    it.each([
      ["shallow manifold first", false],
      ["deep manifold first", true],
    ])(
      "takes geometry from the deepest solver contact (%s)",
      (_label, deepFirst) => {
        // Rapier emits a pair's manifolds in an order that follows the
        // approach direction, so the same terrain can present the shallower
        // surface first or second. A box on a polyline corner touches two
        // segments at once, and only the deeper contact describes the
        // surface resisting it.
        const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
        const { comp1, collider1, collider2 } = createCollisionPair(pw);
        const world = (
          pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
        ).world;
        const shallow = new mocks.MockManifold({ x: 0, y: 1 }, [
          { x: 1, y: 1, dist: -0.02 },
        ]);
        // The deep contact sits at index 1, so reading index 0 of the
        // winning manifold would pick the shallower of its two contacts.
        const deep = new mocks.MockManifold({ x: 1, y: 0 }, [
          { x: 2, y: 2, dist: -0.01 },
          { x: 3, y: 3, dist: -0.2 },
        ]);
        for (const manifold of deepFirst ? [deep, shallow] : [shallow, deep]) {
          world.narrowPhase._setPair(collider1, collider2, manifold);
        }

        const events: CollisionEvent[] = [];
        comp1.onCollision((e) => events.push(e));
        queueCollision(pw, collider1, collider2, true);
        pw.processCollisionEvents();

        const ev = events[0] as CollisionEvent;
        expect(ev.contactNormal?.x).toBeCloseTo(1);
        expect(ev.contactNormal?.y).toBeCloseTo(0);
        expect(ev.contactPoint?.x).toBeCloseTo(150);
        expect(ev.contactPoint?.y).toBeCloseTo(150);
        expect(ev.penetrationDepth).toBeCloseTo(10);
      },
    );

    it("negates the manifold normal when Rapier reports flipped=true", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const manifold = new mocks.MockManifold({ x: 1, y: 0 }, [
        { x: 0, y: 0, dist: 0 },
      ]);
      world.narrowPhase._setPair(col1, col2, manifold, true);

      const events1: CollisionEvent[] = [];
      const events2: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision((e) => events2.push(e));

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([col1, col2, true]);
      pw.processCollisionEvents();

      const normal1 = (events1[0] as CollisionEvent).contactNormal;
      expect(normal1?.x).toBeCloseTo(-1);
      expect(normal1?.y).toBeCloseTo(0);
      const normal2 = (events2[0] as CollisionEvent).contactNormal;
      expect(normal2?.x).toBeCloseTo(1);
      expect(normal2?.y).toBeCloseTo(0);
    });

    it("clamps penetrationDepth to >= 0 for speculative (non-overlapping) contacts", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const manifold = new mocks.MockManifold({ x: 1, y: 0 }, [
        { x: 0, y: 0, dist: 0.05 },
      ]);
      world.narrowPhase._setPair(col1, col2, manifold, false);

      const events1: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision(() => {});

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([col1, col2, true]);
      pw.processCollisionEvents();

      expect((events1[0] as CollisionEvent).penetrationDepth).toBe(0);
    });

    it("leaves contact fields undefined and skips the narrowPhase query on stopped collisions", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const manifold = new mocks.MockManifold({ x: 1, y: 0 }, [
        { x: 0, y: 0, dist: -0.1 },
      ]);
      world.narrowPhase._setPair(col1, col2, manifold, false);
      const contactPairSpy = vi.spyOn(world.narrowPhase, "contactPair");

      const events1: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision(() => {});

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([col1, col2, false]);
      pw.processCollisionEvents();

      expect(contactPairSpy).not.toHaveBeenCalled();
      const ev1 = events1[0] as CollisionEvent;
      expect(ev1.contactNormal).toBeUndefined();
      expect(ev1.contactPoint).toBeUndefined();
      expect(ev1.penetrationDepth).toBeUndefined();
      expect(ev1.contactImpulse).toBeUndefined();
      expect(ev1.contactImpulseVector).toBeUndefined();
    });

    it("leaves contact fields undefined when no manifold is available (e.g. sensor pairs)", () => {
      const pw = new PhysicsWorld();
      const entity1 = new Entity("e1");
      const entity2 = new Entity("e2");
      const body1 = pw.createBody(entity1, { type: "dynamic" });
      const body2 = pw.createBody(entity2, { type: "dynamic" });
      const comp1 = createMockColliderComponent();
      const comp2 = createMockColliderComponent();
      const col1 = pw.createCollider(
        entity1,
        body1,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp1,
      );
      const col2 = pw.createCollider(
        entity2,
        body2,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp2,
      );
      // No pair registered on narrowPhase: mirrors Rapier not producing a
      // manifold for the pair (e.g. a sensor side of a mixed pair).

      const events1: CollisionEvent[] = [];
      comp1.onCollision((e) => events1.push(e));
      comp2.onCollision(() => {});

      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([col1, col2, true]);
      pw.processCollisionEvents();

      const ev1 = events1[0] as CollisionEvent;
      expect(ev1.contactNormal).toBeUndefined();
      expect(ev1.contactPoint).toBeUndefined();
      expect(ev1.penetrationDepth).toBeUndefined();
      expect(ev1.contactImpulse).toBeUndefined();
      expect(ev1.contactImpulseVector).toBeUndefined();
    });
  });

  describe("collisions naming an entity a handler retired", () => {
    class Pooled extends Entity {
      onAcquire(): void {}
    }

    /** Give an entity a body and a collider, so it can appear in events. */
    function addCollider<E extends Entity>(
      pw: PhysicsWorld,
      entity: E,
      opts: { sensor?: boolean } = {},
    ): { entity: E; collider: ColliderComponent; handle: number } {
      const comp = createMockColliderComponent(opts);
      const handle = pw.createCollider(
        entity,
        pw.createBody(entity, { type: "dynamic" }),
        {
          shape: { type: "box", width: 10, height: 10 },
          ...(opts.sensor ? { sensor: true } : {}),
        },
        comp,
      );
      return { entity, collider: comp, handle };
    }

    function queue(pw: PhysicsWorld, a: number, b: number): void {
      const eq = (
        pw as unknown as {
          eventQueue: InstanceType<typeof mocks.MockEventQueue>;
        }
      ).eventQueue;
      eq._events.push([a, b, true]);
    }

    it("drops the rest of a released member's events, and the pair that named it", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Pooled);

      const shooter = addCollider(pw, pool.acquire());
      const target = addCollider(pw, pool.acquire());
      const wall = addCollider(pw, pool.acquire());

      // The first pair's handler retires the target, which goes straight back
      // out of the pool — the same object, a different life.
      shooter.collider.onCollision(() => {
        target.entity.destroy();
        expect(pool.acquire()).toBe(target.entity);
      });

      const targetEvents: CollisionEvent[] = [];
      const wallEvents: CollisionEvent[] = [];
      target.collider.onCollision((e) => targetEvents.push(e));
      wall.collider.onCollision((e) => wallEvents.push(e));

      queue(pw, shooter.handle, target.handle);
      queue(pw, wall.handle, target.handle);
      pw.processCollisionEvents();

      // Both sides of both pairs named the retired life.
      expect(targetEvents).toHaveLength(0);
      expect(wallEvents).toHaveLength(0);
    });

    it("still delivers events between entities the handler left alone", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Pooled);

      const shooter = addCollider(pw, pool.acquire());
      const target = addCollider(pw, pool.acquire());
      const other = addCollider(pw, pool.acquire());

      shooter.collider.onCollision(() => {
        target.entity.destroy();
      });

      const otherEvents: CollisionEvent[] = [];
      other.collider.onCollision((e) => otherEvents.push(e));

      queue(pw, shooter.handle, target.handle);
      queue(pw, shooter.handle, other.handle);
      pw.processCollisionEvents();

      expect(otherEvents).toHaveLength(1);
      expect(otherEvents[0]!.other).toBe(shooter.entity);
    });

    it("drops trigger events the same way", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Pooled);

      const zone = addCollider(pw, pool.acquire(), { sensor: true });
      const walker = addCollider(pw, pool.acquire());
      const second = addCollider(pw, pool.acquire(), { sensor: true });

      zone.collider.onTrigger(() => {
        walker.entity.destroy();
        pool.acquire();
      });

      const secondTriggers: TriggerEvent[] = [];
      second.collider.onTrigger((e) => secondTriggers.push(e));

      queue(pw, zone.handle, walker.handle);
      queue(pw, second.handle, walker.handle);
      pw.processCollisionEvents();

      expect(secondTriggers).toHaveLength(0);
    });

    it("drops events for a collider a handler removed mid-drain", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();

      const striker = addCollider(pw, scene.spawn("striker"));
      const wall = addCollider(pw, scene.spawn("wall"));
      const sentry = addCollider(pw, scene.spawn("sentry"));

      // Same engine state a component teardown produces: the wall's collider
      // leaves the world while its entity stays alive, generation unchanged.
      striker.collider.onCollision(() => {
        pw.removeCollider(wall.handle);
      });

      const sentryEvents: CollisionEvent[] = [];
      sentry.collider.onCollision((e) => sentryEvents.push(e));

      queue(pw, striker.handle, wall.handle);
      queue(pw, sentry.handle, wall.handle);
      pw.processCollisionEvents();

      expect(sentryEvents).toHaveLength(0);
    });

    it("drops events when a removed handle is reused by a new collider", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();

      const striker = addCollider(pw, scene.spawn("striker"));
      const wall = addCollider(pw, scene.spawn("wall"));
      const sentry = addCollider(pw, scene.spawn("sentry"));

      // Rapier can hand a removed collider's numeric handle to the next
      // collider it creates. Model that by re-registering the wall's handle
      // to a different component mid-drain: presence alone would pass, only
      // component identity tells the captured side from the newcomer.
      const replacement = createMockColliderComponent();
      const replacementEvents: CollisionEvent[] = [];
      replacement.onCollision((e) => replacementEvents.push(e));
      striker.collider.onCollision(() => {
        pw.removeCollider(wall.handle);
        const maps = pw as unknown as {
          colliderMap: Map<number, Entity>;
          _colliderComponents: Map<number, ColliderComponent>;
        };
        maps.colliderMap.set(wall.handle, sentry.entity);
        maps._colliderComponents.set(wall.handle, replacement);
      });

      const sentryEvents: CollisionEvent[] = [];
      sentry.collider.onCollision((e) => sentryEvents.push(e));

      queue(pw, striker.handle, wall.handle);
      queue(pw, sentry.handle, wall.handle);
      pw.processCollisionEvents();

      expect(sentryEvents).toHaveLength(0);
      expect(replacementEvents).toHaveLength(0);
    });

    it("drops events for a member forceAcquire took back mid-drain", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();
      const pool = new EntityPool(scene, Pooled, { maxSize: 2 });

      const shooter = addCollider(pw, pool.acquire()!);
      const target = addCollider(pw, pool.acquire()!);

      const targetEvents: CollisionEvent[] = [];
      target.collider.onCollision((e) => targetEvents.push(e));

      shooter.collider.onCollision(() => {
        // Saturated, so this reclaims the oldest live member — the shooter
        // itself — ending the life the queued pair named on its side.
        expect(pool.forceAcquire()).toBe(shooter.entity);
      });

      queue(pw, shooter.handle, target.handle);
      pw.processCollisionEvents();

      expect(targetEvents).toHaveLength(0);
    });

    it("drops events naming an entity a handler destroyed outright", () => {
      const pw = new PhysicsWorld();
      const { scene } = createMockScene();

      const shooter = scene.spawn("shooter");
      const target = scene.spawn("target");
      const shooterComp = createMockColliderComponent();
      const targetComp = createMockColliderComponent();
      const shooterHandle = pw.createCollider(
        shooter,
        pw.createBody(shooter, { type: "dynamic" }),
        { shape: { type: "box", width: 10, height: 10 } },
        shooterComp,
      );
      const targetHandle = pw.createCollider(
        target,
        pw.createBody(target, { type: "dynamic" }),
        { shape: { type: "box", width: 10, height: 10 } },
        targetComp,
      );

      shooterComp.onCollision(() => target.destroy());
      const targetEvents: CollisionEvent[] = [];
      targetComp.onCollision((e) => targetEvents.push(e));

      queue(pw, shooterHandle, targetHandle);
      pw.processCollisionEvents();

      expect(targetEvents).toHaveLength(0);
    });
  });

  describe("raycast", () => {
    function setupRaycastHit(pw: PhysicsWorld) {
      const entity = new Entity("target");
      const bodyHandle = pw.createBody(entity, { type: "static" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const capturedRays: InstanceType<typeof mocks.MockRay>[] = [];
      world.castRayAndGetNormal = ((
        ray: InstanceType<typeof mocks.MockRay>,
      ) => {
        capturedRays.push(ray);
        return {
          collider: { handle: colHandle },
          timeOfImpact: 2, // meters
          normal: { x: 0, y: -1 },
        };
      }) as unknown as typeof world.castRayAndGetNormal;

      return { entity, capturedRays };
    }

    it("normalizes the direction before casting", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { capturedRays } = setupRaycastHit(pw);

      // A pixel-space delta like target.sub(origin): length 500.
      pw.raycast(new Vec2(0, 0), new Vec2(300, 400), 100);

      expect(capturedRays).toHaveLength(1);
      expect(capturedRays[0]!.dir.x).toBeCloseTo(0.6);
      expect(capturedRays[0]!.dir.y).toBeCloseTo(0.8);
    });

    it("reports hit distance in pixels independent of direction length", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { entity } = setupRaycastHit(pw);

      const hitShort = pw.raycast(new Vec2(0, 0), new Vec2(1, 0), 300);
      const hitLong = pw.raycast(new Vec2(0, 0), new Vec2(250, 0), 300);

      expect(hitShort?.entity).toBe(entity);
      expect(hitShort?.distance).toBeCloseTo(100); // 2m * 50px/m
      expect(hitLong?.distance).toBeCloseTo(100);
    });

    it("throws on a zero-length direction", () => {
      const pw = new PhysicsWorld();
      expect(() => pw.raycast(new Vec2(0, 0), new Vec2(0, 0), 100)).toThrow(
        "non-zero",
      );
    });

    it("excludeEntity filters that entity's colliders via the predicate", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const caster = new Entity("caster");
      const bodyHandle = pw.createBody(caster, { type: "static" });
      const comp = createMockColliderComponent();
      const casterCollider = pw.createCollider(
        caster,
        bodyHandle,
        {
          shape: { type: "circle", radius: 10 },
        },
        comp,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      let capturedPredicate: ((c: { handle: number }) => boolean) | undefined;
      world.castRayAndGetNormal = ((...args: unknown[]) => {
        capturedPredicate = args[7] as (c: { handle: number }) => boolean;
        return null;
      }) as unknown as typeof world.castRayAndGetNormal;

      pw.raycast(new Vec2(0, 0), new Vec2(1, 0), 100, {
        excludeEntity: caster,
      });

      expect(capturedPredicate).toBeDefined();
      expect(capturedPredicate!({ handle: casterCollider })).toBe(false);
      expect(capturedPredicate!({ handle: 9999 })).toBe(true);
    });
  });

  describe("castShape", () => {
    /**
     * Rapier reports `witness1` in world space and `normal1` as the surface
     * normal on the collider that was hit, with the time of impact in meters
     * (the sweep velocity is a unit vector). Verified against real Rapier
     * 0.19; the mock reproduces those spaces.
     */
    function setupCast(pw: PhysicsWorld) {
      const entity = new Entity("target");
      const bodyHandle = pw.createBody(entity, { type: "static" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(
        entity,
        bodyHandle,
        { shape: { type: "box", width: 10, height: 10 } },
        comp,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const captured: unknown[][] = [];
      world.castShape = ((...args: unknown[]) => {
        captured.push(args);
        return {
          collider: { handle: colHandle },
          time_of_impact: 3.6, // meters
          witness1: { x: 4, y: 5.8 }, // world meters
          normal1: { x: 0, y: -1 },
        };
      }) as unknown as typeof world.castShape;

      return { entity, captured };
    }

    it("sweeps in meters and reports the hit in pixels", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { entity, captured } = setupCast(pw);

      const hit = pw.castShape(
        { type: "box", width: 20, height: 20 },
        new Vec2(200, 100),
        new Vec2(0, 1),
        400,
      );

      expect(captured).toHaveLength(1);
      const [pos, , vel, , targetDistance, maxToi] = captured[0]!;
      expect(pos).toEqual({ x: 4, y: 2 }); // 200px, 100px at 50px/m
      expect(vel).toEqual({ x: 0, y: 1 });
      expect(targetDistance).toBe(0);
      expect(maxToi).toBeCloseTo(8); // 400px

      expect(hit?.entity).toBe(entity);
      expect(hit?.distance).toBeCloseTo(180); // 3.6m
      expect(hit?.point.x).toBeCloseTo(200);
      expect(hit?.point.y).toBeCloseTo(290);
      // A world-space unit normal is not a pixel value; it passes through.
      expect(hit?.normal.x).toBeCloseTo(0);
      expect(hit?.normal.y).toBeCloseTo(-1);
    });

    it("normalizes the direction, so hit distance ignores its length", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { captured } = setupCast(pw);
      const shape = { type: "box", width: 20, height: 20 } as const;

      const short = pw.castShape(shape, new Vec2(0, 0), new Vec2(3, 4), 400);
      const long = pw.castShape(shape, new Vec2(0, 0), new Vec2(300, 400), 400);

      expect(captured[0]![2]).toEqual({ x: 0.6, y: 0.8 });
      expect(captured[1]![2]).toEqual({ x: 0.6, y: 0.8 });
      expect(short?.distance).toBeCloseTo(180);
      expect(long?.distance).toBeCloseTo(180);
    });

    it("passes rounded box geometry to shape casts", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { captured } = setupCast(pw);

      pw.castShape(
        { type: "box", width: 12, height: 44, borderRadius: 2 },
        new Vec2(0, 0),
        new Vec2(1, 0),
        100,
      );

      expect(captured[0]![3]).toEqual({
        kind: "roundCuboid",
        hx: 0.08,
        hy: 0.4,
        borderRadius: 0.04,
      });
    });

    it("throws on a zero-length direction", () => {
      const pw = new PhysicsWorld();
      expect(() =>
        pw.castShape(
          { type: "circle", radius: 5 },
          new Vec2(0, 0),
          new Vec2(0, 0),
          100,
        ),
      ).toThrow("non-zero");
    });

    it("returns null when nothing is hit", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      world.castShape = (() => null) as unknown as typeof world.castShape;

      expect(
        pw.castShape(
          { type: "circle", radius: 5 },
          new Vec2(0, 0),
          new Vec2(1, 0),
          100,
        ),
      ).toBeNull();
    });

    it('adds the axis:"x" capsule turn on top of the requested rotation', () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { captured } = setupCast(pw);

      pw.castShape(
        { type: "capsule", halfHeight: 10, radius: 5, axis: "x" },
        new Vec2(0, 0),
        new Vec2(1, 0),
        100,
        { rotation: 0.25 },
      );

      expect(captured[0]![1]).toBeCloseTo(Math.PI / 2 + 0.25);
    });

    it("excludeEntity filters that entity's colliders via the predicate", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const mover = new Entity("mover");
      const bodyHandle = pw.createBody(mover, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const ownCollider = pw.createCollider(
        mover,
        bodyHandle,
        { shape: { type: "circle", radius: 10 } },
        comp,
      );

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      let predicate: ((c: { handle: number }) => boolean) | undefined;
      world.castShape = ((...args: unknown[]) => {
        predicate = args[11] as (c: { handle: number }) => boolean;
        return null;
      }) as unknown as typeof world.castShape;

      pw.castShape(
        { type: "circle", radius: 10 },
        new Vec2(0, 0),
        new Vec2(1, 0),
        100,
        { excludeEntity: mover },
      );

      expect(predicate).toBeDefined();
      expect(predicate!({ handle: ownCollider })).toBe(false);
      expect(predicate!({ handle: 9999 })).toBe(true);
    });
  });

  describe("setColliderShape", () => {
    function setupCollider(pw: PhysicsWorld) {
      const entity = new Entity("mover");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const handle = pw.createCollider(
        entity,
        bodyHandle,
        { shape: { type: "box", width: 20, height: 40 } },
        comp,
      );
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      return { entity, handle, collider: world._colliders.get(handle)! };
    }

    it("swaps the shape on the live collider, keeping its handle", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { handle, collider } = setupCollider(pw);

      pw.setColliderShape(handle, {
        shape: { type: "box", width: 20, height: 20 },
      });

      // 20x20 px at 50px/m -> half-extents of 0.2m.
      expect(collider._shape).toEqual({ kind: "cuboid", hx: 0.2, hy: 0.2 });
      expect(collider.handle).toBe(handle);
    });

    it("leaves the body's mass alone by default", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { handle, collider } = setupCollider(pw);
      const body = collider.parent()!;

      pw.setColliderShape(handle, {
        shape: { type: "box", width: 20, height: 20 },
      });

      expect(body._massRecomputes).toBe(0);
    });

    it("recomputes the body's mass properties when asked", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { handle, collider } = setupCollider(pw);
      const body = collider.parent()!;

      pw.setColliderShape(
        handle,
        { shape: { type: "box", width: 20, height: 20 } },
        { recomputeMass: true },
      );

      expect(body._massRecomputes).toBe(1);
    });

    it("applies the rotation the new shape needs", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { handle, collider } = setupCollider(pw);

      pw.setColliderShape(handle, {
        shape: { type: "capsule", halfHeight: 10, radius: 5, axis: "x" },
      });
      expect(collider._rotationWrtParent).toBeCloseTo(Math.PI / 2);

      // Swapping back to a shape with no base rotation clears it.
      pw.setColliderShape(handle, {
        shape: { type: "box", width: 20, height: 20 },
      });
      expect(collider._rotationWrtParent).toBeCloseTo(0);
    });

    it("no-ops on an unknown handle", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      expect(() =>
        pw.setColliderShape(9999, { shape: { type: "circle", radius: 5 } }),
      ).not.toThrow();
    });
  });

  describe("queryShape / queryRadius", () => {
    function setupQuery(pw: PhysicsWorld) {
      const entities: Entity[] = [];
      const colliderHandles: number[] = [];
      for (const name of ["a", "b"]) {
        const entity = new Entity(name);
        const bodyHandle = pw.createBody(entity, { type: "static" });
        const comp = createMockColliderComponent();
        const handle = pw.createCollider(
          entity,
          bodyHandle,
          {
            shape: { type: "circle", radius: 10 },
          },
          comp,
        );
        entities.push(entity);
        colliderHandles.push(handle);
      }

      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const captured: {
        pos: { x: number; y: number };
        rot: number;
        shape: unknown;
      }[] = [];
      let hitHandles: number[] = [];
      world.intersectionsWithShape = ((
        pos: { x: number; y: number },
        rot: number,
        shape: unknown,
        callback: (c: { handle: number }) => boolean,
      ) => {
        captured.push({ pos, rot, shape });
        for (const handle of hitHandles) {
          if (!callback({ handle })) break;
        }
      }) as unknown as typeof world.intersectionsWithShape;

      return {
        entities,
        colliderHandles,
        captured,
        setHits: (handles: number[]) => {
          hitHandles = handles;
        },
      };
    }

    it("maps overlapping colliders to entities and dedupes repeats", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { entities, colliderHandles, setHits } = setupQuery(pw);
      setHits([colliderHandles[0]!, colliderHandles[1]!, colliderHandles[0]!]);

      const result = pw.queryShape(
        { type: "circle", radius: 40 },
        new Vec2(0, 0),
      );

      expect(result).toEqual([entities[0], entities[1]]);
    });

    it("excludeEntity drops that entity from the results", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { entities, colliderHandles, setHits } = setupQuery(pw);
      setHits([colliderHandles[0]!, colliderHandles[1]!]);

      const result = pw.queryRadius(new Vec2(0, 0), 40, {
        excludeEntity: entities[0]!,
      });

      expect(result).toEqual([entities[1]]);
    });

    it("converts the query position to meters and passes rotation through", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { captured, setHits } = setupQuery(pw);
      setHits([]);

      pw.queryShape({ type: "box", width: 20, height: 10 }, new Vec2(100, 50), {
        rotation: Math.PI / 4,
      });

      expect(captured[0]!.pos.x).toBeCloseTo(2); // 100px / 50ppm
      expect(captured[0]!.pos.y).toBeCloseTo(1);
      expect(captured[0]!.rot).toBeCloseTo(Math.PI / 4);
    });

    it("passes rounded box geometry to overlap queries", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const { captured, setHits } = setupQuery(pw);
      setHits([]);

      pw.queryShape(
        { type: "box", width: 12, height: 44, borderRadius: 2 },
        new Vec2(0, 0),
      );

      expect(captured[0]!.shape).toEqual({
        kind: "roundCuboid",
        hx: 0.08,
        hy: 0.4,
        borderRadius: 0.04,
      });
    });
  });

  describe("removeBody", () => {
    it("removes body and collider mappings", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp,
      );

      expect(pw.bodyMap.has(bodyHandle)).toBe(true);
      expect(pw.colliderMap.has(colHandle)).toBe(true);

      pw.removeBody(bodyHandle);

      expect(pw.bodyMap.has(bodyHandle)).toBe(false);
      expect(pw.colliderMap.has(colHandle)).toBe(false);
    });

    it("leaves each attached ColliderComponent holding no handle", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      comp._colliderHandle = pw.createCollider(
        entity,
        bodyHandle,
        { shape: { type: "box", width: 10, height: 10 } },
        comp,
      );

      pw.removeBody(bodyHandle);

      expect(comp._colliderHandle).toBe(-1);
    });
  });

  describe("removeCollider", () => {
    it("removes the collider mapping, leaving the body intact", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp,
      );

      expect(pw.colliderMap.has(colHandle)).toBe(true);

      pw.removeCollider(colHandle);

      expect(pw.colliderMap.has(colHandle)).toBe(false);
      expect(pw._colliderComponents.has(colHandle)).toBe(false);
      expect(pw.bodyMap.has(bodyHandle)).toBe(true);
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

    it("resolves only handles this world issued and has not freed", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      const colHandle = pw.createCollider(
        entity,
        bodyHandle,
        { shape: { type: "box", width: 10, height: 10 } },
        comp,
      );

      expect(pw.getBody(-1)).toBeUndefined();
      expect(pw.getBody(NaN)).toBeUndefined();
      expect(pw.getCollider(-1)).toBeUndefined();
      expect(pw.getCollider(colHandle)).toBeDefined();

      pw.removeBody(bodyHandle);

      expect(pw.getBody(bodyHandle)).toBeUndefined();
      expect(pw.getCollider(colHandle)).toBeUndefined();
    });
  });

  describe("query sensor mode and freshness", () => {
    function worldOf(pw: PhysicsWorld) {
      return (pw as unknown as { world: InstanceType<typeof mocks.MockWorld> })
        .world;
    }

    function spawnStatic(pw: PhysicsWorld, name = "target") {
      const entity = new Entity(name);
      const bodyHandle = pw.createBody(entity, { type: "static" });
      const handle = pw.createCollider(
        entity,
        bodyHandle,
        { shape: { type: "box", width: 10, height: 10 } },
        createMockColliderComponent(),
      );
      return { entity, bodyHandle, handle };
    }

    it("passes Rapier's sensor flag for each mode on every query", () => {
      const pw = new PhysicsWorld();
      spawnStatic(pw);
      const world = worldOf(pw);
      const rayFlags: unknown[] = [];
      const castFlags: unknown[] = [];
      const shapeFlags: unknown[] = [];
      world.castRayAndGetNormal = ((...args: unknown[]) => {
        rayFlags.push(args[3]);
        return null;
      }) as unknown as typeof world.castRayAndGetNormal;
      world.castShape = ((...args: unknown[]) => {
        castFlags.push(args[7]);
        return null;
      }) as unknown as typeof world.castShape;
      world.intersectionsWithShape = ((...args: unknown[]) => {
        shapeFlags.push(args[4]);
      }) as unknown as typeof world.intersectionsWithShape;
      const shape = { type: "circle", radius: 5 } as const;
      const origin = new Vec2(0, 0);
      const dir = new Vec2(0, 1);

      pw.raycast(origin, dir, 10);
      pw.raycast(origin, dir, 10, { sensors: "include" });
      pw.raycast(origin, dir, 10, { sensors: "only" });
      pw.castShape(shape, origin, dir, 10);
      pw.castShape(shape, origin, dir, 10, { sensors: "include" });
      pw.castShape(shape, origin, dir, 10, { sensors: "only" });
      pw.queryShape(shape, origin);
      pw.queryShape(shape, origin, { sensors: "include" });
      pw.queryRadius(origin, 5, { sensors: "only" });

      expect(rayFlags).toEqual([8, undefined, 16]);
      expect(castFlags).toEqual([8, undefined, 16]);
      expect(shapeFlags).toEqual([8, undefined, 16]);
    });

    it("runs one zero-duration step before the first query after a collider change", () => {
      const pw = new PhysicsWorld();
      const world = worldOf(pw);
      const { handle } = spawnStatic(pw);
      expect(world._stepCount).toBe(0);

      pw.queryShape({ type: "circle", radius: 5 }, new Vec2(0, 0));
      expect(world._stepCount).toBe(1);
      expect(world.timestep).toBe(0);
      expect(pw.elapsed).toBe(0);

      pw.raycast(new Vec2(0, 0), new Vec2(0, 1), 10);
      pw.queryOverlapping(handle);
      expect(world._stepCount).toBe(1);

      pw.setColliderShape(handle, {
        shape: { type: "box", width: 20, height: 20 },
      });
      pw.castShape(
        { type: "circle", radius: 5 },
        new Vec2(0, 0),
        new Vec2(0, 1),
        10,
      );
      expect(world._stepCount).toBe(2);

      pw._markQueriesStale();
      pw.queryRadius(new Vec2(0, 0), 5);
      expect(world._stepCount).toBe(3);

      // A real step refreshes the index itself.
      spawnStatic(pw, "second");
      pw.step(1 / 60);
      pw.queryShape({ type: "circle", radius: 5 }, new Vec2(0, 0));
      expect(world._stepCount).toBe(4);
    });

    it("resets a kinematic body's pending target to its pose before the zero step", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      const world = worldOf(pw);
      const { bodyHandle } = spawnStatic(pw);
      const body = world._bodies.get(bodyHandle)!;
      body._bodyType = "kinematic";
      body._translation = { x: 2, y: 3 };
      body._rotation = 0.25;
      const spyT = vi.spyOn(body, "setNextKinematicTranslation");
      const spyR = vi.spyOn(body, "setNextKinematicRotation");

      pw.queryShape({ type: "circle", radius: 5 }, new Vec2(0, 0));

      expect(spyT).toHaveBeenCalledWith({ x: 2, y: 3 });
      expect(spyR).toHaveBeenCalledWith(0.25);
    });

    it("rejects a negative or non-finite step", () => {
      const pw = new PhysicsWorld();
      expect(() => pw.step(-1)).toThrow(
        "PhysicsWorld.step: dt must be finite and >= 0, got -1.",
      );
      expect(() => pw.step(NaN)).toThrow(
        "PhysicsWorld.step: dt must be finite and >= 0, got NaN.",
      );
    });

    it("rejects a shape it cannot build under the query's own context", () => {
      const pw = new PhysicsWorld();
      const twoPoints = {
        type: "polygon" as const,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      };
      expect(() => pw.queryShape(twoPoints, new Vec2(0, 0))).toThrow(
        "PhysicsWorld.queryShape: shape.vertices must have at least 3 vertices, got 2.",
      );
      expect(() =>
        pw.castShape(twoPoints, new Vec2(0, 0), new Vec2(0, 1), 10),
      ).toThrow(
        "PhysicsWorld.castShape: shape.vertices must have at least 3 vertices, got 2.",
      );
      expect(() => pw.queryRadius(new Vec2(0, 0), 0)).toThrow(
        "PhysicsWorld.queryRadius: radius must be finite and > 0, got 0.",
      );
    });
  });

  describe("step", () => {
    it("sets timestep and calls world.step", () => {
      const pw = new PhysicsWorld();
      pw.step(1 / 60);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      expect(world._stepCalled).toBe(true);
      expect(world.timestep).toBeCloseTo(1 / 60);
    });
  });

  describe("setGravity", () => {
    it("converts gravity from pixels to meters", () => {
      const pw = new PhysicsWorld({ pixelsPerMeter: 50 });
      pw.setGravity(0, 500);
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      expect(world.gravity.y).toBeCloseTo(10); // 500/50 = 10
    });
  });

  describe("destroy", () => {
    it("clears all maps and frees resources", () => {
      const pw = new PhysicsWorld();
      const entity = new Entity("test");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: { type: "box", width: 10, height: 10 },
        },
        comp,
      );

      pw.destroy();

      expect(pw.bodyMap.size).toBe(0);
      expect(pw.colliderMap.size).toBe(0);
    });
  });

  describe("asymmetric collision-mask dev warning", () => {
    it("warns on first asymmetric collider pair", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const a = new Entity("a");
      const b = new Entity("b");
      const bodyA = pw.createBody(a, { type: "dynamic" });
      const bodyB = pw.createBody(b, { type: "dynamic" });
      const compA = createMockColliderComponent();
      const compB = createMockColliderComponent();
      pw.createCollider(
        a,
        bodyA,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0001,
          mask: 0x0002,
        },
        compA,
      );
      pw.createCollider(
        b,
        bodyB,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0004,
          mask: 0x0001,
        },
        compB,
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("Asymmetric collision masks"),
      );
      expect(matching.length).toBe(1);
      warn.mockRestore();
    });

    it("does not warn on symmetric mask pairing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const a = new Entity("a");
      const b = new Entity("b");
      const bodyA = pw.createBody(a, { type: "dynamic" });
      const bodyB = pw.createBody(b, { type: "dynamic" });
      const compA = createMockColliderComponent();
      const compB = createMockColliderComponent();
      pw.createCollider(
        a,
        bodyA,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0001,
          mask: 0x0002,
        },
        compA,
      );
      pw.createCollider(
        b,
        bodyB,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0002,
          mask: 0x0001,
        },
        compB,
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("Asymmetric collision masks"),
      );
      expect(matching.length).toBe(0);
      warn.mockRestore();
    });

    it("warns in the other creation order too, naming the first entity of the signature", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const first = new Entity("first");
      const second = new Entity("second");
      const bodyFirst = pw.createBody(first, { type: "dynamic" });
      const bodySecond = pw.createBody(second, { type: "dynamic" });
      pw.createCollider(
        first,
        bodyFirst,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0004,
          mask: 0x0001,
        },
        createMockColliderComponent(),
      );
      pw.createCollider(
        second,
        bodySecond,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0001,
          mask: 0x0002,
        },
        createMockColliderComponent(),
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("Asymmetric collision masks"),
      );
      expect(matching.length).toBe(1);
      expect(String(matching[0]![0])).toContain("<first>");
      expect(String(matching[0]![0])).toContain("<second>");
      warn.mockRestore();
    });

    it("never warns for default-layer colliders, however many", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      for (let i = 0; i < 300; i++) {
        const e = new Entity(`e${i}`);
        const body = pw.createBody(e, { type: "static" });
        pw.createCollider(
          e,
          body,
          { shape: { type: "box", width: 10, height: 10 } },
          createMockColliderComponent(),
        );
      }
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("dedupes by (layers, mask) tuple across multiple offenders", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const a = new Entity("a");
      const bodyA = pw.createBody(a, { type: "dynamic" });
      const compA = createMockColliderComponent();
      pw.createCollider(
        a,
        bodyA,
        {
          shape: { type: "box", width: 10, height: 10 },
          layers: 0x0001,
          mask: 0x0002,
        },
        compA,
      );
      for (let i = 0; i < 3; i++) {
        const e = new Entity(`b${i}`);
        const body = pw.createBody(e, { type: "dynamic" });
        const comp = createMockColliderComponent();
        pw.createCollider(
          e,
          body,
          {
            shape: { type: "box", width: 10, height: 10 },
            layers: 0x0004,
            mask: 0x0001,
          },
          comp,
        );
      }

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("Asymmetric collision masks"),
      );
      expect(matching.length).toBe(1);
      warn.mockRestore();
    });
  });

  describe("convex-hull vertex-drop dev warning", () => {
    it("warns when the resulting hull has fewer vertices than the input", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const origCreate = world.createCollider.bind(world);
      world.createCollider = (desc, parent) => {
        const c = origCreate(desc, parent);
        (c as unknown as { vertices: () => Float32Array }).vertices = () =>
          new Float32Array([0, 0, 1, 0, 0, 1]); // 3 vertices
        return c;
      };

      const entity = new Entity("concave");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: {
            type: "polygon",
            vertices: [
              new Vec2(0, 0),
              new Vec2(1, 0),
              new Vec2(1, 1),
              new Vec2(0.5, 0.3),
              new Vec2(0, 1),
            ],
          },
        },
        comp,
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("reduced to 3 after convex hull"),
      );
      expect(matching.length).toBe(1);
      warn.mockRestore();
    });

    it("does not warn when hull preserves all input vertices", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pw = new PhysicsWorld();
      const world = (
        pw as unknown as { world: InstanceType<typeof mocks.MockWorld> }
      ).world;
      const origCreate = world.createCollider.bind(world);
      world.createCollider = (desc, parent) => {
        const c = origCreate(desc, parent);
        (c as unknown as { vertices: () => Float32Array }).vertices = () =>
          new Float32Array([0, 0, 1, 0, 0, 1]); // 3 vertices
        return c;
      };

      const entity = new Entity("convex");
      const bodyHandle = pw.createBody(entity, { type: "dynamic" });
      const comp = createMockColliderComponent();
      pw.createCollider(
        entity,
        bodyHandle,
        {
          shape: {
            type: "polygon",
            vertices: [new Vec2(0, 0), new Vec2(1, 0), new Vec2(0, 1)],
          },
        },
        comp,
      );

      const matching = warn.mock.calls.filter((args) =>
        String(args[0]).includes("after convex hull"),
      );
      expect(matching.length).toBe(0);
      warn.mockRestore();
    });
  });
});
