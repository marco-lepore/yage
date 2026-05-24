import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import {
  EngineContext,
  QueryCacheKey,
  EventBusKey,
  SceneManagerKey,
  LoggerKey,
  ServiceKey,
} from "./EngineContext.js";
import { SceneManager } from "./SceneManager.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { defineBlueprint } from "./Blueprint.js";

class TestScene extends Scene {
  readonly name = "test";
  enterCalled = false;
  exitCalled = false;
  pauseCalled = false;
  resumeCalled = false;

  onEnter() {
    this.enterCalled = true;
  }
  onExit() {
    this.exitCalled = true;
  }
  onPause() {
    this.pauseCalled = true;
  }
  onResume() {
    this.resumeCalled = true;
  }
}

class TestComponent extends Component {
  removeCalled = false;
  destroyCalled = false;
  onRemove() {
    this.removeCalled = true;
  }
  onDestroy() {
    this.destroyCalled = true;
  }
}

function createContext() {
  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  return { ctx, queryCache, bus };
}

describe("Scene", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("spawns entities", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("player");
    expect(e.name).toBe("player");
    expect(e.scene).toBe(scene);
    expect(scene.getEntities().size).toBe(1);
  });

  it("emits entity:created on spawn", () => {
    const { ctx, bus } = createContext();
    const handler = vi.fn();
    bus.on("entity:created", handler);
    const scene = new TestScene();
    scene._setContext(ctx);
    scene.spawn("test");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("findEntity by name", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("player");
    expect(scene.findEntity("player")).toBe(e);
    expect(scene.findEntity("nonexistent")).toBeUndefined();
  });

  it("findEntity skips destroyed entities", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("player");
    e.destroy();
    expect(scene.findEntity("player")).toBeUndefined();
  });

  it("findEntitiesByTag", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e1 = scene.spawn("e1");
    e1.tags.add("enemy");
    const e2 = scene.spawn("e2");
    e2.tags.add("enemy");
    scene.spawn("e3"); // no tag
    expect(scene.findEntitiesByTag("enemy")).toEqual([e1, e2]);
  });

  it("findEntitiesByTag skips destroyed entities", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("e");
    e.tags.add("enemy");
    e.destroy();
    expect(scene.findEntitiesByTag("enemy")).toEqual([]);
  });

  it("destroyEntity marks entity and flushes on _flushDestroyQueue", () => {
    const { ctx, bus } = createContext();
    const handler = vi.fn();
    bus.on("entity:destroyed", handler);
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("doomed");
    const comp = new TestComponent();
    e.add(comp);
    scene.destroyEntity(e);
    expect(e.isDestroyed).toBe(true);
    // Entity still in scene until flush
    expect(scene.getEntities().size).toBe(1);
    scene._flushDestroyQueue();
    expect(scene.getEntities().size).toBe(0);
    expect(comp.removeCalled).toBe(true);
    expect(comp.destroyCalled).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("_destroyAllEntities cleans up all entities", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const comp = new TestComponent();
    const e = scene.spawn("test");
    e.add(comp);
    scene.spawn("test2");
    scene._destroyAllEntities();
    expect(scene.getEntities().size).toBe(0);
    expect(comp.removeCalled).toBe(true);
  });

  it("notifies QueryCache on component add/remove", () => {
    const { ctx, queryCache } = createContext();
    const onAdd = vi.spyOn(queryCache, "onComponentAdded");
    const onRemove = vi.spyOn(queryCache, "onComponentRemoved");
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("test");
    e.add(new TestComponent());
    expect(onAdd).toHaveBeenCalledOnce();
    e.remove(TestComponent);
    expect(onRemove).toHaveBeenCalled();
  });

  it("emits component:added and component:removed events", () => {
    const { ctx, bus } = createContext();
    const addHandler = vi.fn();
    const removeHandler = vi.fn();
    bus.on("component:added", addHandler);
    bus.on("component:removed", removeHandler);
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("test");
    e.add(new TestComponent());
    expect(addHandler).toHaveBeenCalledOnce();
    e.remove(TestComponent);
    expect(removeHandler).toHaveBeenCalledOnce();
  });

  it("defaults to pauseBelow=true, transparentBelow=false", () => {
    const scene = new TestScene();
    expect(scene.pauseBelow).toBe(true);
    expect(scene.transparentBelow).toBe(false);
  });

  it("tracks manual paused state", () => {
    const scene = new TestScene();
    expect(scene.paused).toBe(false);
    scene.paused = true;
    expect(scene.paused).toBe(true);
    expect(scene.isPaused).toBe(true);
  });

  it("isPaused includes stack-based pause", async () => {
    const { ctx } = createContext();
    const sm = new SceneManager();
    ctx.register(SceneManagerKey, sm);
    sm._setContext(ctx);

    const scene = new TestScene();
    await sm.push(scene);
    expect(scene.isPaused).toBe(false);

    // Push a scene with pauseBelow=true on top
    const overlay = new TestScene();
    await sm.push(overlay);
    expect(scene.isPaused).toBe(true);
    expect(scene.paused).toBe(false); // manual pause still false
  });

  it("timeScale defaults to 1", () => {
    const scene = new TestScene();
    expect(scene.timeScale).toBe(1);
    scene.timeScale = 0.5;
    expect(scene.timeScale).toBe(0.5);
  });

  it("context getter returns the engine context", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    expect(scene.context).toBe(ctx);
  });

  it("destroyEntity ignores already-destroyed entities", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const e = scene.spawn("test");
    scene.destroyEntity(e);
    // Call again — should not add duplicate to queue
    scene.destroyEntity(e);
    scene._flushDestroyQueue();
    expect(scene.getEntities().size).toBe(0);
  });

  describe("stable identity", () => {
    class KeyedEntity extends Entity {
      capturedKey: string | undefined;
      override setup(): void {
        this.capturedKey = this.key;
      }
    }

    class KeyedWithParams extends Entity {
      content: string[] = [];
      override setup(params: { content: string[] }): void {
        this.content = params.content;
      }
    }

    class Plain extends Entity {}

    // Regression: `setup(params: T = {})` reports `setup.length === 0` but
    // is still a setup method. The runtime must route the 2nd arg to
    // params (matching TS overload selection), not silently drop it as
    // misidentified options.
    class DefaultedSetup extends Entity {
      received: { x?: number } = {};
      override setup(params: { x?: number } = {}): void {
        this.received = params;
      }
    }

    it("spawn(name, { key }) registers the key and exposes it via findByKey", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn("npc", { key: "elder" });
      expect(e.key).toBe("elder");
      expect(scene.findByKey("elder")).toBe(e);
    });

    it("spawn(Class, { key }) routes the second arg to options when class has no setup params", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(Plain, { key: "marker" });
      expect(e.key).toBe("marker");
      expect(scene.findByKey("marker")).toBe(e);
    });

    it("spawn(Class, params) routes to setup() when setup uses default-valued params", () => {
      // setup(params: P = {}).length === 0 — must NOT misroute params as options.
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(DefaultedSetup, { x: 42 });
      expect(e.received).toEqual({ x: 42 });
      expect(e.key).toBeUndefined();
    });

    it("spawn(Class, params, { key }) keys an entity that needs setup params", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(
        KeyedWithParams,
        { content: ["potion"] },
        { key: "forest/chest-01" },
      );
      expect(e.key).toBe("forest/chest-01");
      expect(e.content).toEqual(["potion"]);
      expect(scene.findByKey("forest/chest-01")).toBe(e);
    });

    it("spawn(Blueprint, params, { key }) keys a blueprint-spawned entity", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const bp = defineBlueprint<{ x: number }>("door", () => {});
      const e = scene.spawn(bp, { x: 0 }, { key: "door-01" });
      expect(e.key).toBe("door-01");
      expect(scene.findByKey("door-01")).toBe(e);
    });

    it("spawn(VoidBlueprint, { key }) keys a void blueprint via the 2-arg form", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const bp = defineBlueprint("anchor", () => {});
      const e = scene.spawn(bp, { key: "anchor-01" });
      expect(e.key).toBe("anchor-01");
      expect(scene.findByKey("anchor-01")).toBe(e);
    });

    it("entity without a key returns undefined from .key and throws on requireKey", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn("plain");
      expect(e.key).toBeUndefined();
      expect(() => e.requireKey()).toThrow(/no stable key/);
    });

    it("key is set before setup() runs (entity.requireKey is safe in setup)", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(KeyedEntity, { key: "captured" });
      expect(e.capturedKey).toBe("captured");
    });

    it("spawn(Class, options) keys a setup-bearing class when the 2nd arg is options-shaped", () => {
      // setup(params = {}) — arity 0 but params still flow when present.
      // Passing a key-only object as the 2nd arg routes it to options, not
      // params, because the shape matches SpawnOptions exactly.
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(DefaultedSetup, { key: "defaulted" });
      expect(e.key).toBe("defaulted");
      expect(e.received).toEqual({});
    });

    it("duplicate key throws and leaves no orphan entity in the scene", () => {
      const { ctx, bus } = createContext();
      const created = vi.fn();
      bus.on("entity:created", created);
      const scene = new TestScene();
      scene._setContext(ctx);
      const first = scene.spawn(Plain, { key: "dup" });
      expect(created).toHaveBeenCalledTimes(1);
      expect(() => scene.spawn(Plain, { key: "dup" })).toThrow(
        /already has an entity with key "dup"/,
      );
      // No second emission, no half-spawned second entity in the scene.
      expect(created).toHaveBeenCalledTimes(1);
      expect(scene.getEntities().size).toBe(1);
      expect(scene.findByKey("dup")).toBe(first);
    });

    it("findByKey returns undefined for destroyed entities (before flush)", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(Plain, { key: "doomed" });
      e.destroy();
      // Still in queue, not flushed — but findByKey should hide it.
      expect(scene.findByKey("doomed")).toBeUndefined();
    });

    it("entity.destroy() + flush removes the key from the index", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const e = scene.spawn(Plain, { key: "doomed" });
      e.destroy();
      scene._flushDestroyQueue();
      expect(scene.findByKey("doomed")).toBeUndefined();
      // Re-using the key after flush is now allowed.
      const replacement = scene.spawn(Plain, { key: "doomed" });
      expect(scene.findByKey("doomed")).toBe(replacement);
    });

    it("same-frame destroy + respawn with the same key keeps the replacement findable after flush", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const first = scene.spawn(Plain, { key: "reused" });
      first.destroy();
      // Destroyed but not flushed — registering again must succeed (the
      // existing entry is destroyed, so the duplicate guard skips it) and
      // must not be evicted by the subsequent flush of the dead entity.
      const replacement = scene.spawn(Plain, { key: "reused" });
      scene._flushDestroyQueue();
      expect(scene.findByKey("reused")).toBe(replacement);
    });

    it("scene teardown clears the identity index", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      scene.spawn(Plain, { key: "a" });
      scene.spawn(Plain, { key: "b" });
      scene._destroyAllEntities();
      expect(scene.findByKey("a")).toBeUndefined();
      expect(scene.findByKey("b")).toBeUndefined();
    });

    it("entity.spawnChild(name, Class, params, { key }) registers in the parent's scene index", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const parent = scene.spawn("parent");
      const child = parent.spawnChild(
        "body",
        KeyedWithParams,
        { content: ["bone"] },
        { key: "child-01" },
      );
      expect(child.key).toBe("child-01");
      expect(scene.findByKey("child-01")).toBe(child);
      expect(parent.children.get("body")).toBe(child);
    });

    it("entity.spawnChild(name, Class, { key }) keys a no-params child", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const parent = scene.spawn("parent");
      const child = parent.spawnChild("dot", Plain, { key: "dot-01" });
      expect(child.key).toBe("dot-01");
      expect(scene.findByKey("dot-01")).toBe(child);
    });

    it("entity.spawnChild(name, { key }) keys an anonymous child", () => {
      const { ctx } = createContext();
      const scene = new TestScene();
      scene._setContext(ctx);
      const parent = scene.spawn("parent");
      const child = parent.spawnChild("hp", { key: "hp-bar-01" });
      expect(child.key).toBe("hp-bar-01");
      expect(child.name).toBe("hp");
      expect(scene.findByKey("hp-bar-01")).toBe(child);
    });
  });
});

interface FakeService {
  tag: string;
}
const EngineScopedKey = new ServiceKey<FakeService>("test.engineScoped");
const SceneScopedKey = new ServiceKey<FakeService>("test.sceneScoped", {
  scope: "scene",
});

class ResolverScene extends Scene {
  readonly name = "resolver";
  // Expose protected resolution helpers for testing.
  pubUse<T>(key: ServiceKey<T>): T {
    return this.use(key);
  }
  pubService<T extends object>(key: ServiceKey<T>): T {
    return this.service(key);
  }
}

describe("Scene service resolution", () => {
  it("use() resolves engine-scoped services from the context", () => {
    const { ctx } = createContext();
    const svc: FakeService = { tag: "engine" };
    ctx.register(EngineScopedKey, svc);
    const scene = new ResolverScene();
    scene._setContext(ctx);
    expect(scene.pubUse(EngineScopedKey)).toBe(svc);
  });

  it("use() resolves scene-scoped services registered via registerScoped", () => {
    const { ctx } = createContext();
    const scene = new ResolverScene();
    scene._setContext(ctx);
    const tree: FakeService = { tag: "scene-tree" };
    scene.registerScoped(SceneScopedKey, tree);
    // This is the issue #93 case: resolvable from the scene itself, the way
    // onEnter would, without reaching for a provider key.
    expect(scene.pubUse(SceneScopedKey)).toBe(tree);
  });

  it("use() prefers scene scope over engine scope for the same key", () => {
    const { ctx } = createContext();
    const engineVal: FakeService = { tag: "engine" };
    const sceneVal: FakeService = { tag: "scene" };
    ctx.register(SceneScopedKey, engineVal);
    const scene = new ResolverScene();
    scene._setContext(ctx);
    scene.registerScoped(SceneScopedKey, sceneVal);
    expect(scene.pubUse(SceneScopedKey)).toBe(sceneVal);
  });

  it("use() throws a helpful message for an unregistered scene-scoped key", () => {
    const { ctx } = createContext();
    const scene = new ResolverScene();
    scene._setContext(ctx);
    expect(() => scene.pubUse(SceneScopedKey)).toThrow(
      /Scene-scoped service "test\.sceneScoped" is not registered for scene "resolver"/,
    );
  });

  it("use() warns when a scene-scoped key falls back to engine scope", () => {
    const { ctx } = createContext();
    const warn = vi.fn();
    ctx.register(LoggerKey, { warn } as never);
    const engineVal: FakeService = { tag: "engine-fallback" };
    ctx.register(SceneScopedKey, engineVal);
    const scene = new ResolverScene();
    scene._setContext(ctx);
    // No registerScoped → only the engine registration exists.
    expect(scene.pubUse(SceneScopedKey)).toBe(engineVal);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("service() proxy is scope-aware", () => {
    const { ctx } = createContext();
    const scene = new ResolverScene();
    scene._setContext(ctx);
    const tree: FakeService = { tag: "scene-tree" };
    scene.registerScoped(SceneScopedKey, tree);
    const proxy = scene.pubService(SceneScopedKey);
    expect(proxy.tag).toBe("scene-tree");
  });
});
