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
    _filterEffect = { filters: null as unknown };
    get filters(): unknown {
      return this._filterEffect.filters;
    }
    set filters(value: unknown) {
      this._filterEffect.filters = value;
    }

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
      name: "webgl",
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
    render = vi.fn();
    initialized = false;
    destroyCalled = false;

    async init(opts: Record<string, unknown> = {}): Promise<void> {
      this.initialized = true;
      this.initOptions = opts;
    }

    destroy(): void {
      this.ticker.remove(this.render);
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
    extensions: { add: vi.fn() },
    UPDATE_PRIORITY: { LOW: -25 },
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
  InspectorKey,
  Logger,
  LogLevel,
  SceneHookRegistry,
  SceneHookRegistryKey,
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
} from "@yagejs/core";
import type { EngineEvents, HostSupport, SceneTransition } from "@yagejs/core";
import { RendererPlugin } from "./RendererPlugin.js";
import { HostDisplayKey } from "./HostDisplay.js";
import type { HostDisplay } from "./HostDisplay.js";
import { TestHostDisplay } from "./TestHostDisplay.js";
import { RenderFacetContributor } from "./RenderFacetContributor.js";
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
      expect(app.ticker.callbacks).toHaveLength(2);
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

  describe("onStart", () => {
    it("registers the render facet with an Inspector installed after the renderer, and removes it on destroy", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      // Registered after install, the order a game gets when DebugPlugin
      // (which installs the Inspector) comes after the renderer.
      const unregister = vi.fn();
      const registerFacetContributor = vi.fn(() => unregister);
      context.register(InspectorKey, { registerFacetContributor } as never);

      plugin.onStart();
      expect(registerFacetContributor).toHaveBeenCalledWith(
        expect.any(RenderFacetContributor),
      );
      plugin.onDestroy();
      expect(unregister).toHaveBeenCalledOnce();
    });

    it("starts without an Inspector", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      expect(() => plugin.onStart()).not.toThrow();
      plugin.onDestroy();
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
      expect(app.ticker.callbacks).toHaveLength(2);

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

    it("reports the graphics API Pixi picked", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(plugin.backend).toBe("webgl");
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

  describe("display", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /** The eight members, with the message each reports outside the run. */
    const DISPLAY_MEMBERS = [
      "isFullscreen",
      "fullscreenSupport",
      "orientation",
      "orientationLockSupport",
      "requestFullscreen",
      "exitFullscreen",
      "lockOrientation",
      "unlockOrientation",
    ] as const;

    function unavailableMessage(member: string): string {
      return (
        `RendererPlugin.${member}: the display is only available between ` +
        "engine.start() and engine.destroy()."
      );
    }

    /** Read every display member, collecting the failure each one reports. */
    async function readAll(plugin: RendererPlugin): Promise<string[]> {
      const reads: Record<(typeof DISPLAY_MEMBERS)[number], () => unknown> = {
        isFullscreen: () => plugin.isFullscreen,
        fullscreenSupport: () => plugin.fullscreenSupport,
        orientation: () => plugin.orientation,
        orientationLockSupport: () => plugin.orientationLockSupport,
        requestFullscreen: () => plugin.requestFullscreen(),
        exitFullscreen: () => plugin.exitFullscreen(),
        lockOrientation: () => plugin.lockOrientation("portrait"),
        unlockOrientation: () => plugin.unlockOrientation(),
      };
      const failures: string[] = [];
      for (const member of DISPLAY_MEMBERS) {
        try {
          await reads[member]();
          failures.push(`${member}: no failure`);
        } catch (error) {
          failures.push((error as Error).message);
        }
      }
      return failures;
    }

    interface HarnessOptions {
      readonly display?: HostDisplay;
      readonly config?: Partial<RendererConfig>;
    }

    interface Harness {
      readonly plugin: RendererPlugin;
      readonly boundary: ErrorBoundary;
      readonly fullscreenEvents: boolean[];
      readonly orientationEvents: OrientationType[];
      /** Both events in the order they were emitted, by name. */
      readonly order: string[];
    }

    /** Install and start a renderer, recording both display events. */
    async function startRenderer(
      options: HarnessOptions = {},
    ): Promise<Harness> {
      const { context } = createInstallContext();
      const bus = context.resolve(EventBusKey);
      const boundary = context.resolve(ErrorBoundaryKey);
      bus._setErrorBoundary(boundary);
      if (options.display) context.register(HostDisplayKey, options.display);
      const fullscreenEvents: boolean[] = [];
      const orientationEvents: OrientationType[] = [];
      const order: string[] = [];
      bus.on("screen:fullscreen", ({ active }) => {
        fullscreenEvents.push(active);
        order.push("fullscreen");
      });
      bus.on("screen:orientation", ({ type }) => {
        orientationEvents.push(type);
        order.push("orientation");
      });
      const plugin = new RendererPlugin({
        ...defaultConfig,
        ...options.config,
      });
      await plugin.install(context);
      plugin.onStart();
      return { plugin, boundary, fullscreenEvents, orientationEvents, order };
    }

    /** The state a {@link manualDisplay} reports, before validation. */
    interface ManualState {
      active: unknown;
      support: unknown;
      current: unknown;
      lockSupport: unknown;
    }

    /**
     * A display whose fullscreen transitions settle when the test says so, so
     * a test can observe what the renderer does while one is in flight and in
     * which order it publishes the result.
     */
    function manualDisplay(initial: Partial<ManualState> = {}): {
      display: HostDisplay;
      state: ManualState;
      calls: string[];
      rejectWith: { error: Error | null };
      settle: () => void;
      notify: () => void;
      notifyDetached: () => void;
      stops: () => number;
    } {
      const state: ManualState = {
        active: false,
        support: "supported",
        current: "landscape-primary",
        lockSupport: "supported",
        ...initial,
      };
      const calls: string[] = [];
      const rejectWith: { error: Error | null } = { error: null };
      let pending: (() => void) | null = null;
      let changed: (() => void) | null = null;
      // Kept past the stop function, so a test can report a change the way a
      // host whose own listener outlives the engine does.
      let detached: (() => void) | null = null;
      let stops = 0;
      const transition = (to: boolean): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          pending = () => {
            pending = null;
            if (rejectWith.error) {
              reject(rejectWith.error);
              return;
            }
            state.active = to;
            resolve();
          };
        });
      const display: HostDisplay = {
        fullscreen: {
          get support(): HostSupport {
            return state.support as HostSupport;
          },
          get active(): boolean {
            return state.active as boolean;
          },
          request(): Promise<void> {
            calls.push("request");
            return transition(true);
          },
          exit(): Promise<void> {
            calls.push("exit");
            return transition(false);
          },
        },
        orientation: {
          get current(): OrientationType | null {
            return state.current as OrientationType | null;
          },
          get lockSupport(): HostSupport {
            return state.lockSupport as HostSupport;
          },
          lock(lock): Promise<void> {
            calls.push(`lock:${lock}`);
            state.current = lock === "portrait" ? "portrait-primary" : lock;
            return Promise.resolve();
          },
          unlock(): Promise<void> {
            calls.push("unlock");
            return Promise.resolve();
          },
        },
        watch(fn): () => void {
          changed = fn;
          detached = fn;
          return () => {
            stops += 1;
            changed = null;
          };
        },
      };
      return {
        display,
        state,
        calls,
        rejectWith,
        settle: () => pending?.(),
        notify: () => changed?.(),
        notifyDetached: () => detached?.(),
        stops: () => stops,
      };
    }

    it("reports every member as unavailable before the engine starts", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(await readAll(plugin)).toEqual(
        DISPLAY_MEMBERS.map(unavailableMessage),
      );
    });

    it("reports every member as unavailable after the engine is destroyed", async () => {
      const { plugin } = await startRenderer({
        display: new TestHostDisplay(),
      });
      plugin.onDestroy();

      expect(await readAll(plugin)).toEqual(
        DISPLAY_MEMBERS.map(unavailableMessage),
      );
    });

    it("reads a registered display and leaves the page alone", async () => {
      const documentAddEventListener = vi.fn();
      const orientationAddEventListener = vi.fn();
      vi.stubGlobal("document", {
        fullscreenElement: null,
        fullscreenEnabled: true,
        addEventListener: documentAddEventListener,
        removeEventListener: vi.fn(),
      });
      vi.stubGlobal("window", {
        screen: {
          orientation: {
            type: "portrait-primary",
            addEventListener: orientationAddEventListener,
            removeEventListener: vi.fn(),
          },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const display = new TestHostDisplay({ orientation: "landscape-primary" });

      const { plugin } = await startRenderer({ display });

      expect(plugin.fullscreenSupport).toBe("supported");
      expect(plugin.orientation).toBe("landscape-primary");
      const attached = documentAddEventListener.mock.calls.map(
        (args: unknown[]) => args[0],
      );
      expect(attached).not.toContain("fullscreenchange");
      expect(attached).not.toContain("webkitfullscreenchange");
      expect(orientationAddEventListener).not.toHaveBeenCalled();
    });

    it("asks the configured container for fullscreen with no display registered", async () => {
      const requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const container = {
        requestFullscreen,
        appendChild: vi.fn(),
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      } as unknown as HTMLElement;
      vi.stubGlobal("document", {
        fullscreenElement: null,
        fullscreenEnabled: true,
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      const { plugin } = await startRenderer({ config: { container } });
      await plugin.requestFullscreen();

      expect(requestFullscreen).toHaveBeenCalledOnce();
    });

    it("asks the canvas for fullscreen when there is no container", async () => {
      vi.stubGlobal("document", {
        fullscreenElement: null,
        fullscreenEnabled: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const { plugin } = await startRenderer();
      const canvas = plugin.canvas as unknown as {
        requestFullscreen: () => Promise<void>;
      };
      canvas.requestFullscreen = vi.fn().mockResolvedValue(undefined);

      await plugin.requestFullscreen();

      expect(canvas.requestFullscreen).toHaveBeenCalledOnce();
    });

    it("takes the part a display leaves out from the page", async () => {
      vi.stubGlobal("window", {
        screen: { orientation: { type: "portrait-secondary" } },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });
      const fullscreenOnly: HostDisplay = {
        fullscreen: {
          support: "unsupported",
          active: false,
          request: () => Promise.resolve(),
          exit: () => Promise.resolve(),
        },
        watch: () => () => {},
      };

      const { plugin } = await startRenderer({ display: fullscreenOnly });

      expect(plugin.fullscreenSupport).toBe("unsupported");
      expect(plugin.orientation).toBe("portrait-secondary");
      expect(plugin.orientationLockSupport).toBe("unsupported");
    });

    it("takes fullscreen from the page for a display that only reports orientation", async () => {
      const orientationOnly: HostDisplay = {
        orientation: {
          current: "portrait-primary",
          lockSupport: "supported",
          lock: () => Promise.resolve(),
          unlock: () => Promise.resolve(),
        },
        watch: () => () => {},
      };

      const { plugin } = await startRenderer({ display: orientationOnly });

      // No document in this environment, so the page reports no fullscreen.
      expect(plugin.fullscreenSupport).toBe("unsupported");
      expect(plugin.orientation).toBe("portrait-primary");
      expect(plugin.orientationLockSupport).toBe("supported");
    });

    it("emits one event per state that moved", async () => {
      const display = new TestHostDisplay({ orientation: "portrait-primary" });
      const { plugin, fullscreenEvents, orientationEvents, order } =
        await startRenderer({ display });

      // The state at start is the baseline, not a change.
      expect(plugin.isFullscreen).toBe(false);
      expect(fullscreenEvents).toEqual([]);
      expect(orientationEvents).toEqual([]);

      display.set({ fullscreen: false });
      expect(fullscreenEvents).toEqual([]);
      expect(orientationEvents).toEqual([]);

      display.set({ orientation: "landscape-primary" });
      expect(orientationEvents).toEqual(["landscape-primary"]);

      display.set({ orientation: null });
      expect(orientationEvents).toEqual(["landscape-primary"]);

      order.length = 0;
      display.set({ fullscreen: true, orientation: "portrait-secondary" });
      expect(fullscreenEvents).toEqual([true]);
      expect(orientationEvents).toEqual([
        "landscape-primary",
        "portrait-secondary",
      ]);
      // One change of both states publishes fullscreen first.
      expect(order).toEqual(["fullscreen", "orientation"]);
    });

    it("resolves a request that changes nothing without asking the host", async () => {
      const { display, calls } = manualDisplay({ active: true });
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      await expect(plugin.requestFullscreen()).resolves.toBeUndefined();

      expect(calls).toEqual([]);
      expect(fullscreenEvents).toEqual([]);
    });

    it("rejects a request on a host that cannot change to fullscreen", async () => {
      const { display, calls } = manualDisplay({ support: "unsupported" });
      const { plugin } = await startRenderer({ display });

      await expect(plugin.requestFullscreen()).rejects.toThrow(
        "RendererPlugin.requestFullscreen: this host cannot change to " +
          'fullscreen (fullscreenSupport is "unsupported").',
      );
      expect(calls).toEqual([]);
    });

    it("asks a host that cannot tell whether it supports fullscreen", async () => {
      const { display, calls, settle } = manualDisplay({ support: "unknown" });
      const { plugin } = await startRenderer({ display });

      const pending = plugin.requestFullscreen();
      settle();
      await pending;

      expect(calls).toEqual(["request"]);
      expect(plugin.isFullscreen).toBe(true);
    });

    it("emits the change before the request resolves", async () => {
      const { display, settle } = manualDisplay();
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      const pending = plugin.requestFullscreen();
      expect(fullscreenEvents).toEqual([]);
      settle();
      await pending;

      expect(fullscreenEvents).toEqual([true]);
    });

    it("passes a host's refusal on and emits nothing", async () => {
      const refusal = new TypeError("Permissions check failed");
      const { display, rejectWith, settle } = manualDisplay();
      rejectWith.error = refusal;
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      const pending = plugin.requestFullscreen();
      settle();

      await expect(pending).rejects.toBe(refusal);
      expect(fullscreenEvents).toEqual([]);
    });

    it("shares one request between callers", async () => {
      const { display, calls, settle } = manualDisplay();
      const { plugin } = await startRenderer({ display });

      const first = plugin.requestFullscreen();
      const second = plugin.requestFullscreen();
      expect(second).toBe(first);
      settle();
      await Promise.all([first, second]);

      expect(calls).toEqual(["request"]);
    });

    it("shares one exit between callers", async () => {
      const { display, calls, settle } = manualDisplay({ active: true });
      const { plugin } = await startRenderer({ display });

      const first = plugin.exitFullscreen();
      const second = plugin.exitFullscreen();
      expect(second).toBe(first);
      settle();
      await Promise.all([first, second]);

      expect(calls).toEqual(["exit"]);
    });

    it("runs an exit after the request it interrupts", async () => {
      const { display, calls, settle } = manualDisplay();
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      const request = plugin.requestFullscreen();
      const exit = plugin.exitFullscreen();
      settle();
      await request;
      settle();
      await exit;

      expect(calls).toEqual(["request", "exit"]);
      expect(fullscreenEvents).toEqual([true, false]);
      expect(plugin.isFullscreen).toBe(false);
    });

    it("runs a request after the exit it interrupts", async () => {
      const { display, calls, settle } = manualDisplay({ active: true });
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      const exit = plugin.exitFullscreen();
      const request = plugin.requestFullscreen();
      settle();
      await exit;
      settle();
      await request;

      expect(calls).toEqual(["exit", "request"]);
      expect(fullscreenEvents).toEqual([false, true]);
      expect(plugin.isFullscreen).toBe(true);
    });

    it("resolves an exit that changes nothing without asking the host", async () => {
      const { display, calls } = manualDisplay();
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      await expect(plugin.exitFullscreen()).resolves.toBeUndefined();

      expect(calls).toEqual([]);
      expect(fullscreenEvents).toEqual([]);
    });

    it("rejects an orientation lock on a host that cannot lock", async () => {
      const { display, calls } = manualDisplay({ lockSupport: "unsupported" });
      const { plugin } = await startRenderer({ display });

      await expect(plugin.lockOrientation("landscape")).rejects.toThrow(
        "RendererPlugin.lockOrientation: this host cannot lock the screen " +
          'orientation (orientationLockSupport is "unsupported").',
      );
      expect(calls).toEqual([]);
    });

    it("resolves a lock with the orientation the host reports afterwards", async () => {
      const { display, calls } = manualDisplay();
      const { plugin, orientationEvents } = await startRenderer({ display });

      await expect(plugin.lockOrientation("portrait")).resolves.toBe(
        "portrait-primary",
      );

      expect(calls).toEqual(["lock:portrait"]);
      expect(orientationEvents).toEqual(["portrait-primary"]);
    });

    it("resolves the release on a host that cannot lock", async () => {
      const { display, calls } = manualDisplay({ lockSupport: "unsupported" });
      const { plugin } = await startRenderer({ display });

      await expect(plugin.unlockOrientation()).resolves.toBeUndefined();

      expect(calls).toEqual([]);
    });

    it("releases the lock through the host", async () => {
      const { display, calls } = manualDisplay();
      const { plugin } = await startRenderer({ display });

      await plugin.unlockOrientation();

      expect(calls).toEqual(["unlock"]);
    });

    it.each([
      [
        { active: "yes" },
        'HostFullscreen.active must be a boolean, got "yes".',
      ],
      [
        { support: "maybe" },
        "HostFullscreen.support must be one of supported, unsupported, " +
          'unknown, got "maybe".',
      ],
      [
        { current: "up" },
        "HostOrientation.current must be one of portrait-primary, " +
          "portrait-secondary, landscape-primary, landscape-secondary or " +
          'null, got "up".',
      ],
      [
        { lockSupport: 7 },
        "HostOrientation.lockSupport must be one of supported, unsupported, " +
          "unknown, got 7.",
      ],
    ])("rejects the value %o a host reports", async (broken, message) => {
      const { display, state } = manualDisplay();
      const { plugin, fullscreenEvents, orientationEvents } =
        await startRenderer({ display });
      Object.assign(state, broken);

      expect(() => {
        if ("active" in broken) return plugin.isFullscreen;
        if ("support" in broken) return plugin.fullscreenSupport;
        if ("current" in broken) return plugin.orientation;
        return plugin.orientationLockSupport;
      }).toThrow(message);
      expect(fullscreenEvents).toEqual([]);
      expect(orientationEvents).toEqual([]);
    });

    it("passes a host's refusal of an exit on and emits nothing", async () => {
      const refusal = new TypeError("Document not active");
      const { display, rejectWith, settle } = manualDisplay({ active: true });
      rejectWith.error = refusal;
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      const pending = plugin.exitFullscreen();
      settle();

      await expect(pending).rejects.toBe(refusal);
      expect(fullscreenEvents).toEqual([]);
    });

    it("rejects a request that reads a broken value from the host", async () => {
      const { display, state } = manualDisplay();
      const { plugin } = await startRenderer({ display });
      state.active = "yes";

      await expect(plugin.requestFullscreen()).rejects.toThrow(
        'HostFullscreen.active must be a boolean, got "yes".',
      );
    });

    it("rejects an exit that reads a broken value from the host", async () => {
      const { display, state } = manualDisplay();
      const { plugin } = await startRenderer({ display });
      state.active = 1;

      await expect(plugin.exitFullscreen()).rejects.toThrow(
        "HostFullscreen.active must be a boolean, got 1.",
      );
    });

    it("rejects a lock and a release that read a broken value", async () => {
      const { display, state } = manualDisplay();
      const { plugin } = await startRenderer({ display });
      state.lockSupport = null;
      const message =
        "HostOrientation.lockSupport must be one of supported, unsupported, " +
        "unknown, got null.";

      await expect(plugin.lockOrientation("portrait")).rejects.toThrow(message);
      await expect(plugin.unlockOrientation()).rejects.toThrow(message);
    });

    it("stops watching the display once, on destroy", async () => {
      const { display, state, stops, notifyDetached } = manualDisplay();
      const { plugin, fullscreenEvents } = await startRenderer({ display });

      plugin.onDestroy();
      expect(stops()).toBe(1);

      state.active = true;
      expect(() => notifyDetached()).not.toThrow();
      expect(fullscreenEvents).toEqual([]);
    });

    it("records a throwing event handler and reports it to the caller", async () => {
      const failure = new Error("handler failed");
      const { display, settle, notifyDetached } = manualDisplay();
      const { context } = createInstallContext();
      const bus = context.resolve(EventBusKey);
      const boundary = context.resolve(ErrorBoundaryKey);
      bus._setErrorBoundary(boundary);
      context.register(HostDisplayKey, display);
      bus.on("screen:fullscreen", () => {
        throw failure;
      });
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);
      plugin.onStart();

      const pending = plugin.requestFullscreen();
      settle();
      await expect(pending).rejects.toBe(failure);

      expect(boundary.getCallbackErrors()).toHaveLength(1);
      expect(boundary.getCallbackErrors()[0]?.event).toBe("screen:fullscreen");
      // The state was stored before the handler ran, so the same state is not
      // a change: the handler, which throws on every emit, is not called
      // again.
      expect(plugin.isFullscreen).toBe(true);
      expect(() => notifyDetached()).not.toThrow();
      expect(boundary.getCallbackErrors()).toHaveLength(1);
    });

    it("follows the display's pixel ratio unless the game fixed the resolution", async () => {
      const matchMedia = vi.fn(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      vi.stubGlobal("window", {
        devicePixelRatio: 2,
        matchMedia,
        screen: {},
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      });

      await startRenderer();
      expect(matchMedia).toHaveBeenCalledWith("(resolution: 2dppx)");

      matchMedia.mockClear();
      await startRenderer({ config: { resolution: 1 } });
      expect(matchMedia).not.toHaveBeenCalled();
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

    it.each([
      { policies: ["inherit", "inherit", false], expected: false },
      { policies: ["inherit", true, false], expected: true },
      { policies: ["inherit", false, true], expected: false },
      { policies: [false, true, true], expected: false },
      { policies: [true, false, true], expected: true },
      { policies: ["inherit", "inherit", "inherit"], expected: true },
    ] as const)(
      "resolves the nearest explicit setting: $policies",
      async ({ policies, expected }) => {
        const plugin = await installed();
        const nodes = chain(3);
        policies.forEach((policy, index) =>
          markPointerConsumeContainer(nodes[index]!, policy),
        );
        attachBoundary(plugin, nodes[0]!);
        expect(plugin.hitTestUIPath(10, 20)).toEqual({
          path: nodes,
          consumed: expected,
        });
      },
    );

    it("reads ancestor changes and clearing an override on the next hit", async () => {
      const plugin = await installed();
      const nodes = chain(3);
      markPointerConsumeContainer(nodes[0]!, "inherit");
      markPointerConsumeContainer(nodes[1]!, true);
      markPointerConsumeContainer(nodes[2]!, false);
      attachBoundary(plugin, nodes[0]!);
      expect(plugin.hitTestUI(10, 20)).toBe(true);
      unmarkPointerConsumeContainer(nodes[1]!);
      expect(plugin.hitTestUI(10, 20)).toBe(false);
      markPointerConsumeContainer(nodes[2]!, true);
      expect(plugin.hitTestUI(10, 20)).toBe(true);
    });

    it("resolves an inheriting element against its current parent after reparenting", async () => {
      const plugin = await installed();
      const nodes = chain(2);
      const otherParent = {};
      markPointerConsumeContainer(nodes[0]!, "inherit");
      markPointerConsumeContainer(nodes[1]!, false);
      markPointerConsumeContainer(otherParent, true);
      attachBoundary(plugin, nodes[0]!);
      expect(plugin.hitTestUI(10, 20)).toBe(false);
      nodes[0]!.parent = otherParent;
      expect(plugin.hitTestUI(10, 20)).toBe(true);
      nodes[0]!.parent = null;
      expect(plugin.hitTestUI(10, 20)).toBe(true);
      unmarkPointerConsumeContainer(nodes[0]!);
      expect(plugin.hitTestUI(10, 20)).toBe(false);
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
