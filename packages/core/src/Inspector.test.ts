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
import { defineEvent } from "./EventToken.js";
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
    ).toThrow(
      'Inspector.addExtension(): namespace "inventory" is already registered.',
    );
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
        expect.objectContaining({
          kind: "System TestSystem",
          error: "sys-fail",
        }),
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

  it("logs a live engine object in a payload as a ref", async () => {
    const { inspector, scenes } = setup();
    inspector.setEventLogEnabled(true);
    const scene = new TestScene("game");
    await scenes.push(scene);
    const entity = scene.spawn("player");
    entity.add(new Health(80));

    const log = inspector.events.getLog();
    expect(
      log.find((entry) => entry.type === "entity:created")?.payload,
    ).toEqual({ entity: { id: entity.id, name: "player" } });
    expect(
      log.find(
        (entry) =>
          entry.type === "component:added" &&
          (entry.payload as { component: { component: string } }).component
            .component === "Health",
      )?.payload,
    ).toEqual({
      entity: { id: entity.id, name: "player" },
      component: { component: "Health" },
    });
    // The entity ref is what keeps its scene and the scene's internals out.
    expect(JSON.stringify(log)).not.toContain("_scene");
  });

  it("clones plain payload data and names any other class instance", async () => {
    const { inspector, scenes } = setup();
    inspector.setEventLogEnabled(true);
    const scene = new TestScene("game");
    await scenes.push(scene);
    inspector.attachSceneEventObserver(scene);
    const entity = scene.spawn("player");

    class Loot {
      constructor(readonly rarity: string) {}
    }
    const hit = defineEvent<Record<string, unknown>>("enemy:hit");
    entity.emit(hit, {
      at: new Vec2(12, -3),
      damage: { amount: 7, crit: true, tags: ["fire"] },
      drop: new Loot("rare"),
      slots: new Map(),
    });

    expect(
      inspector.events.getLog().find((entry) => entry.type === "enemy:hit"),
    ).toMatchObject({
      source: "entity",
      targetId: String(entity.id),
      payload: {
        at: { x: 12, y: -3 },
        damage: { amount: 7, crit: true, tags: ["fire"] },
        drop: { _type: "Loot" },
        slots: { _type: "Map" },
      },
    });
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

    it("reflects a public getter", async () => {
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

    it("reflects public component fields by default", async () => {
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
        fakeController(
          (count) => {
            frame += count;
            // Mirrors a SceneManager transition that resolves in a microtask
            // rather than synchronously within stepFrames().
            Promise.resolve().then(() => {
              transitionSettled = true;
            });
          },
          () => frame,
        ),
      );

      const frames = await inspector.time.stepUntil(() => transitionSettled);

      expect(frames).toBe(1);
      expect(transitionSettled).toBe(true);
    });

    it("throws once maxFrames is reached without the predicate becoming true", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(
        fakeController(
          () => {},
          () => 0,
        ),
      );

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
        fakeController(
          (count, dtMs) => {
            frame += count;
            dts.push(dtMs);
          },
          () => frame,
        ),
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

  describe("drive", () => {
    const InputManagerRuntimeKey = new ServiceKey<FakeInput>("inputManager");

    interface FakeInput {
      fireKeyDown(code: string): void;
      fireKeyUp(code: string): void;
      firePointerMove(x: number, y: number): void;
      firePointerDown(button?: 0 | 1 | 2): void;
      firePointerUp(button?: 0 | 1 | 2): void;
      fireGamepadButton(code: string, pressed: boolean): void;
      fireGamepadAxis(side: string, value: number): void;
      fireAction(name: string): void;
      clearAll(): void;
      snapshotState(): unknown;
    }

    /**
     * Records what a drive did, in order, so ordering can be asserted, and
     * tracks held keys so `snapshotState().keys` reports them for real —
     * what the `state`/`whileHolding` tests below read.
     */
    function fakeInput(log: string[]): FakeInput {
      const heldKeys = new Set<string>();
      return {
        fireKeyDown: (code) => {
          heldKeys.add(code);
          log.push(`down:${code}`);
        },
        fireKeyUp: (code) => {
          heldKeys.delete(code);
          log.push(`up:${code}`);
        },
        firePointerMove: () => log.push("pointerMove"),
        firePointerDown: () => log.push("pointerDown"),
        firePointerUp: () => log.push("pointerUp"),
        fireGamepadButton: () => log.push("padButton"),
        fireGamepadAxis: () => log.push("padAxis"),
        fireAction: (name) => log.push(`action:${name}`),
        clearAll: () => {
          heldKeys.clear();
          log.push("clearAll");
        },
        snapshotState: () => ({
          keys: [...heldKeys],
          actions: [],
          mouse: { x: 0, y: 0, buttons: [], down: false },
          pointers: [],
          gamepad: { buttons: [], axes: [] },
        }),
      };
    }

    /** A clock whose frozen state actually moves, so restore can be asserted. */
    function driveController(
      log: string[],
      onStep?: (count: number, dtMs?: number) => void,
    ) {
      let frame = 0;
      const controller = {
        isFrozen: false,
        freeze() {
          controller.isFrozen = true;
          log.push("freeze");
        },
        thaw() {
          controller.isFrozen = false;
          log.push("thaw");
        },
        stepFrames(count: number, dtMs?: number) {
          frame += count;
          log.push("step");
          onStep?.(count, dtMs);
        },
        setDelta() {},
        getFrame: () => frame,
      };
      return controller;
    }

    it("freezes a running clock for the drive and thaws it afterwards", async () => {
      const { inspector } = setup();
      const log: string[] = [];
      const controller = driveController(log);
      inspector.attachTimeController(controller);

      const result = await inspector.drive(async ({ step }) => {
        expect(controller.isFrozen).toBe(true);
        await step(2);
        return "done";
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe("done");
      expect(result.framesUsed).toBe(2);
      expect(controller.isFrozen).toBe(false);
      expect(log).toEqual(["freeze", "step", "step", "thaw"]);
    });

    it("leaves an already-frozen clock frozen", async () => {
      const { inspector } = setup();
      const log: string[] = [];
      const controller = driveController(log);
      controller.isFrozen = true;
      inspector.attachTimeController(controller);

      await inspector.drive(async ({ step }) => {
        await step(1);
      });

      expect(controller.isFrozen).toBe(true);
      expect(log).toEqual(["step"]);
    });

    it("releases synthetic input after the drive, even when the callback threw", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      const controller = driveController(log);
      inspector.attachTimeController(controller);
      ctx.register(InputManagerRuntimeKey, fakeInput(log));

      const result = await inspector.drive(({ input }) => {
        input.keyDown("KeyD");
        throw new Error("probe gave up");
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("probe gave up");
      expect(log).toEqual(["freeze", "down:KeyD", "clearAll", "thaw"]);
      expect(controller.isFrozen).toBe(false);
    });

    it("holds a key across frames and releases it after the frames are issued", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      let settledMidStep = false;
      const controller = driveController(log, () => {
        // A scene transition resolves in a microtask rather than inside
        // stepFrames; the drive's frames yield a macrotask, so it settles
        // before the key is released.
        void Promise.resolve().then(() => {
          settledMidStep = true;
          log.push("microtask");
        });
      });
      inspector.attachTimeController(controller);
      ctx.register(InputManagerRuntimeKey, fakeInput(log));

      await inspector.drive(async ({ input }) => {
        await input.hold("Space", 2);
      });

      expect(settledMidStep).toBe(true);
      expect(log).toEqual([
        "freeze",
        "down:Space",
        "step",
        "microtask",
        "step",
        "microtask",
        "up:Space",
        "clearAll",
        "thaw",
      ]);
    });

    it("fires an action once per frame", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      inspector.attachTimeController(driveController(log));
      ctx.register(InputManagerRuntimeKey, fakeInput(log));

      await inspector.drive(async ({ input }) => {
        await input.fireAction("jump", 2);
      });

      expect(log.filter((entry) => entry === "action:jump")).toHaveLength(2);
    });

    it("reports the frames until() took, and its exhaustion as a failed drive", async () => {
      const { inspector } = setup();
      const log: string[] = [];
      let stepped = 0;
      inspector.attachTimeController(
        driveController(log, () => {
          stepped++;
        }),
      );

      const reached = await inspector.drive(({ until }) =>
        until(() => stepped >= 3, { maxFrames: 10 }),
      );
      expect(reached.ok).toBe(true);
      if (reached.ok) expect(reached.value).toBe(3);

      const exhausted = await inspector.drive(async ({ until }) => {
        await until(() => false, { maxFrames: 3 });
      });
      expect(exhausted.ok).toBe(false);
      if (!exhausted.ok) {
        expect(exhausted.error).toContain("still false after 3 frames");
      }
    });

    it("throws from the call itself when DebugPlugin is not active", () => {
      const { inspector } = setup();

      expect(() => inspector.drive(() => undefined)).toThrow(
        "Inspector.time requires DebugPlugin to be active.",
      );
    });

    it("keeps the clock restored when releasing input throws", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      const controller = driveController(log);
      inspector.attachTimeController(controller);
      const input = fakeInput(log);
      // A game key-up listener that throws reaches clearAll through the
      // engine's error boundary, which reports and rethrows.
      input.clearAll = () => {
        log.push("clearAll");
        throw new Error("key-up listener failed");
      };
      ctx.register(InputManagerRuntimeKey, input);

      await expect(
        inspector.drive(({ input: driveInput }) => {
          driveInput.keyDown("KeyD");
        }),
      ).rejects.toThrow("key-up listener failed");

      expect(controller.isFrozen).toBe(false);
      expect(log).toEqual(["freeze", "down:KeyD", "clearAll", "thaw"]);
    });

    it("refuses a second drive while one is in flight", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      let inner: unknown;
      const outer = await inspector.drive(async ({ step }) => {
        try {
          await inspector.drive(() => undefined);
        } catch (error) {
          inner = error;
        }
        await step(1);
      });

      expect(outer.ok).toBe(true);
      expect((inner as Error).message).toContain("already in flight");
      // The guard clears, so the next drive runs.
      await expect(inspector.drive(() => "after")).resolves.toMatchObject({
        ok: true,
        value: "after",
      });
    });

    it("holds the guard until the clock is restored, so a key-up listener cannot nest a drive", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      const controller = driveController(log);
      inspector.attachTimeController(controller);
      const input = fakeInput(log);
      let nested: unknown;
      // A game key-up listener that reaches for the Inspector during the
      // release the drive itself issues.
      input.clearAll = () => {
        log.push("clearAll");
        try {
          void inspector.drive(() => undefined);
        } catch (error) {
          nested = error;
        }
      };
      ctx.register(InputManagerRuntimeKey, input);

      await inspector.drive(({ input: driveInput }) => {
        driveInput.keyDown("KeyD");
      });

      expect((nested as Error).message).toContain("already in flight");
      expect(controller.isFrozen).toBe(false);
    });

    it("passes dtMs through step and until to the clock", async () => {
      const { inspector } = setup();
      const dts: Array<number | undefined> = [];
      let frames = 0;
      inspector.attachTimeController(
        driveController([], (_count, dtMs) => {
          frames++;
          dts.push(dtMs);
        }),
      );

      await inspector.drive(async ({ step, until }) => {
        await step(2, { dtMs: 32 });
        await until(() => frames >= 3, { dtMs: 8 });
      });

      expect(dts).toEqual([32, 32, 8]);
    });

    it("reports frames and duration on a failed drive too", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(async ({ step }) => {
        await step(4);
        throw new Error("gave up late");
      });

      expect(result.ok).toBe(false);
      expect(result.framesUsed).toBe(4);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.captures).toEqual([]);
    });

    it("hands the callback the inspector's own event log", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(
        ({ events }) => events === inspector.events,
      );

      expect(result).toMatchObject({ ok: true, value: true });
    });

    it("collects captures the drive asked for", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));
      const dataUrl = "data:image/png;base64,AAAA";
      vi.spyOn(inspector.capture, "dataURL").mockResolvedValue(dataUrl);

      const result = await inspector.drive(async ({ capture }) => {
        await capture("before");
        await capture();
      });

      expect(result.captures).toEqual([
        { label: "before", dataUrl },
        { label: undefined, dataUrl },
      ]);
    });

    it("reports framesUsed live, counting frames issued through inspector.time.step directly too", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const seen: number[] = [];
      await inspector.drive(async (ctx) => {
        await ctx.step(2);
        seen.push(ctx.framesUsed);
        inspector.time.step(3);
        seen.push(ctx.framesUsed);
      });

      expect(seen).toEqual([2, 5]);
    });

    it("whileHolding nests: the inner release leaves the outer key held", async () => {
      const { inspector, ctx } = setup();
      inspector.attachTimeController(driveController([]));
      ctx.register(InputManagerRuntimeKey, fakeInput([]));

      let midRunKeys: string[] | undefined;
      await inspector.drive(async ({ input }) => {
        await input.whileHolding(["KeyA"], async () => {
          await input.whileHolding(["KeyB"], async () => {});
          midRunKeys = [...inspector.getInputState().keys];
        });
      });

      expect(midRunKeys).toEqual(["KeyA"]);
    });

    it("whileHolding resolves with what its callback returned", async () => {
      const { inspector, ctx } = setup();
      inspector.attachTimeController(driveController([]));
      ctx.register(InputManagerRuntimeKey, fakeInput([]));

      const run = await inspector.drive(async ({ input, until }) =>
        // The callback returns a value, so the hold has to pass it through
        // rather than force a `Promise<void>` wrapper at every call site.
        input.whileHolding(["KeyD"], () => until(() => true)),
      );

      expect(run).toMatchObject({ ok: true, value: 0 });
    });

    it("whileHolding leaves a code the caller already holds down when it returns", async () => {
      const { inspector, ctx } = setup();
      inspector.attachTimeController(driveController([]));
      ctx.register(InputManagerRuntimeKey, fakeInput([]));

      let insideKeys: string[] | undefined;
      let afterInnerKeys: string[] | undefined;
      await inspector.drive(async ({ input }) => {
        await input.whileHolding(["KeyD"], async () => {
          await input.whileHolding(["KeyD", "Space"], async () => {
            insideKeys = [...inspector.getInputState().keys].sort();
          });
          afterInnerKeys = [...inspector.getInputState().keys];
        });
      });

      expect(insideKeys).toEqual(["KeyD", "Space"]);
      // The inner call repeated "KeyD", so it is the outer call's to release.
      expect(afterInnerKeys).toEqual(["KeyD"]);
    });

    it("whileHolding releases exactly its own codes when fn throws, leaving other held keys alone", async () => {
      const { inspector, ctx } = setup();
      inspector.attachTimeController(driveController([]));
      ctx.register(InputManagerRuntimeKey, fakeInput([]));

      let keysAfterThrow: string[] | undefined;
      const result = await inspector.drive(async ({ input }) => {
        input.keyDown("KeyA");
        await expect(
          input.whileHolding(["KeyB"], async () => {
            throw new Error("maneuver failed");
          }),
        ).rejects.toThrow("maneuver failed");
        keysAfterThrow = [...inspector.getInputState().keys];
      });

      expect(result.ok).toBe(true);
      expect(keysAfterThrow).toEqual(["KeyA"]);
    });

    it("rejects a maxFrames that is not a non-negative integer or Infinity", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      for (const bad of [Number.NaN, -1, 1.5]) {
        expect(() => inspector.drive(async () => {}, { maxFrames: bad })).toThrow(
          "maxFrames must be a non-negative integer or Infinity",
        );
      }
      // Infinity disables the budget on purpose, so it has to be accepted.
      await expect(
        inspector.drive(async () => {}, { maxFrames: Number.POSITIVE_INFINITY }),
      ).resolves.toMatchObject({ ok: true });
    });

    it("ends a run that exceeds its frame budget with timedOut: true and framesUsed equal to the budget", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(
        async ({ step }) => {
          for (;;) {
            await step(1);
          }
        },
        { maxFrames: 5 },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.timedOut).toBe(true);
        expect(result.framesUsed).toBe(5);
      }
    });

    it("reports timedOut: false when the callback throws for its own reason", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(
        async () => {
          throw new Error("probe gave up");
        },
        { maxFrames: 5 },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.timedOut).toBe(false);
        expect(result.error).toBe("probe gave up");
      }
    });

    it("applies the default 10,000-frame budget when maxFrames is omitted", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(async ({ step }) => {
        // A single synchronous jump, so the test does not issue 10,000 real
        // macrotask-yielding frames to reach the default.
        inspector.time.step(10_000);
        await step(1);
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.timedOut).toBe(true);
    });

    it("never times out when maxFrames is Infinity", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(
        async ({ step }) => {
          inspector.time.step(50_000);
          await step(1);
        },
        { maxFrames: Infinity },
      );

      expect(result.ok).toBe(true);
    });

    it("captures state.keys before cleanup releases them", async () => {
      const { inspector, ctx } = setup();
      const log: string[] = [];
      inspector.attachTimeController(driveController(log));
      ctx.register(InputManagerRuntimeKey, fakeInput(log));

      const result = await inspector.drive(({ input }) => {
        input.keyDown("KeyD");
      });

      expect(result.ok).toBe(true);
      expect(result.state.keys).toEqual(["KeyD"]);
      // Cleanup still ran, releasing it after the read.
      expect(log).toContain("clearAll");
    });

    it("reports the scene stack on state.scenes", async () => {
      const { inspector } = setup();
      inspector.attachTimeController(driveController([]));

      const result = await inspector.drive(() => undefined);

      expect(result.state.scenes).toEqual(inspector.getSceneStack());
    });
  });
});

// A fake graphical component + a registered contributor that reads it. Mirrors
// how the renderer publishes its facet: core knows nothing about "render"; the
// contributor owns the namespace and the duck-typing. No Pixi / renderer dep.
class FakeRenderComponent extends Component {
  readonly kind = "fake";

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
}

class ThrowingRenderComponent extends Component {
  readonly kind = "throws";

  inspectRender(): never {
    throw new Error("display object not parented");
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

    const entity = inspector
      .snapshot()
      .scenes[0]?.entities.find((candidate) => candidate.id === String(e.id));
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
    // Reflected component state is still captured; only the facet is omitted.
    expect(comp?.state).toMatchObject({ kind: "throws" });
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

    expect(inspector.snapshot().scenes[0]?.entities[0]?.facets).toBeUndefined();
  });
});
