import { describe, it, expect, vi, beforeEach } from "vitest";
import { Engine } from "./Engine.js";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import type { Plugin } from "./types.js";
import { _resetEntityIdCounter } from "./Entity.js";
import {
  EngineKey,
  EventBusKey,
  SceneManagerKey,
  LoggerKey,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoopKey,
  InspectorKey,
} from "./EngineContext.js";

class TestScene extends Scene {
  readonly name = "test";
  entered = false;
  onEnter() {
    this.entered = true;
  }
}

class UpdatingComponent extends Component {
  calls: number[] = [];
  update(dt: number) {
    this.calls.push(dt);
  }
}

class FixedUpdatingComponent extends Component {
  calls: number[] = [];
  fixedUpdate(dt: number) {
    this.calls.push(dt);
  }
}

class CrashingComponent extends Component {
  update() {
    throw new Error("crash!");
  }
}

beforeEach(() => {
  _resetEntityIdCounter();
});

describe("Engine", () => {
  describe("construction", () => {
    it("creates all core services", () => {
      const engine = new Engine();
      expect(engine.context).toBeDefined();
      expect(engine.events).toBeDefined();
      expect(engine.loop).toBeDefined();
      expect(engine.logger).toBeDefined();
      expect(engine.scenes).toBeDefined();
      expect(engine.inspector).toBeDefined();
    });

    it("registers well-known services in context", () => {
      const engine = new Engine();
      expect(engine.context.resolve(EngineKey)).toBe(engine);
      expect(engine.context.resolve(EventBusKey)).toBe(engine.events);
      expect(engine.context.resolve(SceneManagerKey)).toBe(engine.scenes);
      expect(engine.context.resolve(LoggerKey)).toBe(engine.logger);
      expect(engine.context.resolve(GameLoopKey)).toBe(engine.loop);
      expect(engine.context.has(QueryCacheKey)).toBe(true);
      expect(engine.context.has(ErrorBoundaryKey)).toBe(true);
      expect(engine.context.has(InspectorKey)).toBe(true);
    });
  });

  describe("plugins", () => {
    it("use() is chainable", () => {
      const engine = new Engine();
      const plugin: Plugin = { name: "test", version: "1.0.0" };
      expect(engine.use(plugin)).toBe(engine);
    });

    it("throws on duplicate plugin name", () => {
      const engine = new Engine();
      const a: Plugin = { name: "test", version: "1.0.0" };
      const b: Plugin = { name: "test", version: "2.0.0" };
      engine.use(a);
      expect(() => engine.use(b)).toThrow(
        'Plugin "test" is already registered.',
      );
    });

    it("throws on use() after start()", async () => {
      const engine = new Engine();
      await engine.start();
      expect(() =>
        engine.use({ name: "late", version: "1.0.0" }),
      ).toThrow("Cannot register plugins after engine has started.");
      engine.destroy();
    });

    it("installs plugins in dependency order", async () => {
      const order: string[] = [];
      const engine = new Engine();
      engine
        .use({
          name: "b",
          version: "1.0.0",
          dependencies: ["a"],
          install: () => {
            order.push("b");
          },
        })
        .use({
          name: "a",
          version: "1.0.0",
          install: () => {
            order.push("a");
          },
        });
      await engine.start();
      expect(order).toEqual(["a", "b"]);
      engine.destroy();
    });

    it("throws on missing dependency", async () => {
      const engine = new Engine();
      engine.use({
        name: "orphan",
        version: "1.0.0",
        dependencies: ["missing"],
      });
      await expect(engine.start()).rejects.toThrow(
        'Plugin "orphan" depends on "missing"',
      );
    });

    it("throws on circular dependency", async () => {
      const engine = new Engine();
      engine
        .use({ name: "a", version: "1.0.0", dependencies: ["b"] })
        .use({ name: "b", version: "1.0.0", dependencies: ["a"] });
      await expect(engine.start()).rejects.toThrow("Circular dependency");
    });

    it("calls onStart on plugins", async () => {
      const onStart = vi.fn();
      const engine = new Engine();
      engine.use({ name: "test", version: "1.0.0", onStart });
      await engine.start();
      expect(onStart).toHaveBeenCalledOnce();
      engine.destroy();
    });

    it("calls onDestroy on plugins in reverse order", async () => {
      const order: string[] = [];
      const engine = new Engine();
      engine
        .use({
          name: "a",
          version: "1.0.0",
          onDestroy: () => order.push("a"),
        })
        .use({
          name: "b",
          version: "1.0.0",
          onDestroy: () => order.push("b"),
        });
      await engine.start();
      engine.destroy();
      expect(order).toEqual(["b", "a"]);
    });

    it("calls onDestroy in reverse topological order (dependents first)", async () => {
      const order: string[] = [];
      const engine = new Engine();
      // "c" depends on "b", "b" depends on "a"
      // Install order: a → b → c
      // Destroy order should be: c → b → a (reverse topological)
      engine
        .use({
          name: "c",
          version: "1.0.0",
          dependencies: ["b"],
          onDestroy: () => order.push("c"),
        })
        .use({
          name: "a",
          version: "1.0.0",
          onDestroy: () => order.push("a"),
        })
        .use({
          name: "b",
          version: "1.0.0",
          dependencies: ["a"],
          onDestroy: () => order.push("b"),
        });
      await engine.start();
      engine.destroy();
      expect(order).toEqual(["c", "b", "a"]);
    });
  });

  describe("game loop integration", () => {
    it("start() begins the loop", async () => {
      const engine = new Engine();
      await engine.start();
      expect(engine.loop.isRunning).toBe(true);
      engine.destroy();
    });

    it("destroy() stops the loop", async () => {
      const engine = new Engine();
      await engine.start();
      engine.destroy();
      expect(engine.loop.isRunning).toBe(false);
    });

    it("double start is a no-op", async () => {
      const engine = new Engine();
      await engine.start();
      await engine.start(); // should not throw
      engine.destroy();
    });
  });

  describe("component update integration", () => {
    it("calls component.update(dt) during Update phase", async () => {
      const engine = new Engine();
      await engine.start();
      const scene = new TestScene();
      engine.scenes.push(scene);
      const entity = scene.spawn("player");
      const comp = new UpdatingComponent();
      entity.add(comp);

      engine.loop.tick(16);
      expect(comp.calls.length).toBeGreaterThan(0);
      engine.destroy();
    });

    it("calls component.fixedUpdate(dt) during FixedUpdate phase", async () => {
      const engine = new Engine({ fixedTimestep: 16 });
      await engine.start();
      const scene = new TestScene();
      engine.scenes.push(scene);
      const entity = scene.spawn("player");
      const comp = new FixedUpdatingComponent();
      entity.add(comp);

      engine.loop.tick(16);
      expect(comp.calls).toContain(16);
      engine.destroy();
    });

    it("disables crashing component via ErrorBoundary", async () => {
      const engine = new Engine();
      await engine.start();
      const scene = new TestScene();
      engine.scenes.push(scene);
      const entity = scene.spawn("buggy");
      const comp = new CrashingComponent();
      entity.add(comp);

      engine.loop.tick(16); // Should not throw
      expect(comp.enabled).toBe(false);
      engine.destroy();
    });
  });

  describe("entity lifecycle integration", () => {
    it("deferred entity destruction happens in endOfFrame", async () => {
      const engine = new Engine();
      await engine.start();
      const scene = new TestScene();
      engine.scenes.push(scene);
      const entity = scene.spawn("doomed");
      scene.destroyEntity(entity);

      // Entity is still in scene before tick
      expect(scene.getEntities().size).toBe(1);
      engine.loop.tick(16);
      // Entity is removed after endOfFrame
      expect(scene.getEntities().size).toBe(0);
      engine.destroy();
    });
  });

  describe("events", () => {
    it("emits engine:started on start", async () => {
      const handler = vi.fn();
      const engine = new Engine();
      engine.events.on("engine:started", handler);
      await engine.start();
      expect(handler).toHaveBeenCalledOnce();
      engine.destroy();
    });

    it("emits engine:stopped on destroy", async () => {
      const handler = vi.fn();
      const engine = new Engine();
      engine.events.on("engine:stopped", handler);
      await engine.start();
      engine.destroy();
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("debug mode", () => {
    it("exposes __yage__ on globalThis when debug is true", async () => {
      const engine = new Engine({ debug: true });
      await engine.start();
      const yageGlobal = (globalThis as Record<string, unknown>)["__yage__"] as
        | Record<string, unknown>
        | undefined;
      expect(yageGlobal).toBeDefined();
      if (yageGlobal) {
        expect(yageGlobal["inspector"]).toBe(engine.inspector);
        expect(yageGlobal["logger"]).toBe(engine.logger);
      }
      engine.destroy();
    });

    it("removes __yage__ from globalThis on destroy when debug is true", async () => {
      const engine = new Engine({ debug: true });
      await engine.start();
      expect("__yage__" in globalThis).toBe(true);
      engine.destroy();
      expect("__yage__" in globalThis).toBe(false);
    });

    it("does not expose __yage__ when debug is false", async () => {
      const engine = new Engine({ debug: false });
      await engine.start();
      expect("__yage__" in globalThis).toBe(false);
      engine.destroy();
    });

    it("exposes __yage__ before plugin onStart hooks run", async () => {
      const onStart = vi.fn(() => {
        const yageGlobal = (globalThis as Record<string, unknown>)["__yage__"] as
          | Record<string, unknown>
          | undefined;
        expect(yageGlobal).toBeDefined();
        yageGlobal!["clock"] = { ready: true };
      });

      const engine = new Engine({ debug: true });
      engine.use({ name: "debug-hook", version: "1.0.0", onStart });
      await engine.start();

      expect(onStart).toHaveBeenCalledOnce();
      const yageGlobal = (globalThis as Record<string, unknown>)["__yage__"] as
        | Record<string, unknown>
        | undefined;
      expect(yageGlobal?.["clock"]).toEqual({ ready: true });
      engine.destroy();
    });
  });

  describe("inspector integration", () => {
    it("snapshot returns correct state", async () => {
      const engine = new Engine();
      await engine.start();
      const scene = new TestScene();
      engine.scenes.push(scene);
      scene.spawn("a");
      scene.spawn("b");

      const snap = engine.inspector.snapshot();
      expect(snap.entityCount).toBe(2);
      expect(snap.sceneStack).toHaveLength(1);
      engine.destroy();
    });
  });
});
