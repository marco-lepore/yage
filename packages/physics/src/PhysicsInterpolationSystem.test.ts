import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
  let nextBodyHandle = 0;

  class MockRigidBodyDesc {
    _type = "dynamic";
    static dynamic() {
      const d = new MockRigidBodyDesc();
      d._type = "dynamic";
      return d;
    }
    static fixed() {
      const d = new MockRigidBodyDesc();
      d._type = "fixed";
      return d;
    }
    static kinematicPositionBased() {
      const d = new MockRigidBodyDesc();
      d._type = "kinematic";
      return d;
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

  class MockRigidBody {
    handle: number;
    _translation = { x: 0, y: 0 };
    _rotation = 0;
    _linvel = { x: 0, y: 0 };
    _angvel = 0;
    _colliders: unknown[] = [];
    _bodyType: string;
    _nextKinematicTranslation: { x: number; y: number } | null = null;
    _nextKinematicRotation: number | null = null;

    constructor(bodyType = "dynamic") {
      this.handle = nextBodyHandle++;
      this._bodyType = bodyType;
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
    addForce() {}
    applyImpulse() {}
    addTorque() {}
    setNextKinematicTranslation(t: { x: number; y: number }) {
      this._nextKinematicTranslation = { ...t };
    }
    setNextKinematicRotation(r: number) {
      this._nextKinematicRotation = r;
    }
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
    recomputeMassPropertiesFromColliders() {}
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

    /**
     * Integrates dynamic bodies at constant velocity and makes kinematic
     * bodies adopt their queued next pose — Rapier's position-based
     * kinematic behavior.
     */
    step() {
      for (const body of this._bodies.values()) {
        if (body.isDynamic()) {
          body._translation = {
            x: body._translation.x + body._linvel.x * this.timestep,
            y: body._translation.y + body._linvel.y * this.timestep,
          };
          body._rotation += body._angvel * this.timestep;
        } else if (body.isKinematic()) {
          if (body._nextKinematicTranslation) {
            body._translation = { ...body._nextKinematicTranslation };
          }
          if (body._nextKinematicRotation !== null) {
            body._rotation = body._nextKinematicRotation;
          }
        }
      }
    }

    createRigidBody(desc: MockRigidBodyDesc): MockRigidBody {
      const body = new MockRigidBody(desc._type);
      this._bodies.set(body.handle, body);
      return body;
    }
    createCollider() {
      return { handle: 0 };
    }
    getRigidBody(handle: number) {
      return this._bodies.get(handle);
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
    ActiveEvents: { COLLISION_EVENTS: 1 },
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

import {
  Component,
  ComponentFixedUpdateSystem,
  ComponentUpdateSystem,
  Phase,
  SceneTime,
  SceneTimeKey,
  Transform,
  Vec2,
} from "@yagejs/core";
import type {
  EngineContext,
  GameLoop,
  System,
  SystemScheduler,
} from "@yagejs/core";
import { RigidBodyComponent } from "./RigidBodyComponent.js";
import { PhysicsInterpolationSystem } from "./PhysicsInterpolationSystem.js";
import { PhysicsSystem } from "./PhysicsSystem.js";
import {
  createPhysicsTestContext,
  createTestScene,
  spawnEntityInScene,
} from "./test-helpers.js";

/**
 * Register the physics systems and let the real GameLoop drive them, so the
 * fixed-step cadence and the loop's leftover frame time are the ones under
 * test rather than hand-set values.
 */
function runPhysicsUnderGameLoop(
  context: EngineContext,
  gameLoop: GameLoop,
  scheduler: SystemScheduler,
  extraSystems: System[] = [],
): void {
  for (const system of [
    new PhysicsSystem(),
    new PhysicsInterpolationSystem(),
  ]) {
    system._setContext(context);
    scheduler.add(system);
  }
  for (const system of extraSystems) {
    system._setContext(context);
    system.onRegister?.(context);
    scheduler.add(system);
  }

  gameLoop.setCallbacks({
    earlyUpdate: (dt) => scheduler.run(Phase.EarlyUpdate, dt),
    fixedUpdate: (dt) => scheduler.run(Phase.FixedUpdate, dt),
    update: (dt) => scheduler.run(Phase.Update, dt),
    lateUpdate: (dt) => scheduler.run(Phase.LateUpdate, dt),
    render: (dt) => scheduler.run(Phase.Render, dt),
    endOfFrame: (dt) => scheduler.run(Phase.EndOfFrame, dt),
  });
  gameLoop.start();
}

describe("PhysicsInterpolationSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resetHandles();
  });

  it("declares the Update phase at priority -100", async () => {
    const system = new PhysicsInterpolationSystem();
    expect(system.phase).toBe(Phase.Update);
    expect(system.priority).toBe(-100);
  });

  it("with nothing accumulated, transform equals prev position", async () => {
    const { scene, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(100, 100);
    rb._currPosition = new Vec2(200, 200);
    rb._prevRotation = 0;
    rb._currRotation = Math.PI;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(100);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(0);
  });

  it("with half a fixed step accumulated, transform is the midpoint", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.5;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(50);
    expect(transform.position.y).toBeCloseTo(100);
    expect(transform.rotation).toBeCloseTo(1);
  });

  it("with a full fixed step accumulated, transform equals curr position", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 200);
    rb._prevRotation = 0;
    rb._currRotation = 2;

    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(100, 0);
    expect(transform.position.y).toBeCloseTo(200, 0);
    expect(transform.rotation).toBeCloseTo(2, 0);
  });

  it("clamps alpha to 1 when more than one step is waiting", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(100, 0);

    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 4;

    system.update(0);

    expect(manager.getContext(scene)!.alphaRef.value).toBe(1);
    expect(transform.position.x).toBeCloseTo(100);
  });

  it("interpolates rotation along the shortest arc across the ±π boundary", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "spinner");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    // A body spinning forward past π: Rapier reports the next pose wrapped
    // to the negative side. A raw lerp would sweep backwards through 0.
    rb._prevRotation = Math.PI - 0.1;
    rb._currRotation = -Math.PI + 0.1;
    rb._prevPosition = Vec2.ZERO;
    rb._currPosition = Vec2.ZERO;

    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.5;

    system.update(0);

    expect(Math.abs(transform.rotation)).toBeCloseTo(Math.PI, 6);
  });

  it("interpolates rotation", async () => {
    const { scene, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "test");
    const transform = entity.add(new Transform());
    const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

    rb._prevRotation = 0;
    rb._currRotation = Math.PI;
    rb._prevPosition = Vec2.ZERO;
    rb._currPosition = Vec2.ZERO;

    system.update(0);

    expect(transform.rotation).toBeCloseTo(0);
  });

  it("skips static bodies", async () => {
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

  it("interpolates kinematic bodies between prev and curr", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "kinematic");
    const transform = entity.add(new Transform({ position: new Vec2(75, 75) }));
    const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

    rb._prevPosition = new Vec2(0, 0);
    rb._currPosition = new Vec2(200, 200);

    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.5;

    system.update(0);

    expect(transform.position.x).toBeCloseTo(100);
    expect(transform.position.y).toBeCloseTo(100);
  });

  it("captures a game Transform write as the kinematic step target before lerping", async () => {
    const { scene, context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "kinematic");
    const transform = entity.add(new Transform({ position: new Vec2(75, 75) }));
    const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

    transform.setPosition(300, 400);
    transform.setRotation(1.5);

    system.update(0);

    expect(rb._kinematicTargetPosition.x).toBe(300);
    expect(rb._kinematicTargetPosition.y).toBe(400);
    expect(rb._kinematicTargetRotation).toBe(1.5);
    // The Transform itself now holds the interpolated pose.
    expect(transform.position.x).toBeCloseTo(75);
    expect(transform.position.y).toBeCloseTo(75);
  });

  it("does not feed its own lerp output back into the kinematic target", async () => {
    const { scene, manager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    const entity = spawnEntityInScene(scene, "kinematic");
    entity.add(new Transform({ position: new Vec2(100, 0) }));
    const rb = entity.add(new RigidBodyComponent({ type: "kinematic" }));

    // A step segment is in flight; the target is ahead of it.
    rb._prevPosition = new Vec2(80, 0);
    rb._currPosition = new Vec2(90, 0);
    rb._kinematicTargetPosition = new Vec2(100, 0);

    // Two frames with different alphas, no game write in between: the lerp
    // writes a trailing pose into the Transform each time, and the target
    // must not follow it backwards.
    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.5;
    system.update(0);
    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.75;
    system.update(0);

    expect(rb._kinematicTargetPosition.x).toBe(100);
  });

  it("blends each scene by its own accumulator", async () => {
    const { scene, manager, sceneManager, gameLoop, context } =
      await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    // Scene 1: half a step waiting
    const e1 = spawnEntityInScene(scene, "e1");
    const t1 = e1.add(new Transform());
    const rb1 = e1.add(new RigidBodyComponent({ type: "dynamic" }));
    rb1._prevPosition = new Vec2(0, 0);
    rb1._currPosition = new Vec2(100, 0);
    manager.getContext(scene)!.accumulator = gameLoop.fixedTimestep * 0.5;

    // Scene 2: a full step waiting
    const scene2 = await createTestScene(sceneManager, "scene2", {
      pauseBelow: false,
    });
    manager.getOrCreateWorld(scene2);
    const e2 = spawnEntityInScene(scene2, "e2");
    const t2 = e2.add(new Transform());
    const rb2 = e2.add(new RigidBodyComponent({ type: "dynamic" }));
    rb2._prevPosition = new Vec2(0, 0);
    rb2._currPosition = new Vec2(100, 0);
    manager.getContext(scene2)!.accumulator = gameLoop.fixedTimestep;

    system.update(0);

    expect(t1.position.x).toBeCloseTo(50);
    expect(t2.position.x).toBeCloseTo(100);
  });

  it("handles empty scene gracefully", async () => {
    const { context } = await createPhysicsTestContext();
    const system = new PhysicsInterpolationSystem();
    system._setContext(context);

    expect(() => system.update(0)).not.toThrow();
  });

  describe("alpha production", () => {
    it("advances alpha by each frame's share of a fixed step and wraps on a step", async () => {
      const { scene, manager, gameLoop, scheduler, context } =
        await createPhysicsTestContext();
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const ctx = manager.getContext(scene)!;
      const alphas: number[] = [];
      // 10 ms frames against a 1/60 s step: 0.6 of a step per frame.
      for (let i = 0; i < 5; i++) {
        gameLoop.tick(10);
        alphas.push(ctx.alphaRef.value);
      }

      expect(alphas[0]).toBeCloseTo(0.6, 3);
      expect(alphas[1]).toBeCloseTo(0.2, 3);
      expect(alphas[2]).toBeCloseTo(0.8, 3);
      expect(alphas[3]).toBeCloseTo(0.4, 3);
      // Frame 5 completes exactly three fixed steps in 50 ms.
      expect(alphas[4]).toBeCloseTo(0.0, 3);
    });

    it("refreshes alpha on a frame that runs no fixed step", async () => {
      const { scene, manager, gameLoop, scheduler, context } =
        await createPhysicsTestContext();
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "test");
      entity.add(new Transform());
      entity.add(new RigidBodyComponent({ type: "dynamic" }));

      const ctx = manager.getContext(scene)!;
      const alphas: number[] = [];
      // Half-step frames: every other frame runs no fixed step at all, and
      // still has to land on a fresh alpha.
      for (let i = 0; i < 4; i++) {
        gameLoop.tick(1000 / 120);
        alphas.push(ctx.alphaRef.value);
      }

      expect(alphas[0]).toBeCloseTo(0.5, 3);
      expect(alphas[1]).toBeCloseTo(0.0, 3);
      expect(alphas[2]).toBeCloseTo(0.5, 3);
      expect(alphas[3]).toBeCloseTo(0.0, 3);
    });
  });

  describe("smoothness", () => {
    it("advances the drawn position by the same distance every frame", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "mover");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: 0 });

      const drawn: number[] = [];
      for (let i = 0; i < 20; i++) {
        gameLoop.tick(10);
        drawn.push(transform.worldPosition.x);
      }

      // 300 px/s over 10 ms frames = 3 px per frame, once the first fixed
      // step has produced a segment to blend across.
      const steady = drawn.slice(2);
      for (let i = 1; i < steady.length; i++) {
        const advance = steady[i]! - steady[i - 1]!;
        expect(advance).toBeCloseTo(3, 6);
      }
    });
  });

  describe("scene time scale", () => {
    it("holds alpha and the drawn pose still while the scene is frozen", async () => {
      const { scene, manager, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });
      const time = new SceneTime(scene);
      scene.registerScoped(SceneTimeKey, time);
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "mover");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: 0 });

      // 4 × 10 ms frames leave alpha mid-blend (0.4), so the assertions
      // below also cover the freeze onset: dropping to a recomputed alpha
      // on the first frozen frame would move the drawn pose backwards.
      for (let i = 0; i < 4; i++) gameLoop.tick(10);

      const frozenAlpha = manager.getContext(scene)!.alphaRef.value;
      const frozenX = transform.worldPosition.x;
      expect(frozenAlpha).toBeCloseTo(0.4, 3);

      time.freezeFor(10);

      for (let i = 0; i < 5; i++) {
        gameLoop.tick(10);
        expect(manager.getContext(scene)!.alphaRef.value).toBe(frozenAlpha);
        expect(transform.worldPosition.x).toBe(frozenX);
      }
    });

    it("advances the drawn pose at half speed under a half time scale", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });
      scene.timeScale = 0.5;
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "mover");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: 0 });

      const drawn: number[] = [];
      for (let i = 0; i < 24; i++) {
        gameLoop.tick(10);
        drawn.push(transform.worldPosition.x);
      }

      // Half of the 3 px per frame the same body covers at full speed.
      const steady = drawn.slice(4);
      for (let i = 1; i < steady.length; i++) {
        const advance = steady[i]! - steady[i - 1]!;
        expect(advance).toBeCloseTo(1.5, 6);
      }
    });
  });

  describe("paused scenes", () => {
    it("leaves a paused scene's alpha frozen while other scenes keep moving", async () => {
      const { scene, manager, sceneManager, gameLoop, scheduler, context } =
        await createPhysicsTestContext();
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const e1 = spawnEntityInScene(scene, "e1");
      e1.add(new Transform());
      e1.add(new RigidBodyComponent({ type: "dynamic" }));

      gameLoop.tick(10);

      // A scene pushed on top with pauseBelow pauses the one underneath.
      const overlay = await createTestScene(sceneManager, "overlay");
      const e2 = spawnEntityInScene(overlay, "e2");
      e2.add(new Transform());
      e2.add(new RigidBodyComponent({ type: "dynamic" }));

      const pausedCtx = manager.getContext(scene)!;
      const activeCtx = manager.getContext(overlay)!;

      gameLoop.tick(10);
      const pausedAlpha = pausedCtx.alphaRef.value;
      const activeAlphas: number[] = [];

      for (let i = 0; i < 4; i++) {
        gameLoop.tick(10);
        expect(pausedCtx.alphaRef.value).toBe(pausedAlpha);
        activeAlphas.push(activeCtx.alphaRef.value);
      }

      expect(new Set(activeAlphas).size).toBeGreaterThan(1);
    });
  });

  describe("ordering", () => {
    it("gives component update() the position that is still there at render time", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      const observed: number[] = [];

      class PositionProbe extends Component {
        private readonly transform = this.sibling(Transform);
        override update(): void {
          observed.push(this.transform.worldPosition.x);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentUpdateSystem(),
      ]);

      const entity = spawnEntityInScene(scene, "mover");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: 0 });
      entity.add(new PositionProbe());

      for (let i = 0; i < 6; i++) {
        gameLoop.tick(10);
        // Nothing after the Update phase moves the body, so what the
        // component saw is what gets drawn.
        expect(observed[observed.length - 1]).toBe(transform.worldPosition.x);
      }

      expect(observed.length).toBe(6);
    });
  });

  describe("kinematic bodies under the game loop", () => {
    const SPEED = 60; // px/s → 1 px per 1/60 s fixed step

    it("keeps the drawn platform–rider gap constant through direction reversals", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      // Reverses both the authored platform and the rider's velocity on the
      // same fixed step, like the issue's repro: platform and rider travel
      // together, so their DRAWN gap must never wobble.
      class PlatformMover extends Component {
        private readonly transform = this.sibling(Transform);
        dir = 1;
        steps = 0;
        riderRb!: RigidBodyComponent;
        override fixedUpdate(dt: number): void {
          if (++this.steps % 6 === 0) {
            this.dir = -this.dir;
            this.riderRb.setVelocity({ x: SPEED * this.dir, y: 0 });
          }
          this.transform.translate(SPEED * this.dir * dt, 0);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentFixedUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      const platformTransform = platform.add(new Transform());
      platform.add(new RigidBodyComponent({ type: "kinematic" }));
      const mover = platform.add(new PlatformMover());

      const rider = spawnEntityInScene(scene, "rider");
      const riderTransform = rider.add(
        new Transform({ position: new Vec2(0, -20) }),
      );
      const riderRb = rider.add(new RigidBodyComponent({ type: "dynamic" }));
      riderRb.setVelocity({ x: SPEED, y: 0 });
      mover.riderRb = riderRb;

      const gaps: number[] = [];
      for (let i = 0; i < 40; i++) {
        gameLoop.tick(10);
        gaps.push(
          riderTransform.worldPosition.x - platformTransform.worldPosition.x,
        );
      }

      // Skip the first frames while prev/curr and the target pipeline fill.
      const steady = gaps.slice(6);
      for (const gap of steady) {
        expect(gap).toBeCloseTo(steady[0]!, 6);
      }
    });

    it("moves the body at exactly the authored velocity — absolute-pose author", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      class AbsoluteMover extends Component {
        private readonly transform = this.sibling(Transform);
        private readonly rb = this.sibling(RigidBodyComponent);
        x = 0;
        bodyX: number[] = [];
        override fixedUpdate(dt: number): void {
          this.bodyX.push(this.rb.positionX);
          this.x += SPEED * dt;
          this.transform.setPosition(this.x, 0);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentFixedUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      platform.add(new Transform());
      platform.add(new RigidBodyComponent({ type: "kinematic" }));
      const mover = platform.add(new AbsoluteMover());

      for (let i = 0; i < 40; i++) gameLoop.tick(10);

      // Per-step body travel must match the authored velocity exactly — a
      // lagged or blended target would pull the body off that speed.
      const travel = mover.bodyX
        .slice(3)
        .map((x, i, a) => (i ? x - a[i - 1]! : 0));
      for (const step of travel.slice(1)) {
        expect(step).toBeCloseTo(SPEED / 60, 6);
      }
    });

    it("moves the body at exactly the authored velocity — translate() author", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      // Accumulating on the Transform only works because postStep restores
      // the reached pose before fixedUpdate runs; otherwise the deltas would
      // stack on the interpolated (trailing) pose and the platform would
      // fall behind its authored velocity.
      class DeltaMover extends Component {
        private readonly transform = this.sibling(Transform);
        private readonly rb = this.sibling(RigidBodyComponent);
        bodyX: number[] = [];
        override fixedUpdate(dt: number): void {
          this.bodyX.push(this.rb.positionX);
          this.transform.translate(SPEED * dt, 0);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentFixedUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      platform.add(new Transform());
      platform.add(new RigidBodyComponent({ type: "kinematic" }));
      const mover = platform.add(new DeltaMover());

      for (let i = 0; i < 40; i++) gameLoop.tick(10);

      const travel = mover.bodyX
        .slice(3)
        .map((x, i, a) => (i ? x - a[i - 1]! : 0));
      for (const step of travel.slice(1)) {
        expect(step).toBeCloseTo(SPEED / 60, 6);
      }
    });

    it("keeps the authored velocity on catch-up frames that run two steps", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      // 34 ms ticks against a 1/60 s step: every frame runs two fixed steps
      // with no interpolation pass between them. The pre-step capture must
      // hand the second step the author's fresh write; a once-per-frame
      // capture would alternate a no-op step with a doubled one.
      class DeltaMover extends Component {
        private readonly transform = this.sibling(Transform);
        private readonly rb = this.sibling(RigidBodyComponent);
        bodyX: number[] = [];
        override fixedUpdate(dt: number): void {
          this.bodyX.push(this.rb.positionX);
          this.transform.translate(SPEED * dt, 0);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentFixedUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      platform.add(new Transform());
      platform.add(new RigidBodyComponent({ type: "kinematic" }));
      const mover = platform.add(new DeltaMover());

      for (let i = 0; i < 20; i++) gameLoop.tick(34);

      const travel = mover.bodyX
        .slice(3)
        .map((x, i, a) => (i ? x - a[i - 1]! : 0));
      for (const step of travel.slice(1)) {
        expect(step).toBeCloseTo(SPEED / 60, 6);
      }
    });

    it("captures update()-authored movement on the next frame", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      class UpdateMover extends Component {
        private readonly transform = this.sibling(Transform);
        override update(): void {
          this.transform.setPosition(240, 0);
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      platform.add(new Transform());
      const rb = platform.add(new RigidBodyComponent({ type: "kinematic" }));
      platform.add(new UpdateMover());

      // Frame 1: the write lands after interpolation ran — not yet captured.
      gameLoop.tick(10);
      expect(rb._kinematicTargetPosition.x).toBe(0);

      // Frame 2: captured; the following steps drive the body there.
      gameLoop.tick(10);
      expect(rb._kinematicTargetPosition.x).toBe(240);

      for (let i = 0; i < 4; i++) gameLoop.tick(10);
      expect(rb.positionX).toBeCloseTo(240, 6);
    });

    it("rb.setPosition teleports without smoothing and without target pull-back", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      class TeleportingMover extends Component {
        private readonly transform = this.sibling(Transform);
        private readonly rb = this.sibling(RigidBodyComponent);
        steps = 0;
        override fixedUpdate(dt: number): void {
          this.steps++;
          if (this.steps < 8) {
            this.transform.translate(SPEED * dt, 0);
          } else if (this.steps === 8) {
            this.rb.setPosition(1000, 0);
          }
        }
      }

      runPhysicsUnderGameLoop(context, gameLoop, scheduler, [
        new ComponentFixedUpdateSystem(),
      ]);

      const platform = spawnEntityInScene(scene, "platform");
      const transform = platform.add(new Transform());
      const rb = platform.add(new RigidBodyComponent({ type: "kinematic" }));
      platform.add(new TeleportingMover());

      const drawnX: number[] = [];
      for (let i = 0; i < 30; i++) {
        gameLoop.tick(10);
        drawnX.push(transform.worldPosition.x);
      }

      // Every drawn pose after the teleport frame is exactly the
      // destination: no blend from the old pose, and no step pulls the body
      // back toward the stale pre-teleport target.
      const teleportFrame = drawnX.findIndex((x) => x === 1000);
      expect(teleportFrame).toBeGreaterThan(0);
      for (const x of drawnX.slice(teleportFrame)) {
        expect(x).toBe(1000);
      }
      expect(rb.positionX).toBe(1000);
    });

    it("transform.setPosition on a kinematic body is smoothed over one step", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });

      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const platform = spawnEntityInScene(scene, "platform");
      const transform = platform.add(new Transform());
      const rb = platform.add(new RigidBodyComponent({ type: "kinematic" }));

      // Run a few frames so prev/curr hold steady poses, then reposition
      // via the Transform.
      for (let i = 0; i < 5; i++) gameLoop.tick(10);
      transform.setPosition(120, 0);

      const drawnX: number[] = [];
      for (let i = 0; i < 6; i++) {
        gameLoop.tick(10);
        drawnX.push(transform.worldPosition.x);
      }

      // The body reaches the target after one step, and at least one frame
      // draws a blend strictly between the endpoints.
      expect(rb.positionX).toBeCloseTo(120, 6);
      expect(drawnX[drawnX.length - 1]).toBeCloseTo(120, 6);
      expect(drawnX.some((x) => x > 0 && x < 120)).toBe(true);
    });
  });

  describe("RigidBodyComponent pose getters", () => {
    it("reports the exact simulated pose while the Transform holds the blend", async () => {
      const { scene, gameLoop, scheduler, context } =
        await createPhysicsTestContext({ pixelsPerMeter: 50 });
      runPhysicsUnderGameLoop(context, gameLoop, scheduler);

      const entity = spawnEntityInScene(scene, "mover");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));
      rb.setVelocity({ x: 300, y: 0 });

      // Land on a frame whose alpha is neither 0 nor 1, so the blended
      // Transform trails the stepped body.
      for (let i = 0; i < 4; i++) gameLoop.tick(10);

      expect(rb.position.x).toBeCloseTo(rb._currPosition.x, 6);
      expect(rb.positionX).toBeCloseTo(rb._currPosition.x, 6);
      expect(rb.positionY).toBeCloseTo(rb._currPosition.y, 6);
      expect(rb.rotation).toBeCloseTo(rb._currRotation, 6);
      expect(rb.positionX).toBeGreaterThan(transform.worldPosition.x);
    });

    it("reports the spawn Transform pose before the body has stepped", async () => {
      const { scene } = await createPhysicsTestContext({ pixelsPerMeter: 50 });

      const entity = spawnEntityInScene(scene, "spawned");
      entity.add(
        new Transform({ position: new Vec2(120, 240), rotation: 0.5 }),
      );
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      expect(rb.position.x).toBeCloseTo(120);
      expect(rb.position.y).toBeCloseTo(240);
      expect(rb.positionX).toBeCloseTo(120);
      expect(rb.positionY).toBeCloseTo(240);
      expect(rb.rotation).toBeCloseTo(0.5);
    });

    it("falls back to the Transform while no Rapier body exists", async () => {
      const { scene } = await createPhysicsTestContext({ pixelsPerMeter: 50 });

      const entity = spawnEntityInScene(scene, "handleless");
      const transform = entity.add(new Transform());
      const rb = entity.add(new RigidBodyComponent({ type: "dynamic" }));

      rb._bodyHandle = -1;
      transform.setPosition(300, 400);
      transform.setRotation(1.25);

      expect(rb.position.x).toBe(300);
      expect(rb.position.y).toBe(400);
      expect(rb.positionX).toBe(300);
      expect(rb.positionY).toBe(400);
      expect(rb.rotation).toBe(1.25);
    });
  });
});
