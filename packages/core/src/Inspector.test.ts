import { describe, it, expect, vi } from "vitest";
import { Inspector } from "./Inspector.js";
import type { InspectorFacetContributor } from "./Inspector.js";
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
  const loop = new GameLoop();
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

  it("snapshots the UI tree of a component named UISurface with a root element", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const entity = scene.spawn("hud");

    // Local stand-in mirroring @yagejs/ui's UISurface shape. Core imports
    // nothing from ui — the Inspector matches by class name plus a `root`
    // field, so this name+field match breaks silently if either string drifts.
    const rootElement = {
      yogaNode: {
        getComputedLayout: () => ({ left: 1, top: 2, width: 30, height: 40 }),
      },
      children: [],
    };
    class UISurface extends Component {
      readonly root = rootElement;
    }
    entity.add(new UISurface());

    const ui = inspector.snapshot().scenes[0]?.ui;
    expect(ui).not.toBeNull();
    expect(ui?.root.id).toBe(`entity-${entity.id}:UISurface:0`);
    expect(ui?.root.layout).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });

  it("uses the scene id once for a snapshot with multiple UI roots", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);

    class UISurface extends Component {
      readonly root = { children: [] };
    }
    scene.spawn("hud-a").add(new UISurface());
    scene.spawn("hud-b").add(new UISurface());

    const snapshot = inspector.snapshot();
    const sceneSnapshot = snapshot.scenes[0];
    if (!sceneSnapshot) throw new Error("Expected one scene snapshot.");
    expect(sceneSnapshot.ui?.root.id).toBe(`${sceneSnapshot.id}:ui`);
    expect(sceneSnapshot.ui?.root.children).toHaveLength(2);
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

  it("getErrors returns recorded system/component/callback failures", async () => {
    const { inspector, boundary } = setup();
    const sys = new TestSystem();
    expect(() =>
      boundary.wrapSystem(sys, () => {
        throw new Error("sys-fail");
      }),
    ).toThrow("sys-fail");

    const comp = new Health();
    comp.entity = { name: "enemy" } as never;
    expect(() =>
      boundary.wrapComponent(comp, () => {
        throw new Error("comp-fail");
      }),
    ).toThrow("comp-fail");

    expect(() =>
      boundary.wrapCallback(
        () => {
          throw new Error("callback-fail");
        },
        { kind: "Test callback", entity: "player" },
      ),
    ).toThrow("callback-fail");

    const errors = inspector.getErrors();
    expect(errors.callbackErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "System TestSystem", error: "sys-fail" }),
        expect.objectContaining({
          kind: "Component Health",
          entity: "enemy",
          error: "comp-fail",
        }),
        expect.objectContaining({
          kind: "Test callback",
          entity: "player",
          error: "callback-fail",
        }),
      ]),
    );
  });

  it("getErrors uses 'unknown' for a component without an entity", async () => {
    const { inspector, boundary } = setup();
    const comp = new Health();
    // Don't set comp.entity — it should fall back to "unknown"
    expect(() =>
      boundary.wrapComponent(comp, () => {
        throw new Error("no-entity-error");
      }),
    ).toThrow("no-entity-error");
    const errors = inspector.getErrors();
    expect(errors.callbackErrors).toHaveLength(1);
    expect(errors.callbackErrors[0]?.entity).toBe("unknown");
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
    expect(errors.callbackErrors).toEqual([]);
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

  it("events.setEnabled/isEnabled mirror the internal toggle", () => {
    const { inspector } = setup();
    expect(inspector.events.isEnabled()).toBe(false);

    inspector.events.setEnabled(true);
    expect(inspector.events.isEnabled()).toBe(true);

    inspector.events.setEnabled(false);
    expect(inspector.events.isEnabled()).toBe(false);
  });

  it("getSceneStack entries carry the same id snapshotScene() accepts", async () => {
    const { inspector, scenes } = setup();
    await scenes.push(new TestScene("game"));

    const [entry] = inspector.getSceneStack();
    expect(entry?.id).toBeDefined();
    expect(inspector.snapshotScene(entry!.id).id).toBe(entry!.id);
  });

  describe("snapshotScene", () => {
    it("resolves by scene name", async () => {
      const { inspector, scenes } = setup();
      await scenes.push(new TestScene("game"));

      expect(inspector.snapshotScene("game").name).toBe("game");
    });

    it("falls back to id when no scene has that name", async () => {
      const { inspector, scenes } = setup();
      await scenes.push(new TestScene("game"));
      const id = inspector.snapshot().scenes[0]!.id;

      expect(inspector.snapshotScene(id).id).toBe(id);
    });

    it("throws when more than one active scene shares the name", async () => {
      const { inspector, scenes } = setup();
      await scenes.push(new TestScene("dup"));
      await scenes.push(new TestScene("dup"));

      expect(() => inspector.snapshotScene("dup")).toThrow(
        'Inspector.snapshotScene(): "dup" matches 2 active scenes; use the scene id from snapshot().scenes[].id instead.',
      );
    });

    it("throws for an unknown name or id", async () => {
      const { inspector, scenes } = setup();
      await scenes.push(new TestScene("game"));

      expect(() => inspector.snapshotScene("nope")).toThrow(
        'Inspector.snapshotScene(): unknown scene name or id "nope".',
      );
    });
  });

  describe("component state reflection", () => {
    class Cooldown extends Component {
      private _ready = false;
      _internalTimer = 5;

      get isReady(): boolean {
        return this._ready;
      }

      makeReady(): void {
        this._ready = true;
      }
    }

    class ThrowingGetter extends Component {
      get boom(): never {
        throw new Error("not attached yet");
      }
    }

    it("reflects a public getter when the component has no serialize()", async () => {
      const { inspector, scenes } = setup();
      const scene = new TestScene("game");
      await scenes.push(scene);
      const e = scene.spawn("timer");
      const comp = new Cooldown();
      comp.makeReady();
      e.add(comp);

      const data = inspector.getComponentData("timer", "Cooldown") as Record<
        string,
        unknown
      >;
      expect(data["isReady"]).toBe(true);
      // Underscore-prefixed own fields stay excluded, getters included or not.
      expect(data["_internalTimer"]).toBeUndefined();

      const snapState = inspector.snapshot().scenes[0]?.entities[0]
        ?.components[0]?.state as Record<string, unknown>;
      expect(snapState["isReady"]).toBe(true);
    });

    it("snapshot no longer reports state: null by default for a component without serialize()", async () => {
      const { inspector, scenes } = setup();
      const scene = new TestScene("game");
      await scenes.push(scene);
      const e = scene.spawn("player");
      e.add(new Health(30));

      const comp = inspector.snapshot().scenes[0]?.entities[0]?.components[0];
      expect(comp?.state).not.toBeNull();
      expect((comp?.state as Record<string, unknown>)["hp"]).toBe(30);
    });

    it("skips a getter that throws instead of failing the whole snapshot", async () => {
      const { inspector, scenes } = setup();
      const scene = new TestScene("game");
      await scenes.push(scene);
      const e = scene.spawn("broken");
      e.add(new ThrowingGetter());

      const data = inspector.getComponentData(
        "broken",
        "ThrowingGetter",
      ) as Record<string, unknown>;
      expect(data["boom"]).toBeUndefined();
    });
  });

  describe("time.isAdvancing", () => {
    it("is false before the game loop has ever ticked", () => {
      const { inspector } = setup();
      expect(inspector.time.isAdvancing()).toBe(false);
    });

    it("is true within the window right after a real tick", () => {
      const { inspector, engine } = setup();
      engine.loop.setCallbacks({
        earlyUpdate() {},
        fixedUpdate() {},
        update() {},
        lateUpdate() {},
        render() {},
        endOfFrame() {},
      });
      engine.loop.start();
      engine.loop.tick(16);

      expect(inspector.time.isAdvancing()).toBe(true);
      // A negative window can never be satisfied by a non-negative elapsed
      // time — deterministic false without depending on real clock precision.
      expect(inspector.time.isAdvancing(-1)).toBe(false);
    });
  });

  describe("time.stepUntil / time.stepAsync", () => {
    function fakeController(
      onStep: (count: number, dtMs?: number) => void,
      getFrame: () => number,
    ) {
      return {
        isFrozen: true,
        freeze() {},
        thaw() {},
        stepFrames: onStep,
        setDelta() {},
        getFrame,
      };
    }

    it("stepUntil resolves 0 without stepping if the predicate is already true", async () => {
      const { inspector } = setup();
      const onStep = vi.fn();
      inspector.attachTimeController(fakeController(onStep, () => 0));

      await expect(inspector.time.stepUntil(() => true)).resolves.toBe(0);
      expect(onStep).not.toHaveBeenCalled();
    });

    it("advances frame-by-frame, yielding a macrotask so a microtask-deferred change is observed", async () => {
      const { inspector } = setup();
      let frame = 0;
      let transitionSettled = false;
      inspector.attachTimeController(
        fakeController((count) => {
          frame += count;
          // Mirrors a SceneManager transition that resolves in a microtask
          // rather than synchronously within stepFrames().
          Promise.resolve().then(() => {
            transitionSettled = true;
          });
        }, () => frame),
      );

      const frames = await inspector.time.stepUntil(() => transitionSettled);

      expect(frames).toBe(1);
      expect(transitionSettled).toBe(true);
    });

    it("throws once maxFrames is reached without the predicate becoming true", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(fakeController(() => {}, () => 0));

      await expect(
        inspector.time.stepUntil(() => false, { maxFrames: 3 }),
      ).rejects.toThrow(
        "Inspector.time.stepUntil(): predicate still false after 3 frames.",
      );
    });

    it("stepAsync advances a fixed frame count, passing dtMs through each step", async () => {
      const { inspector } = setup();
      const dts: Array<number | undefined> = [];
      let frame = 0;
      inspector.attachTimeController(
        fakeController((count, dtMs) => {
          frame += count;
          dts.push(dtMs);
        }, () => frame),
      );

      await inspector.time.stepAsync(2, { dtMs: 32 });

      expect(frame).toBe(2);
      expect(dts).toEqual([32, 32]);
    });

    it("rejects a non-positive or non-finite dtMs without stepping", async () => {
      const { inspector } = setup();
      const onStep = vi.fn();
      inspector.attachTimeController(fakeController(onStep, () => 0));

      await expect(
        inspector.time.stepUntil(() => false, { dtMs: -1 }),
      ).rejects.toThrow(
        "Inspector.time.stepUntil(dtMs) requires a positive number.",
      );
      await expect(
        inspector.time.stepAsync(1, { dtMs: Number.NaN }),
      ).rejects.toThrow(
        "Inspector.time.stepAsync(dtMs) requires a positive number.",
      );
      expect(onStep).not.toHaveBeenCalled();
    });
  });
});

// A fake graphical component + a registered contributor that reads it. Mirrors
// how the renderer publishes its facet: core knows nothing about "render"; the
// contributor owns the namespace and the duck-typing. No Pixi / renderer dep.
class FakeRenderComponent extends Component {
  constructor(
    readonly facet: {
      bounds: { x: number; y: number; width: number; height: number } | null;
      visible: boolean;
      glyphs?: Array<{ visible: boolean }>;
    },
  ) {
    super();
  }
  inspectRender() {
    return this.facet;
  }
  serialize() {
    return { kind: "fake" };
  }
}

class ThrowingRenderComponent extends Component {
  inspectRender(): never {
    throw new Error("display object not parented");
  }
  serialize() {
    return { kind: "throws" };
  }
}

interface RenderInspectableLike {
  inspectRender(): unknown;
}

// The contributor under test — the renderer ships an equivalent. The Inspector
// stays agnostic: it just calls `inspectComponent` per component and surfaces
// `inspectEntity`'s pick at the entity level, attaching results under `facets`.
const renderFacetContributor: InspectorFacetContributor = {
  namespace: "render",
  inspectComponent(component) {
    const hook = (component as Partial<RenderInspectableLike>).inspectRender;
    return typeof hook === "function" ? hook.call(component) : undefined;
  },
  inspectEntity(facets) {
    return facets.find((facet) => facet != null);
  },
};

describe("Inspector facet contributors", () => {
  it("attaches a namespaced facet from a registered contributor", async () => {
    const { inspector, scenes } = setup();
    inspector.registerFacetContributor(renderFacetContributor);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("sprite");
    e.add(new Transform({ position: new Vec2(100, 50) }));
    e.add(
      new FakeRenderComponent({
        bounds: { x: 90, y: 40, width: 20, height: 20 },
        visible: true,
      }),
    );

    const entity = inspector.snapshot().scenes[0]?.entities.find(
      (candidate) => candidate.id === String(e.id),
    );
    expect(entity?.facets?.["render"]).toEqual({
      bounds: { x: 90, y: 40, width: 20, height: 20 },
      visible: true,
    });
    const comp = entity?.components.find(
      (c) => c.type === "FakeRenderComponent",
    );
    expect(comp?.facets?.["render"]).toEqual({
      bounds: { x: 90, y: 40, width: 20, height: 20 },
      visible: true,
    });
  });

  it("passes a contributor's arbitrary payload through unchanged", async () => {
    const { inspector, scenes } = setup();
    inspector.registerFacetContributor(renderFacetContributor);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("split");
    e.add(new Transform());
    e.add(
      new FakeRenderComponent({
        bounds: { x: 0, y: 0, width: 30, height: 10 },
        visible: true,
        glyphs: [{ visible: true }, { visible: true }, { visible: false }],
      }),
    );

    // The facet payload is opaque to core — extra keys like `glyphs` ride
    // through untouched, which is what lets a renderer publish richer state.
    const entity = inspector.snapshot().scenes[0]?.entities[0];
    const render = entity?.facets?.["render"] as
      | { glyphs?: Array<{ visible: boolean }> }
      | undefined;
    expect(render?.glyphs).toEqual([
      { visible: true },
      { visible: true },
      { visible: false },
    ]);
  });

  it("leaves facets undefined when no contributor is registered", async () => {
    const { inspector, scenes } = setup();
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("sprite");
    e.add(new Transform());
    e.add(
      new FakeRenderComponent({
        bounds: { x: 0, y: 0, width: 4, height: 4 },
        visible: true,
      }),
    );

    // Core never reaches into components on its own — without a contributor the
    // facet seam is dormant and no `facets` key appears.
    const entity = inspector.snapshot().scenes[0]?.entities[0];
    expect(entity?.facets).toBeUndefined();
    const comp = entity?.components.find(
      (c) => c.type === "FakeRenderComponent",
    );
    expect(comp?.facets).toBeUndefined();
  });

  it("omits the facet for a component the contributor declines", async () => {
    const { inspector, scenes } = setup();
    inspector.registerFacetContributor(renderFacetContributor);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("plain");
    e.add(new Transform());
    e.add(new Health(42));

    const entity = inspector.snapshot().scenes[0]?.entities[0];
    expect(entity?.facets).toBeUndefined();
    const comp = entity?.components.find((c) => c.type === "Health");
    expect(comp?.facets).toBeUndefined();
  });

  it("tolerates a contributor whose inspectComponent throws", async () => {
    const { inspector, scenes } = setup();
    inspector.registerFacetContributor(renderFacetContributor);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("broken");
    e.add(new Transform());
    e.add(new ThrowingRenderComponent());

    const entity = inspector.snapshot().scenes[0]?.entities[0];
    expect(entity?.facets).toBeUndefined();
    const comp = entity?.components.find(
      (c) => c.type === "ThrowingRenderComponent",
    );
    // serialize() state is still captured; only the facet is omitted.
    expect(comp?.state).toEqual({ kind: "throws" });
    expect(comp?.facets).toBeUndefined();
  });

  it("surfaces the contributor's entity-level pick (first-added component)", async () => {
    const { inspector, scenes } = setup();
    inspector.registerFacetContributor(renderFacetContributor);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("multi");
    e.add(new Transform());
    // Insertion order — NOT class-name order — feeds `inspectEntity`. `Zeta` is
    // added first but sorts last alphabetically; `Alpha` is added second but
    // sorts first. The entity facet must mirror `Zeta` (the first painted
    // component), proving the contributor sees insertion order, not the
    // alphabetical sort applied to `components`.
    class Zeta extends FakeRenderComponent {}
    class Alpha extends FakeRenderComponent {}
    e.add(
      new Zeta({ bounds: { x: 5, y: 5, width: 1, height: 1 }, visible: false }),
    );
    e.add(
      new Alpha({ bounds: { x: 0, y: 0, width: 2, height: 2 }, visible: true }),
    );

    const entity = inspector.snapshot().scenes[0]?.entities[0];
    expect(entity?.facets?.["render"]).toEqual({
      bounds: { x: 5, y: 5, width: 1, height: 1 },
      visible: false,
    });
    // The `components` array itself stays alphabetically sorted for stable
    // snapshot output, independent of the insertion-order pick above.
    expect(entity?.components.map((c) => c.type)).toEqual([
      "Alpha",
      "Transform",
      "Zeta",
    ]);
  });

  it("stops contributing after the unregister handle is called", async () => {
    const { inspector, scenes } = setup();
    const unregister = inspector.registerFacetContributor(
      renderFacetContributor,
    );
    const scene = new TestScene("game");
    await scenes.push(scene);
    const e = scene.spawn("sprite");
    e.add(new Transform());
    e.add(
      new FakeRenderComponent({
        bounds: { x: 0, y: 0, width: 4, height: 4 },
        visible: true,
      }),
    );

    expect(
      inspector.snapshot().scenes[0]?.entities[0]?.facets?.["render"],
    ).toBeDefined();

    unregister();

    expect(
      inspector.snapshot().scenes[0]?.entities[0]?.facets,
    ).toBeUndefined();
  });
});
