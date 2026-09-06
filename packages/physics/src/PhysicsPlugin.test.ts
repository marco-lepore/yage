import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Rapier mocks (hoisted) ----
const { mocks } = vi.hoisted(() => {
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

  class MockColliderDesc {
    static cuboid() {
      return new MockColliderDesc();
    }
    static ball() {
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
    freeSpy = vi.fn();

    constructor(gravity: { x: number; y: number }) {
      this.gravity = { ...gravity };
    }

    step() {}
    createRigidBody() {
      return { handle: 0, _colliders: [] };
    }
    createCollider() {
      return { handle: 0 };
    }
    getRigidBody() {
      return undefined;
    }
    removeRigidBody() {}
    free() {
      this.freeSpy();
    }
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
  EngineContext,
  SystemScheduler,
  ErrorBoundary,
  Logger,
  LogLevel,
  Phase,
  SceneHookRegistry,
  SceneHookRegistryKey,
} from "@yagejs/core";
import { DebugRegistryKey } from "@yagejs/debug/api";
import { PhysicsPlugin } from "./PhysicsPlugin.js";
import { PhysicsWorldManagerKey } from "./types.js";
import { PhysicsWorldManager } from "./PhysicsWorldManager.js";

function makeContext(): EngineContext {
  const context = new EngineContext();
  context.register(SceneHookRegistryKey, new SceneHookRegistry());
  return context;
}

describe("PhysicsPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and version", async () => {
    const plugin = new PhysicsPlugin();
    expect(plugin.name).toBe("physics");
    expect(plugin.version).toBe("3.0.0");
  });

  it("rejects a pixelsPerMeter of 0 and non-finite gravity at construction", () => {
    expect(() => new PhysicsPlugin({ pixelsPerMeter: 0 })).toThrow(
      "PhysicsPlugin: pixelsPerMeter must be finite and > 0, got 0.",
    );
    expect(() => new PhysicsPlugin({ gravity: { x: NaN, y: 0 } })).toThrow(
      "PhysicsPlugin: gravity.x must be finite, got NaN.",
    );
  });

  describe("install", () => {
    it("registers PhysicsWorldManagerKey in context", async () => {
      const context = makeContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      expect(context.has(PhysicsWorldManagerKey)).toBe(true);
      expect(context.resolve(PhysicsWorldManagerKey)).toBeInstanceOf(
        PhysicsWorldManager,
      );
    });
  });

  describe("onStart", () => {
    it("registers a contributor through the canonical debug key", () => {
      const context = makeContext();
      const register = vi.fn();
      context.register(DebugRegistryKey, {
        register,
        isEnabled: () => true,
        isFlagEnabled: () => true,
        setFlag: vi.fn(),
        toggle: vi.fn(),
        drawVector: () => () => {},
      });
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      plugin.onStart();

      expect(register).toHaveBeenCalledTimes(1);
      expect(register.mock.calls[0]?.[0]).toHaveProperty("name", "physics");
    });

    it("does nothing when the debug registry is absent", () => {
      const context = makeContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      expect(() => plugin.onStart()).not.toThrow();
    });
  });

  describe("registerSystems", () => {
    it("adds PhysicsSystem and PhysicsInterpolationSystem", async () => {
      const context = makeContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      const logger = new Logger({ level: LogLevel.Debug });
      const boundary = new ErrorBoundary(logger);
      const scheduler = new SystemScheduler();
      scheduler.setErrorBoundary(boundary);

      plugin.registerSystems(scheduler);

      const fixedSystems = scheduler.getSystems(Phase.FixedUpdate);
      const updateSystems = scheduler.getSystems(Phase.Update);

      expect(fixedSystems.length).toBe(1);
      expect(updateSystems.length).toBe(1);
      expect((fixedSystems[0] as { priority: number }).priority).toBe(0);
      expect((updateSystems[0] as { priority: number }).priority).toBe(-100);
    });
  });

  describe("onDestroy", () => {
    it("calls destroy on PhysicsWorldManager", async () => {
      const context = makeContext();
      const plugin = new PhysicsPlugin();
      plugin.install(context);

      const manager = context.resolve(PhysicsWorldManagerKey);
      const destroySpy = vi.spyOn(manager, "destroy");

      plugin.onDestroy();

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
