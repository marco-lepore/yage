import { describe, it, expect, vi, beforeEach } from "vitest";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import { EngineContext, QueryCacheKey, EventBusKey } from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { _resetEntityIdCounter } from "./Entity.js";
import { Prefab } from "./Prefab.js";
import { Transform } from "./Transform.js";

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

  it("tracks paused state", () => {
    const scene = new TestScene();
    expect(scene.paused).toBe(false);
    scene._setPaused(true);
    expect(scene.paused).toBe(true);
  });

  it("context getter returns the engine context", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    expect(scene.context).toBe(ctx);
  });

  it("spawnPrefab creates an entity from a prefab", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const prefab = new Prefab("soldier").tag("enemy").with(Transform);
    const entity = scene.spawnPrefab(prefab);
    expect(entity.name).toBe("soldier");
    expect(entity.tags.has("enemy")).toBe(true);
    expect(entity.has(Transform)).toBe(true);
  });

  it("spawnPrefab passes overrides to the prefab", () => {
    const { ctx } = createContext();
    const scene = new TestScene();
    scene._setContext(ctx);
    const prefab = new Prefab("soldier").with(Transform);
    const entity = scene.spawnPrefab(prefab, { name: "captain" });
    expect(entity.name).toBe("captain");
  });
});
