import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;
  let nextColliderHandle = 0;

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

  class MockCollider {
    handle: number;
    _sensor = false;
    constructor() { this.handle = nextColliderHandle++; }
    isSensor() { return this._sensor; }
    setSensor(s: boolean) { this._sensor = s; }
    setShape() {}
  }

  class MockRigidBody {
    handle: number;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _linvel = { x: 0, y: 0 };
    _angvel = 0;
    _colliders: MockCollider[] = [];
    _bodyType: string;

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
    setLinvel(v: { x: number; y: number }) { this._linvel = { ...v }; }
    setAngvel(v: number) { this._angvel = v; }
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    setNextKinematicTranslation(t: { x: number; y: number }) { this._translation = { ...t }; }
    setNextKinematicRotation(r: number) { this._rotation = r; }
    isDynamic() { return this._bodyType === "dynamic"; }
    isFixed() { return this._bodyType === "fixed"; }
    isKinematic() { return this._bodyType === "kinematic"; }
    numColliders() { return this._colliders.length; }
    collider(i: number) { return this._colliders[i]; }
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
  }

  type DrainCallback = (h1: number, h2: number, started: boolean) => void;

  class MockEventQueue {
    _events: Array<[number, number, boolean]> = [];
    drainCollisionEvents(f: DrainCallback) {
      for (const [h1, h2, started] of this._events) f(h1, h2, started);
      this._events = [];
    }
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
    createRigidBody(desc: MockRigidBodyDesc): MockRigidBody {
      const body = new MockRigidBody(desc._type);
      this._bodies.set(body.handle, body);
      return body;
    }
    createCollider(desc: MockColliderDesc, parent: MockRigidBody): MockCollider {
      const collider = new MockCollider();
      if (desc._sensor) collider._sensor = true;
      parent._colliders.push(collider);
      this._colliders.set(collider.handle, collider);
      return collider;
    }
    getRigidBody(handle: number) { return this._bodies.get(handle); }
    getCollider(handle: number) { return this._colliders.get(handle); }
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
    ActiveEvents: { COLLISION_EVENTS: 1 },
  },
}));

import {
  Transform,
  Vec2,
  EngineContext,
  SystemScheduler,
  ErrorBoundary,
  Logger,
  LogLevel,
  Phase,
} from "@yage/core";
import {
  PhysicsPlugin,
  PhysicsWorld,
  PhysicsWorldKey,
  PhysicsInterpolationAlphaKey,
  RigidBodyComponent,
  ColliderComponent,
  PhysicsSystem,
  PhysicsInterpolationSystem,
  CollisionLayers,
} from "./index.js";
import type { CollisionEvent, TriggerEvent } from "./index.js";
import { createPhysicsTestContext, spawnEntityInScene } from "./test-helpers.js";

describe("Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  it("spawn entity with physics components → tick → Transform updated", () => {
    const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
    const system = new PhysicsSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "ball");
    const transform = entity.add(new Transform({ position: new Vec2(100, 100) }));
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
    entity.add(new ColliderComponent({ shape: { type: "circle", radius: 25 } }));

    // Simulate physics moving the body
    const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
    body._translation = { x: 2.2, y: 3.0 }; // meters → 110px, 150px
    body._rotation = 0.5;

    system.update(16.67);

    expect(transform.position.x).toBeCloseTo(110);
    expect(transform.position.y).toBeCloseTo(150);
    expect(transform.rotation).toBeCloseTo(0.5);
  });

  it("two colliding entities → collision handler called", () => {
    const { scene, physicsWorld, context } = createPhysicsTestContext();
    const system = new PhysicsSystem();
    system._setContext(context);

    const e1 = spawnEntityInScene(scene, "e1");
    e1.add(new Transform());
    e1.add(new RigidBodyComponent({ type: "dynamic" }));
    const col1 = e1.add(new ColliderComponent({ shape: { type: "box", width: 10, height: 10 } }));

    const e2 = spawnEntityInScene(scene, "e2");
    e2.add(new Transform());
    e2.add(new RigidBodyComponent({ type: "dynamic" }));
    const col2 = e2.add(new ColliderComponent({ shape: { type: "box", width: 10, height: 10 } }));

    const events: CollisionEvent[] = [];
    col1.onCollision((e) => events.push(e));

    // Inject collision event
    const eq = (physicsWorld as unknown as { eventQueue: InstanceType<typeof mocks.MockEventQueue> }).eventQueue;
    eq._events.push([col1._colliderHandle, col2._colliderHandle, true]);

    system.update(16.67);

    expect(events).toHaveLength(1);
    const ev = events[0] as CollisionEvent;
    expect(ev.other).toBe(e2);
    expect(ev.started).toBe(true);
  });

  it("sensor trigger event dispatched correctly", () => {
    const { scene, physicsWorld, context } = createPhysicsTestContext();
    const system = new PhysicsSystem();
    system._setContext(context);

    const player = spawnEntityInScene(scene, "player");
    player.add(new Transform());
    player.add(new RigidBodyComponent({ type: "dynamic" }));
    const playerCol = player.add(new ColliderComponent({
      shape: { type: "box", width: 16, height: 16 },
    }));

    const trigger = spawnEntityInScene(scene, "trigger");
    trigger.add(new Transform());
    trigger.add(new RigidBodyComponent({ type: "static" }));
    const triggerCol = trigger.add(new ColliderComponent({
      shape: { type: "box", width: 32, height: 32 },
      sensor: true,
    }));

    const triggers: TriggerEvent[] = [];
    triggerCol.onTrigger((e) => triggers.push(e));

    const eq = (physicsWorld as unknown as { eventQueue: InstanceType<typeof mocks.MockEventQueue> }).eventQueue;
    eq._events.push([triggerCol._colliderHandle, playerCol._colliderHandle, true]);

    system.update(16.67);

    expect(triggers).toHaveLength(1);
    const trig = triggers[0] as TriggerEvent;
    expect(trig.other).toBe(player);
    expect(trig.entered).toBe(true);
  });

  it("kinematic body driven by Transform", () => {
    const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
    const system = new PhysicsSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "platform");
    const transform = entity.add(new Transform({ position: new Vec2(100, 100) }));
    const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

    const body = physicsWorld.getBody(rb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
    body._bodyType = "kinematic";

    // Move transform
    transform.setPosition(200, 300);

    system.update(16.67);

    // Rapier body should have been synced
    expect(body._translation.x).toBeCloseTo(4); // 200/50
    expect(body._translation.y).toBeCloseTo(6); // 300/50
  });

  it("entity destroy removes body from physics world", () => {
    const { scene, physicsWorld } = createPhysicsTestContext();
    const entity = spawnEntityInScene(scene, "test");
    entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
    entity.add(new ColliderComponent({ shape: { type: "box", width: 10, height: 10 } }));

    const bodyHandle = rb._bodyHandle;
    expect(physicsWorld.bodyMap.has(bodyHandle)).toBe(true);

    // Remove RigidBodyComponent triggers onDestroy
    entity.remove(RigidBodyComponent);

    expect(physicsWorld.bodyMap.has(bodyHandle)).toBe(false);
  });

  it("collision layers applied correctly", () => {
    const layers = new CollisionLayers();
    const playerLayer = layers.define("player");
    const enemyLayer = layers.define("enemy");
    const projectileLayer = layers.define("projectile");

    expect(playerLayer).toBe(1);
    expect(enemyLayer).toBe(2);
    expect(projectileLayer).toBe(4);

    // Player interacts with enemy and projectile
    const playerMask = layers.combine("enemy", "projectile");
    expect(playerMask).toBe(2 | 4);

    // Interaction groups encoding
    const groups = CollisionLayers.interactionGroups(playerLayer, playerMask);
    expect(groups).toBe((1 << 16) | 6);
  });

  it("interpolation blends positions between prev and curr", () => {
    const { scene, context } = createPhysicsTestContext();
    const interpSystem = new PhysicsInterpolationSystem();
    interpSystem._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = Math.PI;

    // alpha = 0 → prev position
    interpSystem.update(0);
    expect(transform.position.x).toBeCloseTo(0);
    expect(transform.position.y).toBeCloseTo(0);

    // Set alpha to 0.5 via the physics interpolation alpha ref
    context.resolve(PhysicsInterpolationAlphaKey).value = 0.5;

    interpSystem.update(0);
    expect(transform.position.x).toBeCloseTo(50);
    expect(transform.position.y).toBeCloseTo(100);
  });

  it("full round-trip: plugin installs world and systems", () => {
    const context = new EngineContext();
    const scheduler = new SystemScheduler();
    const logger = new Logger({ level: LogLevel.Debug });
    const boundary = new ErrorBoundary(logger);
    scheduler.setErrorBoundary(boundary);

    const plugin = new PhysicsPlugin({ gravity: { x: 0, y: 500 }, pixelsPerMeter: 100 });
    plugin.install(context);

    expect(context.has(PhysicsWorldKey)).toBe(true);
    const world = context.resolve(PhysicsWorldKey);
    expect(world.pixelsPerMeter).toBe(100);

    plugin.registerSystems(scheduler);

    const fixedSystems = scheduler.getSystems(Phase.FixedUpdate);
    const lateSystems = scheduler.getSystems(Phase.LateUpdate);
    expect(fixedSystems.length).toBe(1);
    expect(lateSystems.length).toBe(1);

    // Cleanup
    plugin.onDestroy();
  });

  it("multiple entities with different body types coexist", () => {
    const { scene, physicsWorld, context } = createPhysicsTestContext({ pixelsPerMeter: 50 });
    const system = new PhysicsSystem();
    system._setContext(context);

    // Dynamic ball
    const ball = spawnEntityInScene(scene, "ball");
    ball.add(new Transform({ position: new Vec2(100, 100) }));
    const ballRb = ball.add(new RigidBodyComponent({ type: "dynamic" }));
    ball.add(new ColliderComponent({ shape: { type: "circle", radius: 10 } }));

    // Static ground
    const ground = spawnEntityInScene(scene, "ground");
    ground.add(new Transform({ position: new Vec2(400, 500) }));
    const groundRb = ground.add(new RigidBodyComponent({ type: "static" }));
    ground.add(new ColliderComponent({ shape: { type: "box", width: 800, height: 20 } }));

    // Kinematic platform
    const platform = spawnEntityInScene(scene, "platform");
    const platTransform = platform.add(new Transform({ position: new Vec2(200, 300) }));
    const platRb = platform.add(new RigidBodyComponent({ type: "kinematic" }));
    platform.add(new ColliderComponent({ shape: { type: "box", width: 100, height: 10 } }));

    // Adjust body types in mock
    const groundBody = physicsWorld.getBody(groundRb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
    groundBody._bodyType = "fixed";
    const platBody = physicsWorld.getBody(platRb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
    platBody._bodyType = "kinematic";

    // Move platform transform
    platTransform.setPosition(250, 310);

    // Move ball in physics
    const ballBody = physicsWorld.getBody(ballRb._bodyHandle) as unknown as InstanceType<typeof mocks.MockRigidBody>;
    ballBody._translation = { x: 2.2, y: 2.4 }; // 110px, 120px

    system.update(16.67);

    // Ball transform updated
    const ballTransform = ball.get(Transform);
    expect(ballTransform.position.x).toBeCloseTo(110);
    expect(ballTransform.position.y).toBeCloseTo(120);

    // Ground transform unchanged (static)
    const groundTransform = ground.get(Transform);
    expect(groundTransform.position.x).toBe(400);
    expect(groundTransform.position.y).toBe(500);

    // Platform kinematic position synced to Rapier
    expect(platBody._translation.x).toBeCloseTo(5); // 250/50
    expect(platBody._translation.y).toBeCloseTo(6.2); // 310/50
  });

  it("exports all public APIs from index", () => {
    // Verify all expected exports exist
    expect(PhysicsPlugin).toBeDefined();
    expect(PhysicsWorld).toBeDefined();
    expect(PhysicsWorldKey).toBeDefined();
    expect(RigidBodyComponent).toBeDefined();
    expect(ColliderComponent).toBeDefined();
    expect(PhysicsSystem).toBeDefined();
    expect(PhysicsInterpolationSystem).toBeDefined();
    expect(CollisionLayers).toBeDefined();
  });
});
