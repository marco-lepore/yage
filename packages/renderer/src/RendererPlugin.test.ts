import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = {
      x: 0,
      y: 0,
      set: vi.fn(function (
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
      set: vi.fn(function (
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
    alpha = 1;
    parent: MockContainer | null = null;
    sortableChildren = false;
    zIndex = 0;
    label = "";
    filters: unknown = null;

    addChild(child: MockContainer): MockContainer {
      this.children.push(child);
      child.parent = this;
      return child;
    }

    removeChild(child: MockContainer): MockContainer {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
      }
      return child;
    }

    sortChildren(): void {
      this.children.sort((a, b) => a.zIndex - b.zIndex);
    }

    destroy(): void {}
  }

  class MockTicker {
    callbacks: Array<() => void> = [];
    deltaMS = 16.67;

    add(fn: () => void): void {
      this.callbacks.push(fn);
    }

    remove(fn: () => void): void {
      const idx = this.callbacks.indexOf(fn);
      if (idx !== -1) this.callbacks.splice(idx, 1);
    }
  }

  class MockApplication {
    stage = new MockContainer();
    ticker = new MockTicker();
    canvas: unknown = {
      tagName: "CANVAS",
      style: { cssText: "" } as { cssText: string },
    };
    initOptions: Record<string, unknown> = {};
    renderer = {
      width: 800,
      height: 600,
      resize(this: { width: number; height: number }, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
      generateTexture: vi.fn((options: unknown) => ({
        label: "generated",
        options,
      })),
    };
    initialized = false;
    destroyCalled = false;

    async init(opts: Record<string, unknown> = {}): Promise<void> {
      this.initialized = true;
      this.initOptions = opts;
    }

    destroy(): void {
      this.destroyCalled = true;
    }
  }

  return { mocks: { MockContainer, MockTicker, MockApplication } };
});

vi.mock("pixi.js", () => {
  class MockFilter {
    enabled = true;
    constructor(public label = "filter") {}
  }
  class MockGraphics extends mocks.MockContainer {
    clear(): this {
      return this;
    }
    rect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
    destroy(): void {
      // mirror Pixi v8: just a no-op marker, parent removeChild already
      // detaches us from any container.
    }
  }
  return {
    Application: mocks.MockApplication,
    Container: mocks.MockContainer,
    Graphics: MockGraphics,
    Filter: MockFilter,
    AlphaFilter: class extends MockFilter {
      alpha: number;
      constructor(opts?: { alpha?: number }) {
        super("alpha");
        this.alpha = opts?.alpha ?? 1;
      }
    },
    TextureStyle: { defaultOptions: { scaleMode: "linear" } },
    Rectangle: class {
      constructor(
        public x: number,
        public y: number,
        public width: number,
        public height: number,
      ) {}
    },
  };
});

import {
  EngineContext,
  GameLoop,
  GameLoopKey,
  ProcessSystem,
  ProcessSystemKey,
  Scene,
  SceneManager,
  SceneManagerKey,
  SystemScheduler,
  SystemSchedulerKey,
  QueryCache,
  QueryCacheKey,
  EventBus,
  EventBusKey,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  SceneHookRegistry,
  SceneHookRegistryKey,
  markPointerConsumeContainer,
} from "@yagejs/core";
import type { EngineEvents, SceneTransition } from "@yagejs/core";
import { RendererPlugin } from "./RendererPlugin.js";
import { RendererKey } from "./types.js";
import { SceneRenderTreeProviderKey } from "./SceneRenderTree.js";
import type { RendererConfig } from "./types.js";

function createInstallContext(): {
  context: EngineContext;
  gameLoop: GameLoop;
  scheduler: SystemScheduler;
} {
  const context = new EngineContext();
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);

  context.register(GameLoopKey, gameLoop);
  context.register(SystemSchedulerKey, scheduler);
  context.register(ProcessSystemKey, new ProcessSystem());
  context.register(QueryCacheKey, queryCache);
  context.register(EventBusKey, bus);
  context.register(ErrorBoundaryKey, boundary);
  context.register(SceneHookRegistryKey, new SceneHookRegistry());
  scheduler.setErrorBoundary(boundary);

  return { context, gameLoop, scheduler };
}

const defaultConfig: RendererConfig = {
  width: 800,
  height: 600,
};

describe("RendererPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct name and version", () => {
    const plugin = new RendererPlugin(defaultConfig);
    expect(plugin.name).toBe("renderer");
    expect(plugin.version).toBe("4.0.0");
  });

  describe("install", () => {
    it("registers all services in context", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(context.has(RendererKey)).toBe(true);
      expect(context.has(SceneRenderTreeProviderKey)).toBe(true);
    });

    it("registers self as RendererKey", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(context.resolve(RendererKey)).toBe(plugin);
    });

    it("attaches ticker to GameLoop", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      // GameLoop should have a ticker attached (check that loop doesn't use rAF)
      // The ticker was attached via attachTicker(), so starting the loop
      // should not throw. We can verify by checking the app ticker callbacks.
      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      expect(app.ticker.callbacks).toHaveLength(1);
    });

    it("appends canvas to container when specified", async () => {
      const container = {
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({ ...defaultConfig, container });
      await plugin.install(context);

      expect(
        (container as unknown as { appendChild: ReturnType<typeof vi.fn> })
          .appendChild,
      ).toHaveBeenCalledWith(plugin.canvas);
    });

    it("initializes PixiJS Application", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      expect(app.initialized).toBe(true);
    });
  });

  describe("registerSystems", () => {
    it("adds DisplaySystem to scheduler", async () => {
      const { context, scheduler } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      plugin.registerSystems(scheduler);

      const renderSystems = scheduler.getSystems("render" as never);
      expect(renderSystems).toHaveLength(1);
    });
  });

  describe("onDestroy", () => {
    it("destroys PixiJS Application", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      plugin.onDestroy?.();
      expect(app.destroyCalled).toBe(true);
    });

    it("removes ticker callback before destroying app", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      expect(app.ticker.callbacks).toHaveLength(1);

      plugin.onDestroy?.();
      expect(app.ticker.callbacks).toHaveLength(0);
    });
  });

  describe("virtual resolution", () => {
    it("defaults virtualSize to canvas size", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(plugin.virtualSize).toEqual({ width: 800, height: 600 });
    });

    it("uses custom virtual dimensions", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        virtualWidth: 1920,
        virtualHeight: 1080,
      });
      await plugin.install(context);

      expect(plugin.virtualSize).toEqual({ width: 1920, height: 1080 });
    });

    it("computes correct scale for same aspect ratio", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        width: 800,
        height: 600,
        virtualWidth: 400,
        virtualHeight: 300,
      });
      await plugin.install(context);

      // scale = min(800/400, 600/300) = min(2, 2) = 2
      // The fit transform lives on the renderer's `_worldRoot` (first child
      // of stage), not on stage itself — see RendererPlugin._worldRoot.
      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      const worldRoot = app.stage.children[0]!;
      expect(worldRoot.scale.x).toBe(2);
      expect(worldRoot.scale.y).toBe(2);
      // Stage itself stays at identity so `@pixi/tilemap` doesn't double-apply.
      expect(app.stage.scale.x).toBe(1);
      expect(app.stage.scale.y).toBe(1);
    });

    it("computes correct scale for wider canvas (pillarbox)", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        width: 1000,
        height: 600,
        virtualWidth: 400,
        virtualHeight: 300,
      });
      await plugin.install(context);

      // scale = min(1000/400, 600/300) = min(2.5, 2) = 2
      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      const worldRoot = app.stage.children[0]!;
      expect(worldRoot.scale.x).toBe(2);
      expect(worldRoot.scale.y).toBe(2);
      // offsetX = (1000 - 400*2) / 2 = 100; position is in screen space
      expect(worldRoot.position.x).toBe(100);
    });

    it("computes correct scale for taller canvas (letterbox)", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        width: 800,
        height: 800,
        virtualWidth: 400,
        virtualHeight: 300,
      });
      await plugin.install(context);

      // scale = min(800/400, 800/300) = min(2, 2.667) = 2
      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      const worldRoot = app.stage.children[0]!;
      expect(worldRoot.scale.x).toBe(2);
      expect(worldRoot.scale.y).toBe(2);
      // offsetY = (800 - 300*2) / 2 = 100; position is in screen space
      expect(worldRoot.position.y).toBe(100);
    });
  });

  describe("canvas handling", () => {
    it("exposes canvas element", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(plugin.canvas).toBeDefined();
    });

    it("passes canvas option to PixiJS when provided", async () => {
      const canvas = { tagName: "CANVAS" } as unknown as HTMLCanvasElement;
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({ ...defaultConfig, canvas });
      await plugin.install(context);

      // Application was initialized (no error), canvas option was accepted
      expect(plugin.application).toBeDefined();
    });
  });

  describe("fit configuration", () => {
    class StubResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }

    function makeHost(width: number, height: number): HTMLElement {
      return {
        getBoundingClientRect: () => ({
          width,
          height,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      } as unknown as HTMLElement;
    }

    let originalRO: typeof globalThis.ResizeObserver | undefined;

    beforeEach(() => {
      originalRO = globalThis.ResizeObserver;
      globalThis.ResizeObserver =
        StubResizeObserver as unknown as typeof globalThis.ResizeObserver;
    });

    afterEach(() => {
      if (originalRO) globalThis.ResizeObserver = originalRO;
      else
        delete (globalThis as unknown as { ResizeObserver?: unknown })
          .ResizeObserver;
    });

    it("keeps the configured target when only the mode changes", async () => {
      const host = makeHost(1000, 500);
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        fit: { mode: "letterbox", target: host },
      });
      await plugin.install(context);
      expect(plugin.fit.target).toBe(host);

      plugin.setFit({ mode: "cover" });

      expect(plugin.fit.mode).toBe("cover");
      expect(plugin.fit.target).toBe(host);
    });

    it("switches target when a new one is passed", async () => {
      const host = makeHost(1000, 500);
      const other = makeHost(400, 400);
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        fit: { mode: "letterbox", target: host },
      });
      await plugin.install(context);

      plugin.setFit({ mode: "letterbox", target: other });

      expect(plugin.fit.target).toBe(other);
    });
  });

  describe("scene render trees", () => {
    it("exposes the per-scene render tree provider", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(plugin.sceneRenderTrees).toBeDefined();
    });
  });

  describe("transparentBelow visibility", () => {
    function makeScene(name: string, transparentBelow = false): Scene {
      // Bypass the `readonly` compile-time guard so tests can spin up scenes
      // with arbitrary flag combinations without dedicated subclasses.
      class TestScene extends Scene {
        readonly name = name;
      }
      const scene = new TestScene();
      (scene as { transparentBelow: boolean }).transparentBelow =
        transparentBelow;
      return scene;
    }

    async function setupWithSceneManager(): Promise<{
      plugin: RendererPlugin;
      scenes: SceneManager;
      bus: EventBus<EngineEvents>;
    }> {
      const { context } = createInstallContext();
      const scenes = new SceneManager();
      context.register(SceneManagerKey, scenes);
      scenes._setContext(context);
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      const bus = context.resolve(EventBusKey);
      return { plugin, scenes, bus };
    }

    it("hides the below scene when an opaque scene is pushed on top", async () => {
      const { plugin, scenes } = await setupWithSceneManager();
      const below = makeScene("below");
      const top = makeScene("top", false);

      await scenes.push(below);
      const belowTree = plugin.sceneRenderTrees.getTree(below)!;
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        true,
      );

      await scenes.push(top);
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        false,
      );
    });

    it("keeps the below scene visible when the top scene is transparentBelow=true", async () => {
      const { plugin, scenes } = await setupWithSceneManager();
      const below = makeScene("below");
      const top = makeScene("top", true);

      await scenes.push(below);
      await scenes.push(top);

      const belowTree = plugin.sceneRenderTrees.getTree(below)!;
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        true,
      );
    });

    it("re-shows a hidden below scene when the opaque cover is popped", async () => {
      const { plugin, scenes } = await setupWithSceneManager();
      const below = makeScene("below");
      const top = makeScene("top", false);

      await scenes.push(below);
      await scenes.push(top);
      const belowTree = plugin.sceneRenderTrees.getTree(below)!;
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        false,
      );

      await scenes.pop();
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        true,
      );
    });

    it("keeps the outgoing scene visible during a push-with-transition", async () => {
      // Pins the event-ordering invariant `installSceneVisibilityListeners`
      // depends on: `scene:pushed` must fire BEFORE `scene:transition:started`
      // for any push-with-transition, so the start-of-transition `resetVisibility`
      // can re-show the outgoing scene that the prior `applyTransparentBelow`
      // hid. If `SceneManager` ever flipped that order, this test would catch
      // the regression — the outgoing scene would cut to black mid-transition
      // instead of dissolving.
      const { plugin, scenes } = await setupWithSceneManager();
      const below = makeScene("below");
      const top = makeScene("top", false);
      await scenes.push(below);

      const belowTree = plugin.sceneRenderTrees.getTree(below)!;

      let visibleAtBegin: boolean | null = null;
      const transition: SceneTransition = {
        duration: 100,
        begin: () => {
          visibleAtBegin = (belowTree.root as unknown as { visible: boolean })
            .visible;
        },
        tick: () => {},
      };

      const pushPromise = scenes.push(top, { transition });
      // Flush microtasks so SceneManager.push gets past _pushScene's awaits
      // and runs _runTransition's synchronous emit + begin().
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(visibleAtBegin).toBe(true);

      scenes._tickTransition(100);
      await pushPromise;

      // After scene:transition:ended fires recompute, the chain settles
      // with `below` hidden under the opaque `top`.
      expect((belowTree.root as unknown as { visible: boolean }).visible).toBe(
        false,
      );
    });

    it("does not re-show the outgoing scene on the frame a pop transition ends (#102)", async () => {
      // Regression: the end-of-transition recompute must run against the
      // post-pop stack. If it sees the stale stack (outgoing scene still on
      // top), `applyTransparentBelow` re-shows the outgoing root for the
      // frame that renders right as the transition ends — a one-frame flash.
      const { plugin, scenes, bus } = await setupWithSceneManager();
      const a = makeScene("a", false);
      const b = makeScene("b", false);
      await scenes.push(a);
      await scenes.push(b);

      const aTree = plugin.sceneRenderTrees.getTree(a)!;

      // Capture the world state at the instant `scene:transition:ended` fires
      // — this is the frame that would have flashed.
      let bStillOnStackAtEnd: boolean | null = null;
      let aVisibleAtEnd: boolean | null = null;
      bus.on("scene:transition:ended", () => {
        bStillOnStackAtEnd = scenes.all.includes(b);
        aVisibleAtEnd = (aTree.root as unknown as { visible: boolean }).visible;
      });

      const transition: SceneTransition = { duration: 100, tick: () => {} };
      const popPromise = scenes.pop({ transition });
      await new Promise<void>((r) => setTimeout(r, 0));

      scenes._tickTransition(100);
      await popPromise;

      expect(bStillOnStackAtEnd).toBe(false);
      expect(aVisibleAtEnd).toBe(true);
      expect((aTree.root as unknown as { visible: boolean }).visible).toBe(
        true,
      );
    });
  });

  describe("screen-scope fx.addEffect", () => {
    it("attaches the filter to app.stage", async () => {
      const { rawFilter } = await import("./effects/rawFilter.js");
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const f = { enabled: true, label: "screen-vignette" };
      plugin.fx.addEffect(rawFilter(f as never));

      const stage = plugin.application.stage as unknown as {
        filters: unknown;
      };
      expect(stage.filters).toEqual([f]);
    });

    it("strips owned filters but preserves user-assigned filters on destroy", async () => {
      const { rawFilter } = await import("./effects/rawFilter.js");
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const userFilter = { enabled: true, label: "user" };
      const ownedFilter = { enabled: true, label: "screen-vignette" };
      plugin.fx.addEffect(rawFilter(ownedFilter as never));

      const stage = plugin.application.stage as unknown as {
        filters: unknown[] | null;
      };
      // Simulate a caller appending their own filter alongside the host's
      // owned one (real callers would do `stage.filters = [...stage.filters,
      // userFilter]`). The overwrite makes the post-onDestroy assertion
      // independent of any prior state EffectsHost may have left behind.
      stage.filters = [userFilter, ownedFilter];

      plugin.onDestroy();
      expect(stage.filters).toEqual([userFilter]);
    });

    it("fx is undefined before install (no ProcessSystem yet)", () => {
      const plugin = new RendererPlugin(defaultConfig);
      // Plugin must be installed before its screen-scope EffectsHost exists;
      // accessing `.fx` before that is a programmer error.
      expect(plugin.fx).toBeUndefined();
    });
  });

  describe("fullscreen", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("calls requestFullscreen on the configured container", async () => {
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const container = {
        requestFullscreen,
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      vi.stubGlobal("document", {
        fullscreenElement: null,
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const plugin = new RendererPlugin({ ...defaultConfig, container });
      await plugin.install(context);
      await plugin.requestFullscreen();

      expect(requestFullscreen).toHaveBeenCalledOnce();
    });

    it("falls back to the webkit-prefixed API when unprefixed is unavailable", async () => {
      const webkitRequestFullscreen = vi.fn();
      const container = {
        webkitRequestFullscreen,
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      vi.stubGlobal("document", {
        webkitFullscreenElement: null,
        webkitExitFullscreen: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const plugin = new RendererPlugin({ ...defaultConfig, container });
      await plugin.install(context);
      await plugin.requestFullscreen();

      expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
    });

    it("emits screen:fullscreen when fullscreenchange fires", async () => {
      let changeHandler: (() => void) | null = null;
      const container = {
        requestFullscreen: vi.fn().mockResolvedValue(undefined),
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      vi.stubGlobal("document", {
        fullscreenElement: null,
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn((event: string, fn: () => void) => {
          if (event === "fullscreenchange") changeHandler = fn;
        }),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const bus = context.resolve(EventBusKey);
      const received: Array<{ active: boolean }> = [];
      bus.on("screen:fullscreen", (data) => received.push(data));

      const plugin = new RendererPlugin({ ...defaultConfig, container });
      await plugin.install(context);

      // Simulate the browser entering fullscreen, then dispatching the event.
      const fire = changeHandler as unknown as (() => void) | null;
      (
        document as unknown as { fullscreenElement: HTMLElement | null }
      ).fullscreenElement = container;
      fire?.();
      expect(received).toEqual([{ active: true }]);

      (
        document as unknown as { fullscreenElement: HTMLElement | null }
      ).fullscreenElement = null;
      fire?.();
      expect(received).toEqual([{ active: true }, { active: false }]);
    });

    it("removes the fullscreenchange listener on destroy", async () => {
      const removeEventListener = vi.fn();
      const container = {
        requestFullscreen: vi.fn().mockResolvedValue(undefined),
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      vi.stubGlobal("document", {
        fullscreenElement: null,
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener,
      });

      const { context } = createInstallContext();
      const plugin = new RendererPlugin({ ...defaultConfig, container });
      await plugin.install(context);
      plugin.onDestroy();

      // Both the standard and prefixed listener names are detached.
      const detached = removeEventListener.mock.calls.map(
        (args: unknown[]) => args[0],
      );
      expect(detached).toContain("fullscreenchange");
      expect(detached).toContain("webkitfullscreenchange");
    });
  });

  describe("pixelArtPreset", () => {
    // The mocked TextureStyle module is shared across tests in this file —
    // every assertion below either resets it explicitly or only inspects
    // values it just wrote. Without the reset, an earlier test setting
    // `nearest` would make the "doesn't touch defaults" assertion in the
    // next test trivially pass.
    beforeEach(async () => {
      const pixi = (await import("pixi.js")) as unknown as {
        TextureStyle: { defaultOptions: { scaleMode: string } };
      };
      pixi.TextureStyle.defaultOptions.scaleMode = "linear";
    });

    it("flips TextureStyle.defaultOptions.scaleMode to 'nearest' when enabled", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        pixelArtPreset: true,
      });
      await plugin.install(context);

      const pixi = (await import("pixi.js")) as unknown as {
        TextureStyle: { defaultOptions: { scaleMode: string } };
      };
      expect(pixi.TextureStyle.defaultOptions.scaleMode).toBe("nearest");
    });

    it("leaves TextureStyle.defaultOptions alone when disabled (default)", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const pixi = (await import("pixi.js")) as unknown as {
        TextureStyle: { defaultOptions: { scaleMode: string } };
      };
      expect(pixi.TextureStyle.defaultOptions.scaleMode).toBe("linear");
    });

    it("passes roundPixels: true to Application.init when enabled", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        pixelArtPreset: true,
      });
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      expect(app.initOptions.roundPixels).toBe(true);
    });

    it("lets explicit pixi.roundPixels override the preset", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        pixelArtPreset: true,
        pixi: { roundPixels: false },
      });
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<
        typeof mocks.MockApplication
      >;
      expect(app.initOptions.roundPixels).toBe(false);
    });

    it("applies image-rendering CSS to the canvas when enabled", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        pixelArtPreset: true,
      });
      await plugin.install(context);

      const canvas = plugin.canvas as unknown as { style: { cssText: string } };
      // Both declarations land in order — Safari keeps the optimize-contrast
      // value, modern browsers keep `pixelated`. Asserting on substrings
      // avoids over-specifying whitespace.
      expect(canvas.style.cssText).toContain("-webkit-optimize-contrast");
      expect(canvas.style.cssText).toContain("pixelated");
    });

    it("leaves the canvas style untouched when disabled", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const canvas = plugin.canvas as unknown as { style: { cssText: string } };
      expect(canvas.style.cssText).toBe("");
    });

    it("restores TextureStyle.defaultOptions.scaleMode on destroy", async () => {
      // Pixi's TextureStyle.defaultOptions is a module-level singleton; if
      // we don't restore it, later plugin instances and any texture loaded
      // after teardown inherit nearest sampling silently.
      const pixi = (await import("pixi.js")) as unknown as {
        TextureStyle: { defaultOptions: { scaleMode: string } };
      };
      pixi.TextureStyle.defaultOptions.scaleMode = "linear";

      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        pixelArtPreset: true,
      });
      await plugin.install(context);
      expect(pixi.TextureStyle.defaultOptions.scaleMode).toBe("nearest");

      plugin.onDestroy();
      expect(pixi.TextureStyle.defaultOptions.scaleMode).toBe("linear");
    });

    it("does not touch TextureStyle on destroy when preset was off", async () => {
      const pixi = (await import("pixi.js")) as unknown as {
        TextureStyle: { defaultOptions: { scaleMode: string } };
      };
      pixi.TextureStyle.defaultOptions.scaleMode = "nearest"; // simulate a value set externally

      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      plugin.onDestroy();

      // Plugin had no preset on, so destroy shouldn't clobber externally-set values.
      expect(pixi.TextureStyle.defaultOptions.scaleMode).toBe("nearest");
    });
  });

  describe("orientation", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("emits screen:orientation when the screen orientation changes", async () => {
      let changeHandler: (() => void) | null = null;
      const orientationMock = {
        type: "landscape-primary",
        addEventListener: vi.fn((event: string, fn: () => void) => {
          if (event === "change") changeHandler = fn;
        }),
        removeEventListener: vi.fn(),
      };
      vi.stubGlobal("window", {
        screen: { orientation: orientationMock },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal("document", {
        fullscreenElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const bus = context.resolve(EventBusKey);
      const received: Array<{ type: OrientationType }> = [];
      bus.on("screen:orientation", (data) => received.push(data));

      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      orientationMock.type = "portrait-primary";
      (changeHandler as unknown as (() => void) | null)?.();

      expect(received).toEqual([{ type: "portrait-primary" }]);
      expect(plugin.orientation).toBe("portrait-primary");
    });

    it("falls back to window.orientationchange on browsers without screen.orientation", async () => {
      let changeHandler: (() => void) | null = null;
      const windowAddEventListener = vi.fn((event: string, fn: () => void) => {
        if (event === "orientationchange") changeHandler = fn;
      });
      vi.stubGlobal("window", {
        screen: {},
        orientation: 90,
        addEventListener: windowAddEventListener,
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal("document", {
        fullscreenElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const bus = context.resolve(EventBusKey);
      const received: Array<{ type: OrientationType }> = [];
      bus.on("screen:orientation", (data) => received.push(data));

      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      (changeHandler as unknown as (() => void) | null)?.();
      expect(received).toEqual([{ type: "landscape-primary" }]);
    });

    it("removes the orientation listener on destroy", async () => {
      const removeEventListener = vi.fn();
      vi.stubGlobal("window", {
        screen: {
          orientation: {
            type: "portrait-primary",
            addEventListener: vi.fn(),
            removeEventListener,
          },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal("document", {
        fullscreenElement: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      plugin.onDestroy();

      expect(removeEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
    });
  });
  describe("UI hit testing and pointer dispatch", () => {
    /** A container chain the hit test can walk, innermost first. */
    function chain(depth: number): Array<{ parent: object | null }> {
      const nodes: Array<{ parent: object | null }> = [];
      for (let i = 0; i < depth; i++) nodes.push({ parent: null });
      for (let i = 0; i < depth - 1; i++) {
        nodes[i]!.parent = nodes[i + 1]!;
      }
      return nodes;
    }

    /** Give the mock renderer an event boundary that reports `hit`. */
    function attachBoundary(
      plugin: RendererPlugin,
      hit: object | null,
    ): { rootTarget: unknown; hitTest: ReturnType<typeof vi.fn> } {
      const boundary = {
        rootTarget: null as unknown,
        hitTest: vi.fn(() => hit),
      };
      const renderer = plugin.application.renderer as unknown as {
        events?: { rootBoundary: unknown };
      };
      renderer.events = { rootBoundary: boundary };
      return boundary;
    }

    async function installed(): Promise<RendererPlugin> {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      return plugin;
    }

    /** Installed into a host half the virtual size, so the fit scales by 0.5. */
    async function installedHalfScale(): Promise<RendererPlugin> {
      class StubResizeObserver {
        observe(): void {}
        disconnect(): void {}
      }
      globalThis.ResizeObserver =
        StubResizeObserver as unknown as typeof globalThis.ResizeObserver;
      const host = {
        getBoundingClientRect: () => ({
          width: 400,
          height: 300,
          top: 0,
          left: 0,
          right: 400,
          bottom: 300,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      } as unknown as HTMLElement;
      const { context } = createInstallContext();
      const plugin = new RendererPlugin({
        ...defaultConfig,
        fit: { mode: "letterbox", target: host },
      });
      await plugin.install(context);
      return plugin;
    }

    let originalResizeObserver: typeof globalThis.ResizeObserver | undefined;

    beforeEach(() => {
      originalResizeObserver = globalThis.ResizeObserver;
    });

    afterEach(() => {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver;
      } else {
        delete (globalThis as unknown as { ResizeObserver?: unknown })
          .ResizeObserver;
      }
    });

    it("returns the hit container and its ancestors, innermost first", async () => {
      const plugin = await installed();
      const nodes = chain(3);
      attachBoundary(plugin, nodes[0]!);

      expect(plugin.hitTestUIPath(10, 20)).toEqual({
        path: [nodes[0], nodes[1], nodes[2]],
        consumed: false,
      });
    });

    it("marks the path consumed when any ancestor is a consume surface", async () => {
      const plugin = await installed();
      const nodes = chain(3);
      markPointerConsumeContainer(nodes[2]!);
      attachBoundary(plugin, nodes[0]!);

      expect(plugin.hitTestUIPath(10, 20)?.consumed).toBe(true);
      expect(plugin.hitTestUI(10, 20)).toBe(true);
    });

    it("reports no hit when nothing interactive is under the point", async () => {
      const plugin = await installed();
      attachBoundary(plugin, null);

      expect(plugin.hitTestUIPath(10, 20)).toBeNull();
      expect(plugin.hitTestUI(10, 20)).toBe(false);
    });

    it("reports no hit without an event system", async () => {
      const plugin = await installed();

      expect(plugin.hitTestUIPath(10, 20)).toBeNull();
      expect(plugin.hitTestUI(10, 20)).toBe(false);
    });

    it("hit-tests in canvas coordinates", async () => {
      const plugin = await installedHalfScale();
      const boundary = attachBoundary(plugin, chain(1)[0]!);

      plugin.hitTestUIPath(120, 90);

      // The canvas is half virtual size here, so the point the boundary is
      // asked about is half the one the caller named. Forwarding the virtual
      // point unconverted would land somewhere else on every scaled canvas.
      expect(boundary.hitTest).toHaveBeenCalledWith(60, 45);
    });

    it("binds the boundary root before the first frame", async () => {
      const plugin = await installed();
      const boundary = attachBoundary(plugin, chain(1)[0]!);

      plugin.hitTestUIPath(10, 20);

      expect(boundary.rootTarget).toBe(plugin.worldRoot);
    });

    it("reports whether a frame has been rendered", async () => {
      const plugin = await installed();
      const renderer = plugin.application.renderer as unknown as {
        lastObjectRendered?: unknown;
      };

      expect(plugin.hasRenderedFrame()).toBe(false);

      renderer.lastObjectRendered = plugin.application.stage;
      expect(plugin.hasRenderedFrame()).toBe(true);
    });

    /** Stands in for the DOM constructor, which node's runtime lacks. */
    class StubPointerEvent {
      constructor(
        readonly type: string,
        readonly init: PointerEventInit,
      ) {}
    }

    /**
     * Give the mock canvas a page position and an event sink, and mark a
     * frame as drawn so dispatch is allowed.
     */
    function instrument(plugin: RendererPlugin): StubPointerEvent[] {
      const dispatched: StubPointerEvent[] = [];
      const canvas = plugin.application.canvas as unknown as Record<
        string,
        unknown
      >;
      canvas["getBoundingClientRect"] = (): { left: number; top: number } => ({
        left: 12,
        top: 8,
      });
      canvas["dispatchEvent"] = (event: StubPointerEvent): boolean => {
        dispatched.push(event);
        return true;
      };
      const renderer = plugin.application.renderer as unknown as {
        lastObjectRendered?: unknown;
      };
      renderer.lastObjectRendered = plugin.application.stage;
      return dispatched;
    }

    beforeEach(() => {
      vi.stubGlobal("PointerEvent", StubPointerEvent);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("dispatches at the canvas, in client pixels", async () => {
      const plugin = await installedHalfScale();
      const dispatched = instrument(plugin);

      plugin.dispatchPointerEvent("down", { x: 120, y: 90 }, 0);

      // The canvas is half virtual size here and sits at (12, 8) in the page:
      // virtual (120, 90) is canvas (60, 45) is client (72, 53). Dispatching
      // the virtual point unconverted would land at (132, 98).
      const [event] = dispatched;
      expect(event?.type).toBe("pointerdown");
      expect(event?.init.clientX).toBe(72);
      expect(event?.init.clientY).toBe(53);
      expect(event?.init.bubbles).toBe(true);
      expect(event?.init.pointerId).toBe(1);
      expect(event?.init.pointerType).toBe("mouse");
      expect(event?.init.isPrimary).toBe(true);
    });

    it("keeps a pressed button held across a move, until its release", async () => {
      const plugin = await installed();
      const dispatched = instrument(plugin);

      plugin.dispatchPointerEvent("down", { x: 10, y: 10 }, 0);
      plugin.dispatchPointerEvent("move", { x: 20, y: 20 });
      plugin.dispatchPointerEvent("up", { x: 20, y: 20 }, 0);
      plugin.dispatchPointerEvent("move", { x: 30, y: 30 });

      // A drag reports the held button on every move it is made of, and a
      // move presses and releases nothing, which the DOM writes as -1.
      expect(
        dispatched.map((event) => [
          event.type,
          event.init.button,
          event.init.buttons,
        ]),
      ).toEqual([
        ["pointerdown", 0, 1],
        ["pointermove", -1, 1],
        ["pointerup", 0, 0],
        ["pointermove", -1, 0],
      ]);
    });

    it("maps each mouse button to its DOM bit", async () => {
      const plugin = await installed();
      const dispatched = instrument(plugin);

      plugin.dispatchPointerEvent("down", { x: 1, y: 1 }, 1);
      plugin.dispatchPointerEvent("up", { x: 1, y: 1 }, 1);
      plugin.dispatchPointerEvent("down", { x: 1, y: 1 }, 2);

      expect(
        dispatched.map((event) => [event.init.button, event.init.buttons]),
      ).toEqual([
        [1, 4],
        [1, 0],
        [2, 2],
      ]);
    });

    it("refuses to dispatch before the first rendered frame", async () => {
      const plugin = await installed();
      const dispatched = instrument(plugin);
      const renderer = plugin.application.renderer as unknown as {
        lastObjectRendered?: unknown;
      };
      renderer.lastObjectRendered = null;

      expect(() =>
        plugin.dispatchPointerEvent("down", { x: 10, y: 10 }, 0),
      ).toThrow(/needs a rendered frame/);
      expect(dispatched).toEqual([]);
    });
  });

  describe("createTexture", () => {
    async function installedPlugin(): Promise<RendererPlugin> {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      return plugin;
    }

    function generateCalls(plugin: RendererPlugin): { frame?: unknown }[] {
      const generate = (
        plugin.application.renderer as unknown as {
          generateTexture: { mock: { calls: [{ frame?: unknown }][] } };
        }
      ).generateTexture;
      return generate.mock.calls.map(([options]) => options);
    }

    it("bakes the region a size names, starting at the origin", async () => {
      const plugin = await installedPlugin();

      plugin.createTexture(() => {}, { width: 128, height: 32 });

      const [options] = generateCalls(plugin);
      expect(options?.frame).toMatchObject({
        x: 0,
        y: 0,
        width: 128,
        height: 32,
      });
    });

    it("passes no frame without a size, so pixi bakes the drawn bounds", async () => {
      const plugin = await installedPlugin();

      plugin.createTexture(() => {});

      const [options] = generateCalls(plugin);
      expect(options).not.toHaveProperty("frame");
    });

    it("throws naming the offending dimension", async () => {
      const plugin = await installedPlugin();

      expect(() =>
        plugin.createTexture(() => {}, { width: 0, height: 32 }),
      ).toThrow("RendererPlugin.createTexture: width must be finite and > 0");
      expect(() =>
        plugin.createTexture(() => {}, { width: 128, height: NaN }),
      ).toThrow("RendererPlugin.createTexture: height must be finite and > 0");
      expect(generateCalls(plugin)).toEqual([]);
    });
  });
});
