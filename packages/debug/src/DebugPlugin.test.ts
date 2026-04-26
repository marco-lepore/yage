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

function createContext() {
  const context = new EngineContext();
  const scheduler = new SystemScheduler();
  const appStage = new mocks.MockContainer();
  const app = {
    stage: appStage,
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
    expect(clock.isManual).toBe(false);
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

    expect(clock.isManual).toBe(false);
    expect(() => clock.step()).toThrow("Manual clock is not active.");

    clock.stopAuto();
    expect(app.stop).toHaveBeenCalledOnce();
    expect(clock.isManual).toBe(true);

    clock.step(10);
    expect(loop.tick).toHaveBeenCalledWith(10);
    expect(app.render).toHaveBeenCalledOnce();

    clock.startAuto();
    expect(app.start).toHaveBeenCalledOnce();
    expect(clock.isManual).toBe(false);

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
