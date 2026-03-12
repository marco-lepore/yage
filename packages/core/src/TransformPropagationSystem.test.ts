import { describe, it, expect, beforeEach } from "vitest";
import { Entity, _resetEntityIdCounter } from "./Entity.js";
import { Transform } from "./Transform.js";
import { Vec2 } from "./Vec2.js";
import { TransformPropagationSystem } from "./TransformPropagationSystem.js";
import { QueryCache } from "./QueryCache.js";
import { EngineContext, QueryCacheKey } from "./EngineContext.js";

function createSystem(): {
  system: TransformPropagationSystem;
  queryCache: QueryCache;
} {
  const context = new EngineContext();
  const queryCache = new QueryCache();
  context.register(QueryCacheKey, queryCache);

  const system = new TransformPropagationSystem();
  system._setContext(context);
  system.onRegister(context);
  return { system, queryCache };
}

function spawnEntity(
  queryCache: QueryCache,
  name: string,
  pos: { x: number; y: number },
  rotation = 0,
  scale?: { x: number; y: number },
): Entity {
  const entity = new Entity(name);
  const opts: { position: { x: number; y: number }; rotation: number; scale?: { x: number; y: number } } = {
    position: pos,
    rotation,
  };
  if (scale) opts.scale = scale;
  const transform = new Transform(opts);
  entity.add(transform);
  queryCache.onComponentAdded(entity);
  return entity;
}

describe("TransformPropagationSystem", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("root entity: world equals local", () => {
    const { system, queryCache } = createSystem();
    const e = spawnEntity(queryCache, "root", { x: 100, y: 200 }, 0.5);

    system.update();

    const t = e.get(Transform);
    expect(t.worldPosition.x).toBe(100);
    expect(t.worldPosition.y).toBe(200);
    expect(t.worldRotation).toBe(0.5);
    expect(t.worldScale.equals(Vec2.ONE)).toBe(true);
  });

  it("child: world position = parent world + child local", () => {
    const { system, queryCache } = createSystem();
    const parent = spawnEntity(queryCache, "parent", { x: 100, y: 50 });
    const child = spawnEntity(queryCache, "child", { x: 20, y: 10 });
    parent.addChild("arm", child);

    system.update();

    const ct = child.get(Transform);
    expect(ct.worldPosition.x).toBe(120);
    expect(ct.worldPosition.y).toBe(60);
  });

  it("child: parent rotation rotates child position", () => {
    const { system, queryCache } = createSystem();
    const parent = spawnEntity(
      queryCache,
      "parent",
      { x: 0, y: 0 },
      Math.PI / 2,
    ); // 90 degrees
    const child = spawnEntity(queryCache, "child", { x: 10, y: 0 });
    parent.addChild("arm", child);

    system.update();

    const ct = child.get(Transform);
    // (10, 0) rotated 90° = (0, 10)
    expect(ct.worldPosition.x).toBeCloseTo(0, 5);
    expect(ct.worldPosition.y).toBeCloseTo(10, 5);
    expect(ct.worldRotation).toBeCloseTo(Math.PI / 2, 5);
  });

  it("child: parent scale scales child position and scale", () => {
    const { system, queryCache } = createSystem();
    const parent = spawnEntity(
      queryCache,
      "parent",
      { x: 0, y: 0 },
      0,
      { x: 2, y: 3 },
    );
    const child = spawnEntity(queryCache, "child", { x: 10, y: 5 });
    parent.addChild("arm", child);

    system.update();

    const ct = child.get(Transform);
    expect(ct.worldPosition.x).toBe(20); // 10 * 2
    expect(ct.worldPosition.y).toBe(15); // 5 * 3
    expect(ct.worldScale.x).toBe(2);
    expect(ct.worldScale.y).toBe(3);
  });

  it("grandchild: propagation through multiple levels", () => {
    const { system, queryCache } = createSystem();
    const root = spawnEntity(queryCache, "root", { x: 100, y: 100 });
    const mid = spawnEntity(queryCache, "mid", { x: 10, y: 0 });
    const leaf = spawnEntity(queryCache, "leaf", { x: 5, y: 0 });
    root.addChild("mid", mid);
    mid.addChild("leaf", leaf);

    system.update();

    const lt = leaf.get(Transform);
    expect(lt.worldPosition.x).toBe(115);
    expect(lt.worldPosition.y).toBe(100);
  });

  it("grandchild: rotation and scale compose", () => {
    const { system, queryCache } = createSystem();
    const root = spawnEntity(
      queryCache,
      "root",
      { x: 0, y: 0 },
      Math.PI / 2,
      { x: 2, y: 2 },
    );
    const child = spawnEntity(
      queryCache,
      "child",
      { x: 5, y: 0 },
      Math.PI / 2,
    );
    root.addChild("child", child);

    system.update();

    const ct = child.get(Transform);
    // (5, 0) * scale(2,2) = (10, 0), rotated 90° = (0, 10)
    expect(ct.worldPosition.x).toBeCloseTo(0, 5);
    expect(ct.worldPosition.y).toBeCloseTo(10, 5);
    expect(ct.worldRotation).toBeCloseTo(Math.PI, 5);
    expect(ct.worldScale.x).toBeCloseTo(2, 5);
    expect(ct.worldScale.y).toBeCloseTo(2, 5);
  });
});

describe("Entity hierarchy", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("addChild / getChild", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);

    expect(parent.getChild("weapon")).toBe(child);
    expect(child.parent).toBe(parent);
  });

  it("tryGetChild returns undefined for missing", () => {
    const parent = new Entity("parent");
    expect(parent.tryGetChild("weapon")).toBeUndefined();
  });

  it("children returns all children", () => {
    const parent = new Entity("parent");
    const a = new Entity("a");
    const b = new Entity("b");
    parent.addChild("a", a);
    parent.addChild("b", b);
    expect(parent.children.size).toBe(2);
  });

  it("throws on self-parenting", () => {
    const e = new Entity("e");
    expect(() => e.addChild("self", e)).toThrow("cannot be a child of itself");
  });

  it("throws on already-parented child", () => {
    const a = new Entity("a");
    const b = new Entity("b");
    const child = new Entity("child");
    a.addChild("c", child);
    expect(() => b.addChild("c", child)).toThrow("already has a parent");
  });

  it("throws on duplicate child name", () => {
    const parent = new Entity("parent");
    parent.addChild("arm", new Entity("a"));
    expect(() => parent.addChild("arm", new Entity("b"))).toThrow(
      'already has a child named "arm"',
    );
  });

  it("removeChild detaches without destroying", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);
    const removed = parent.removeChild("weapon");

    expect(removed).toBe(child);
    expect(child.parent).toBeNull();
    expect(parent.children.size).toBe(0);
    expect(child.isDestroyed).toBe(false);
  });

  it("removeChild throws for missing name", () => {
    const parent = new Entity("parent");
    expect(() => parent.removeChild("nope")).toThrow('no child named "nope"');
  });

  it("destroy cascades to children", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    const grandchild = new Entity("grandchild");
    parent.addChild("child", child);
    child.addChild("grandchild", grandchild);

    parent.destroy();

    expect(parent.isDestroyed).toBe(true);
    expect(child.isDestroyed).toBe(true);
    expect(grandchild.isDestroyed).toBe(true);
  });

  it("_performDestroy detaches from parent", () => {
    const parent = new Entity("parent");
    const child = new Entity("child");
    parent.addChild("weapon", child);

    child._performDestroy();

    expect(parent.children.size).toBe(0);
  });
});
