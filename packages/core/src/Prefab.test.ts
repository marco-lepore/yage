import { describe, it, expect, beforeEach } from "vitest";
import { Prefab } from "./Prefab.js";
import { Component } from "./Component.js";
import { Scene } from "./Scene.js";
import { EngineContext, QueryCacheKey, EventBusKey } from "./EngineContext.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import { _resetEntityIdCounter } from "./Entity.js";

class Position extends Component {
  constructor(
    public x = 0,
    public y = 0,
  ) {
    super();
  }
}

class Health extends Component {
  constructor(public hp = 100) {
    super();
  }
}

class TestScene extends Scene {
  readonly name = "test";
}

function createScene(): TestScene {
  const ctx = new EngineContext();
  ctx.register(QueryCacheKey, new QueryCache());
  ctx.register(EventBusKey, new EventBus<EngineEvents>());
  const scene = new TestScene();
  scene._setContext(ctx);
  return scene;
}

describe("Prefab", () => {
  beforeEach(() => {
    _resetEntityIdCounter();
  });

  it("spawns entity with correct name", () => {
    const prefab = new Prefab("enemy");
    const scene = createScene();
    const entity = prefab.spawn(scene);
    expect(entity.name).toBe("enemy");
  });

  it("applies tags", () => {
    const prefab = new Prefab("coin").tag("collectible", "shiny");
    const scene = createScene();
    const entity = prefab.spawn(scene);
    expect(entity.tags.has("collectible")).toBe(true);
    expect(entity.tags.has("shiny")).toBe(true);
  });

  it("adds components with constructor args", () => {
    const prefab = new Prefab("enemy")
      .with(Position, 10, 20)
      .with(Health, 50);
    const scene = createScene();
    const entity = prefab.spawn(scene);
    expect(entity.get(Position).x).toBe(10);
    expect(entity.get(Position).y).toBe(20);
    expect(entity.get(Health).hp).toBe(50);
  });

  it("supports override: name", () => {
    const prefab = new Prefab("enemy");
    const scene = createScene();
    const entity = prefab.spawn(scene, { name: "boss" });
    expect(entity.name).toBe("boss");
  });

  it("supports override: tags", () => {
    const prefab = new Prefab("enemy").tag("npc");
    const scene = createScene();
    const entity = prefab.spawn(scene, { tags: ["boss"] });
    expect(entity.tags.has("npc")).toBe(true);
    expect(entity.tags.has("boss")).toBe(true);
  });

  it("supports override: components (replace matching)", () => {
    const prefab = new Prefab("enemy").with(Health, 100);
    const scene = createScene();
    const entity = prefab.spawn(scene, {
      components: [{ cls: Health, args: [200] }],
    });
    expect(entity.get(Health).hp).toBe(200);
  });

  it("supports override: components (add new)", () => {
    const prefab = new Prefab("enemy").with(Health, 100);
    const scene = createScene();
    const entity = prefab.spawn(scene, {
      components: [{ cls: Position, args: [5, 5] }],
    });
    expect(entity.has(Health)).toBe(true);
    expect(entity.has(Position)).toBe(true);
    expect(entity.get(Position).x).toBe(5);
  });

  it("spawns child prefabs in the same scene", () => {
    const child = new Prefab("child-entity").with(Health, 10);
    const parent = new Prefab("parent-entity").child(child);
    const scene = createScene();
    parent.spawn(scene);
    // Scene should have 2 entities: parent + child
    expect(scene.getEntities().size).toBe(2);
    const childEntity = scene.findEntity("child-entity");
    expect(childEntity).toBeDefined();
    expect(childEntity?.get(Health).hp).toBe(10);
  });

  it("builder is chainable", () => {
    const prefab = new Prefab("test")
      .tag("a")
      .with(Position, 1, 2)
      .tag("b")
      .with(Health, 50);
    const scene = createScene();
    const entity = prefab.spawn(scene);
    expect(entity.tags.has("a")).toBe(true);
    expect(entity.tags.has("b")).toBe(true);
    expect(entity.has(Position)).toBe(true);
    expect(entity.has(Health)).toBe(true);
  });

  it("can spawn multiple entities from the same prefab", () => {
    const prefab = new Prefab("coin").with(Position);
    const scene = createScene();
    const a = prefab.spawn(scene);
    const b = prefab.spawn(scene);
    expect(a.id).not.toBe(b.id);
    expect(scene.getEntities().size).toBe(2);
  });
});
