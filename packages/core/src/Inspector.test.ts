import { describe, it, expect } from "vitest";
import { Inspector } from "./Inspector.js";
import { Scene } from "./Scene.js";
import { Component } from "./Component.js";
import { Transform } from "./Transform.js";
import { Vec2 } from "./Vec2.js";
import { SceneManager } from "./SceneManager.js";
import { GameLoop } from "./GameLoop.js";
import { SystemScheduler } from "./SystemScheduler.js";
import { System } from "./System.js";
import { Phase } from "./types.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Logger, LogLevel } from "./Logger.js";
import { QueryCache } from "./QueryCache.js";
import { EventBus } from "./EventBus.js";
import type { EngineEvents } from "./EventBus.js";
import {
  EngineContext,
  ServiceKey,
  QueryCacheKey,
  EventBusKey,
  ErrorBoundaryKey,
  SceneManagerKey,
} from "./EngineContext.js";
import { _resetEntityIdCounter } from "./Entity.js";

const SystemSchedulerKey = new ServiceKey<SystemScheduler>("systemScheduler");

class TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

class Health extends Component {
  constructor(public hp = 100) {
    super();
  }
}

class TestSystem extends System {
  readonly phase = Phase.Update;
  update(): void {
    /* noop */
  }
}

function setup() {
  _resetEntityIdCounter();
  const ctx = new EngineContext();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);
  const scheduler = new SystemScheduler();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(SystemSchedulerKey, scheduler);

  const scenes = new SceneManager();
  ctx.register(SceneManagerKey, scenes);
  scenes._setContext(ctx);
  const loop = new GameLoop();

  const engine = { context: ctx, scenes, loop, logger, events: bus };
  const inspector = new Inspector(engine);

  return { inspector, engine, scenes, scheduler, boundary, ctx, bus };
}

describe("Inspector", () => {
  it("snapshot returns engine state", async () => {
    const { inspector, scenes, scheduler } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    scene.spawn("player");
    scheduler.add(new TestSystem());

    const snap = inspector.snapshot();
    expect(snap.frame).toBe(0);
    expect(snap.sceneStack).toHaveLength(1);
    expect(snap.entityCount).toBe(1);
    expect(snap.systemCount).toBe(1);
  });

  it("registers and resolves inspector extensions by namespace", () => {
    const { inspector } = setup();
    const inventory = {
      listItems: () => ["boots", "key"],
    };

    inspector.addExtension("inventory", inventory);

    expect(inspector.getExtension("inventory")).toBe(inventory);
  });

  it("removes inspector extensions", () => {
    const { inspector } = setup();

    inspector.addExtension("inventory", { listItems: () => [] });
    inspector.removeExtension("inventory");

    expect(inspector.getExtension("inventory")).toBeUndefined();
  });

  it("rejects duplicate inspector extension namespaces", () => {
    const { inspector } = setup();

    inspector.addExtension("inventory", { listItems: () => [] });

    expect(() =>
      inspector.addExtension("inventory", { grantItem: () => {} }),
    ).toThrow('Inspector.addExtension(): namespace "inventory" is already registered.');
  });

  it("getEntityByName finds entity", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("player");
    e.tags.add("hero");
    e.add(new Transform({ position: new Vec2(10, 20) }));

    const snap = inspector.getEntityByName("player");
    expect(snap).toBeDefined();
    expect(snap?.name).toBe("player");
    expect(snap?.tags).toContain("hero");
    expect(snap?.position).toEqual({ x: 10, y: 20 });
    expect(snap?.components).toContain("Transform");
  });

  it("getEntityByName returns undefined for missing", async () => {
    const { inspector, scenes } = setup();
    await scenes.push(new TestScene("game"));
    expect(inspector.getEntityByName("nope")).toBeUndefined();
  });

  it("getEntityByName returns undefined with no active scene", async () => {
    const { inspector } = setup();
    expect(inspector.getEntityByName("anything")).toBeUndefined();
  });

  it("getEntityPosition returns position", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("ball");
    e.add(new Transform({ position: new Vec2(100, 200) }));

    const pos = inspector.getEntityPosition("ball");
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it("getEntityPosition returns undefined for entity without transform", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("noTransform");
    e.add(new Health(50)); // Has a component, but not Transform
    expect(inspector.getEntityPosition("noTransform")).toBeUndefined();
  });

  it("getEntityPosition returns undefined when no scene", async () => {
    const { inspector } = setup();
    expect(inspector.getEntityPosition("anything")).toBeUndefined();
  });

  it("hasComponent checks by class name", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("player");
    e.add(new Health(50));

    expect(inspector.hasComponent("player", "Health")).toBe(true);
    expect(inspector.hasComponent("player", "Transform")).toBe(false);
    expect(inspector.hasComponent("nobody", "Health")).toBe(false);
  });

  it("hasComponent returns false when no scene", async () => {
    const { inspector } = setup();
    expect(inspector.hasComponent("any", "any")).toBe(false);
  });

  it("getComponentData returns serialized data", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("player");
    e.add(new Health(75));

    const data = inspector.getComponentData("player", "Health") as Record<
      string,
      unknown
    >;
    expect(data).toBeDefined();
    expect(data["hp"]).toBe(75);
    expect(data["enabled"]).toBe(true);
  });

  it("getComponentData returns undefined for missing component class", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("player");
    e.add(new Health(100)); // Has Health but not Transform
    expect(inspector.getComponentData("player", "Transform")).toBeUndefined();
    expect(inspector.getComponentData("nobody", "Health")).toBeUndefined();
  });

  it("getComponentData returns undefined for entity with no components", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    scene.spawn("empty");
    expect(inspector.getComponentData("empty", "Health")).toBeUndefined();
  });

  it("getComponentData returns undefined when no scene", async () => {
    const { inspector } = setup();
    expect(inspector.getComponentData("any", "any")).toBeUndefined();
  });

  it("getEntities returns all entity snapshots", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    scene.spawn("a");
    scene.spawn("b");
    const entities = inspector.getEntities();
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.name)).toContain("a");
    expect(entities.map((e) => e.name)).toContain("b");
  });

  it("getEntities skips destroyed entities", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    scene.spawn("alive");
    const doomed = scene.spawn("doomed");
    doomed.destroy();
    const entities = inspector.getEntities();
    expect(entities).toHaveLength(1);
    expect(entities[0]?.name).toBe("alive");
  });

  it("getEntities returns empty when no scene", async () => {
    const { inspector } = setup();
    expect(inspector.getEntities()).toEqual([]);
  });

  it("getSceneStack returns stack info", async () => {
    const { inspector, scenes } = setup();
    const game = new TestScene("game");
    const hud = new TestScene("hud");
    await scenes.push(game);
    game.spawn("player");
    await scenes.push(hud);

    const stack = inspector.getSceneStack();
    expect(stack).toHaveLength(2);
    expect(stack[0]?.name).toBe("game");
    expect(stack[0]?.entityCount).toBe(1);
    expect(stack[0]?.paused).toBe(true);
    expect(stack[1]?.name).toBe("hud");
  });

  it("getSystems returns system info", async () => {
    const { inspector, scheduler } = setup();
    const sys = new TestSystem();
    scheduler.add(sys);
    const systems = inspector.getSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0]?.name).toBe("TestSystem");
    expect(systems[0]?.phase).toBe(Phase.Update);
    expect(systems[0]?.enabled).toBe(true);
  });

  it("getSystems returns empty when no scheduler", async () => {
    _resetEntityIdCounter();
    const ctx = new EngineContext();
    ctx.register(QueryCacheKey, new QueryCache());
    ctx.register(EventBusKey, new EventBus<EngineEvents>());
    const scenes = new SceneManager();
    ctx.register(SceneManagerKey, scenes);
    scenes._setContext(ctx);
    const engine = {
      context: ctx,
      scenes,
      loop: new GameLoop(),
      logger: new Logger(),
    };
    const inspector = new Inspector(engine);
    expect(inspector.getSystems()).toEqual([]);
  });

  it("getErrors returns disabled items", async () => {
    const { inspector, boundary } = setup();
    const sys = new TestSystem();
    boundary.wrapSystem(sys, () => {
      throw new Error("sys-fail");
    });
    const comp = new Health();
    comp.entity = { name: "enemy" } as never;
    boundary.wrapComponent(comp, () => {
      throw new Error("comp-fail");
    });

    const errors = inspector.getErrors();
    expect(errors.disabledSystems).toContain("TestSystem");
    expect(errors.disabledComponents).toHaveLength(1);
    expect(errors.disabledComponents[0]?.entity).toBe("enemy");
    expect(errors.disabledComponents[0]?.component).toBe("Health");
    expect(errors.disabledComponents[0]?.error).toBe("comp-fail");
  });

  it("getErrors uses 'unknown' for component without entity", async () => {
    const { inspector, boundary } = setup();
    const comp = new Health();
    // Don't set comp.entity — it should fall back to "unknown"
    boundary.wrapComponent(comp, () => {
      throw new Error("no-entity-error");
    });
    const errors = inspector.getErrors();
    expect(errors.disabledComponents).toHaveLength(1);
    expect(errors.disabledComponents[0]?.entity).toBe("unknown");
  });

  it("getComponentData filters out function own-properties", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("player");
    const comp = new Health(50);
    // Add a function as an own property to exercise the typeof !== "function" branch
    (comp as unknown as Record<string, unknown>)["customMethod"] = () => {};
    e.add(comp);
    const data = inspector.getComponentData("player", "Health") as Record<
      string,
      unknown
    >;
    expect(data).toBeDefined();
    expect(data["hp"]).toBe(50);
    // Function properties should be excluded
    expect(data["customMethod"]).toBeUndefined();
  });

  it("getEntityPosition returns undefined for missing entity", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    expect(inspector.getEntityPosition("nonexistent")).toBeUndefined();
  });

  it("getErrors returns empty when no boundary", async () => {
    _resetEntityIdCounter();
    const ctx = new EngineContext();
    ctx.register(QueryCacheKey, new QueryCache());
    ctx.register(EventBusKey, new EventBus<EngineEvents>());
    const scenes = new SceneManager();
    ctx.register(SceneManagerKey, scenes);
    scenes._setContext(ctx);
    const engine = {
      context: ctx,
      scenes,
      loop: new GameLoop(),
      logger: new Logger(),
    };
    const inspector = new Inspector(engine);
    const errors = inspector.getErrors();
    expect(errors.disabledSystems).toEqual([]);
    expect(errors.disabledComponents).toEqual([]);
  });

  it("snapshot uses the attached logical frame controller", async () => {
    const { inspector, scenes } = setup();
    await scenes.push(new TestScene("game"));

    inspector.attachTimeController({
      isFrozen: true,
      freeze() {},
      thaw() {},
      stepFrames() {},
      setDelta() {},
      getFrame: () => 42,
    });

    const snap = inspector.snapshot();
    expect(snap.frame).toBe(42);
  });

  it("records bus events only while the event log is enabled", () => {
    const { inspector, bus } = setup();

    bus.emit("engine:started", undefined);
    expect(inspector.events.getLog()).toEqual([]);

    inspector.attachTimeController({
      isFrozen: true,
      freeze() {},
      thaw() {},
      stepFrames() {},
      setDelta() {},
      getFrame: () => 7,
    });
    inspector.setEventLogEnabled(true);

    bus.emit("engine:started", undefined);

    expect(inspector.events.getLog()).toEqual([
      {
        frame: 7,
        source: "bus",
        type: "engine:started",
        payload: null,
      },
    ]);
  });
});
