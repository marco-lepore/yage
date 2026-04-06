import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
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

  class MockColliderDesc {
    static cuboid() { return new MockColliderDesc(); }
    static ball() { return new MockColliderDesc(); }
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
    freeSpy = vi.fn();

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {}
    createRigidBody() { return { handle: 0, _colliders: [] }; }
    createCollider() { return { handle: 0 }; }
    getRigidBody() { return undefined; }
    removeRigidBody() {}
    free() { this.freeSpy(); }
  }

  return {
    mocks: { MockWorld, MockRigidBodyDesc, MockColliderDesc, MockEventQueue },
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
  EngineContext,
  SystemScheduler,
  ErrorBoundary,
  Logger,
  LogLevel,
  Phase,
} from "@yage/core";
import { PhysicsPlugin } from "./PhysicsPlugin.js";
import { PhysicsWorldManagerKey } from "./types.js";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";

describe("PhysicsPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and version", () => {
    const plugin = new PhysicsPlugin();
    expect(plugin.name).toBe("physics");
    expect(plugin.version).toBe("2.0.0");
  });

  describe("install", () => {
    it("registers PhysicsWorldManagerKey in context", () => {
      const context = new EngineContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      expect(context.has(PhysicsWorldManagerKey)).toBe(true);
      expect(context.resolve(PhysicsWorldManagerKey)).toBeInstanceOf(
        PhysicsWorldManager,
      );
    });
  });

  describe("registerSystems", () => {
    it("adds PhysicsSystem and PhysicsInterpolationSystem", () => {
      const context = new EngineContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      const scheduler = new SystemScheduler();
      scheduler.setErrorBoundary(boundary);

      plugin.registerSystems(scheduler);

      const fixedSystems = scheduler.getSystems(Phase.FixedUpdate);
      const lateSystems = scheduler.getSystems(Phase.LateUpdate);

      expect(fixedSystems.length).toBe(1);
      expect(lateSystems.length).toBe(1);
      expect((fixedSystems[0] as { priority: number }).priority).toBe(0);
      expect((lateSystems[0] as { priority: number }).priority).toBe(100);
    });
  });

  describe("onDestroy", () => {
    it("calls destroy on PhysicsWorldManager", () => {
      const context = new EngineContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      const manager = context.resolve(PhysicsWorldManagerKey);
      const destroySpy = vi.spyOn(manager, "destroy");

      plugin.onDestroy();

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
