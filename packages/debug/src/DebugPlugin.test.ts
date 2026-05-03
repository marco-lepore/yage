import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDebugClock } from "./DebugClock.js";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set: vi.fn(function thisSet(
        this: { x: number; y: number },
        x: number,
        y: number,
      ) {
        this.x = x;
        this.y = y;
      }),
    };
    scale = {
      x: 1,
      y: 1,
      set: vi.fn(function thisSet(
        this: { x: number; y: number },
        x: number,
        y: number,
      ) {
        this.x = x;
        this.y = y;
      }),
    };
    rotation = 0;
    visible = true;
    eventMode = "passive";
    zIndex = 0;
    mask: MockContainer | null = null;

    addChild<T extends MockContainer>(child: T): T {
      this.children.push(child);
      return child;
    }

    removeFromParent(): void {}

    destroy(): void {}
  }

  class MockGraphics extends MockContainer {
    clear(): this {
      return this;
    }

    rect(): this {
      return this;
    }

    circle(): this {
      return this;
    }

    moveTo(): this {
      return this;
    }

    lineTo(): this {
      return this;
    }

    stroke(): this {
      return this;
    }

    fill(): this {
      return this;
    }
  }

  class MockText extends MockContainer {
    text = "";

    constructor(opts?: { text?: string }) {
      super();
      this.text = opts?.text ?? "";
    }
  }

  return { mocks: { MockContainer, MockGraphics, MockText } };
});

vi.mock("pixi.js", () => ({
  Container: mocks.MockContainer,
  Graphics: mocks.MockGraphics,
  Text: mocks.MockText,
}));

import {
  EngineContext,
  EventBus,
  EventBusKey,
  GameLoopKey,
  InspectorKey,
  SceneHookRegistry,
  SceneHookRegistryKey,
  SceneManager,
  SceneManagerKey,
  SystemScheduler,
  SystemSchedulerKey,
} from "@yagejs/core";
import type { Scene } from "@yagejs/core";
import {
  RendererKey,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "@yagejs/renderer";
import { DebugPlugin } from "./DebugPlugin.js";

type TickerListener = () => void;

interface FakeTicker {
  lastTime: number;
  deltaMS: number;
  minFPS: number;
  add: (fn: TickerListener) => void;
  remove: (fn: TickerListener) => void;
  update: (currentTime: number) => void;
  start: () => void;
  stop: () => void;
}

function createFakeTicker(): FakeTicker {
  const listeners: TickerListener[] = [];
  const ticker: FakeTicker = {
    lastTime: 0,
    deltaMS: 0,
    minFPS: 10,
    add: vi.fn((fn: TickerListener) => {
      listeners.push(fn);
    }),
    remove: vi.fn((fn: TickerListener) => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    update: vi.fn((currentTime: number) => {
      // Mirrors Pixi v8 Ticker.update — listener emission gated on
      // `currentTime > lastTime`, listeners get a deltaMS clamped only by
      // the configured minFPS (we honor `minFPS = 0` → no clamp, which the
      // host sets while frozen).
      if (currentTime > ticker.lastTime) {
        const elapsed = currentTime - ticker.lastTime;
        const maxElapsed =
          ticker.minFPS === 0 ? Infinity : 1000 / ticker.minFPS;
        ticker.deltaMS = Math.min(elapsed, maxElapsed);
        for (const fn of listeners) fn();
      }
      ticker.lastTime = currentTime;
    }),
    start: vi.fn(),
    stop: vi.fn(),
  };
  return ticker;
}

function createContext() {
  const context = new EngineContext();
  const scheduler = new SystemScheduler();
  const appStage = new mocks.MockContainer();
  const ticker = createFakeTicker();
  const app = {
    stage: appStage,
    ticker,
    stop: vi.fn(),
    start: vi.fn(),
    render: vi.fn(),
  };
  const renderer = {
    application: app,
    virtualSize: { width: 640, height: 360 },
  };
  const loop = {
    fixedTimestep: 20,
    tick: vi.fn(),
  };

  // Mirror what runs in production: `RendererPlugin` subscribes the GameLoop
  // tick via `app.ticker.add`, and Pixi v8's `TickerPlugin.init` auto-adds
  // `app.render` as a low-priority listener. The DebugClock tests need both
  // wired so a manual `host.advance` reaches the same subscribers a real
  // game has. If `RendererPlugin.ts` ever changes how it subscribes the
  // GameLoop (e.g. fixed dt instead of `app.ticker.deltaMS`), update both.
  ticker.add(() => loop.tick(ticker.deltaMS));
  ticker.add(() => app.render());
  const inspectorExtensions = new Map<string, object>();
  const inspector = {
    snapshot: () => ({
      frame: 0,
      sceneStack: [],
      entityCount: 0,
      systemCount: 0,
      errors: { disabledSystems: [], disabledComponents: [] },
    }),
    attachTimeController: vi.fn(),
    detachTimeController: vi.fn(),
    setEventLogEnabled: vi.fn(),
    setDefaultSceneSeed: vi.fn(),
    addExtension: vi.fn((namespace: string, api: object) => {
      inspectorExtensions.set(namespace, api);
      return api;
    }),
    getExtension: vi.fn((namespace: string) => inspectorExtensions.get(namespace)),
    removeExtension: vi.fn((namespace: string) => {
      inspectorExtensions.delete(namespace);
    }),
  };

  const bus = new EventBus();
  const hookRegistry = new SceneHookRegistry();
  const sceneManager = new SceneManager();

  const provider: SceneRenderTreeProvider = {
    createForScene: (): SceneRenderTree => ({
      root: new mocks.MockContainer() as never,
      get: () =>
        ({
          name: "default",
          order: 0,
          container: new mocks.MockContainer(),
        }) as never,
      tryGet: () =>
        ({
          name: "default",
          order: 0,
          container: new mocks.MockContainer(),
        }) as never,
      getAll: () => [],
      defaultLayer: {
        name: "default",
        order: 0,
      } as never,
      ensureLayer: () => ({ name: "default", order: 0 }) as never,
      fx: {
        addEffect: vi.fn(() => ({}) as never),
        findEffect: vi.fn(() => null),
      } as never,
      setMask: vi.fn(() => ({}) as never),
      clearMask: vi.fn(),
    }),
    destroyForScene: vi.fn(),
    getTree: vi.fn(),
    allTrees: () => [][Symbol.iterator](),
    bringSceneToFront: vi.fn(),
  };

  hookRegistry.register({
    beforeEnter: (scene: Scene) => {
      const tree = provider.createForScene(scene);
      scene._registerScoped(SceneRenderTreeKey, tree);
    },
    afterExit: (scene: Scene) => {
      provider.destroyForScene(scene);
    },
  });

  context.register(SystemSchedulerKey, scheduler);
  context.register(EventBusKey, bus as never);
  context.register(SceneHookRegistryKey, hookRegistry);
  context.register(SceneManagerKey, sceneManager);
  context.register(SceneRenderTreeProviderKey, provider);
  context.register(RendererKey, renderer as never);
  context.register(GameLoopKey, loop as never);
  context.register(InspectorKey, inspector as never);

  sceneManager._setContext(context);

  return { context, scheduler, app, loop, sceneManager, inspector };
}

function getExposedClock(): IDebugClock {
  const g = (globalThis as Record<string, unknown>)["__yage__"] as Record<
    string,
    unknown
  >;
  return g["clock"] as IDebugClock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget() as unknown as Window);
  (globalThis as Record<string, unknown>)["__yage__"] = {
    inspector: {},
    logger: {},
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["__yage__"];
  vi.unstubAllGlobals();
});

describe("DebugPlugin", () => {
  it("exposes a clock on the debug global in auto mode", async () => {
    const { context, scheduler, app, inspector } = createContext();
    const plugin = new DebugPlugin();

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const clock = getExposedClock();
    expect(clock.isFrozen).toBe(false);
    expect(app.stop).not.toHaveBeenCalled();
    expect(inspector.setDefaultSceneSeed).not.toHaveBeenCalled();
    expect(inspector.attachTimeController).toHaveBeenCalledOnce();
    expect(inspector.setEventLogEnabled).toHaveBeenCalledWith(true);

    plugin.onDestroy();
  });

  it("forwards a deterministic seed to the inspector when configured", async () => {
    const { context, scheduler, inspector } = createContext();
    const plugin = new DebugPlugin({ deterministicSeed: 0x00c0ffee });

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    expect(inspector.setDefaultSceneSeed).toHaveBeenCalledWith(0x00c0ffee);

    plugin.onDestroy();
  });

  it("stops Pixi's ticker during install when startFrozen is set", async () => {
    const { context, scheduler, app } = createContext();
    const plugin = new DebugPlugin({ startFrozen: true });

    plugin.install(context);
    // The ticker stop must land BEFORE registerSystems / onStart, since
    // those run after `loop.start()` in `Engine.start()` and any tick
    // between then and the user's first `freeze()` would mutate state.
    expect(app.stop).toHaveBeenCalledOnce();

    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const clock = getExposedClock();
    expect(clock.isFrozen).toBe(true);

    plugin.onDestroy();
  });

  it("steps exact frames and renders once per frame in manual mode", async () => {
    const { context, scheduler, app, loop } = createContext();
    const plugin = new DebugPlugin();

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const clock = getExposedClock();
    clock.freeze();
    clock.stepFrames(3);

    expect(loop.tick).toHaveBeenCalledTimes(3);
    expect(loop.tick).toHaveBeenNthCalledWith(1, 20);
    expect(loop.tick).toHaveBeenNthCalledWith(2, 20);
    expect(loop.tick).toHaveBeenNthCalledWith(3, 20);
    expect(app.render).toHaveBeenCalledTimes(3);

    plugin.onDestroy();
  });

  it("can toggle between auto mode and a frozen clock", async () => {
    const { context, scheduler, app, loop } = createContext();
    const plugin = new DebugPlugin();

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const clock = getExposedClock();

    expect(clock.isFrozen).toBe(false);
    expect(() => clock.step()).toThrow("DebugClock is not frozen.");

    clock.stopAuto();
    expect(app.stop).toHaveBeenCalledOnce();
    expect(clock.isFrozen).toBe(true);

    clock.step(10);
    expect(loop.tick).toHaveBeenCalledWith(10);
    expect(app.render).toHaveBeenCalledOnce();

    clock.startAuto();
    expect(app.start).toHaveBeenCalledOnce();
    expect(clock.isFrozen).toBe(false);

    plugin.onDestroy();
  });

  it("advances one frame from the step hotkey while the clock is frozen", async () => {
    const { context, scheduler, app, loop } = createContext();
    const plugin = new DebugPlugin();

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const clock = getExposedClock();
    clock.freeze();

    const event = new Event("keydown", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    Object.defineProperty(event, "code", { value: "Period" });

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(loop.tick).toHaveBeenCalledWith(20);
    expect(app.render).toHaveBeenCalledOnce();

    plugin.onDestroy();
  });

  it("step fires custom ticker subscribers (AnimatedSprite, pixi-filters, etc.)", async () => {
    // Regression: prior to the Pixi-ticker refactor, `clock.step()` called
    // `gameLoop.tick(dt)` and `app.render()` directly, bypassing the ticker.
    // That left AnimatedSprite, pixi-filters, and any user `app.ticker.add`
    // subscriber frozen during step mode — silently breaking visual probes.
    const { context, scheduler, app } = createContext();

    const plugin = new DebugPlugin();
    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    // Subscriber registered after onStart, just like a user adding an
    // AnimatedSprite to a scene at runtime.
    const animatedSpriteAdvance = vi.fn();
    app.ticker.add(animatedSpriteAdvance);

    const clock = getExposedClock();
    clock.freeze();
    clock.step();

    expect(animatedSpriteAdvance).toHaveBeenCalledOnce();

    plugin.onDestroy();
  });

  it("publishes renderer diagnostics on the inspector debug extension while installed", async () => {
    const { context, scheduler } = createContext();
    const plugin = new DebugPlugin();

    plugin.install(context);
    plugin.registerSystems(scheduler);
    await plugin.onStart();

    const inspector = context.resolve(InspectorKey) as {
      getExtension(namespace: string): unknown;
    };
    const diagnostics = inspector.getExtension("debug") as
      | { getLayerTransform?: unknown; getCameraStack?: unknown }
      | undefined;

    expect(typeof diagnostics?.getLayerTransform).toBe("function");
    expect(typeof diagnostics?.getCameraStack).toBe("function");

    plugin.onDestroy();

    expect(inspector.getExtension("debug")).toBeUndefined();
  });
});
