import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  class MockContainer {
    children: MockContainer[] = [];
    position = { x: 0, y: 0, set: vi.fn(function(this: { x: number; y: number }, x: number, y: number) { this.x = x; this.y = y; }) };
    scale = { x: 1, y: 1, set: vi.fn(function(this: { x: number; y: number }, x: number, y: number) { this.x = x; this.y = y; }) };
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
    canvas: unknown = { tagName: "CANVAS" };
    renderer = {
      width: 800,
      height: 600,
      resize(this: { width: number; height: number }, w: number, h: number) {
        this.width = w;
        this.height = h;
      },
    };
    initialized = false;
    destroyCalled = false;

    async init(): Promise<void> {
      this.initialized = true;
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
  };
});

import {
  EngineContext,
  GameLoop,
  GameLoopKey,
  ProcessSystem,
  ProcessSystemKey,
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
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
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
      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
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

      expect((container as unknown as { appendChild: ReturnType<typeof vi.fn> }).appendChild).toHaveBeenCalledWith(plugin.canvas);
    });

    it("initializes PixiJS Application", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
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

      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
      plugin.onDestroy?.();
      expect(app.destroyCalled).toBe(true);
    });

    it("removes ticker callback before destroying app", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
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
      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
      const stage = app.stage;
      expect(stage.scale.x).toBe(2);
      expect(stage.scale.y).toBe(2);
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
      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
      const stage = app.stage;
      expect(stage.scale.x).toBe(2);
      expect(stage.scale.y).toBe(2);
      // offsetX = (1000 - 400*2) / 2 = 100; position is in screen space
      expect(stage.position.x).toBe(100);
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
      const app = plugin.application as unknown as InstanceType<typeof mocks.MockApplication>;
      const stage = app.stage;
      expect(stage.scale.x).toBe(2);
      expect(stage.scale.y).toBe(2);
      // offsetY = (800 - 300*2) / 2 = 100; position is in screen space
      expect(stage.position.y).toBe(100);
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

  describe("scene render trees", () => {
    it("exposes the per-scene render tree provider", async () => {
      const { context } = createInstallContext();
      const plugin = new RendererPlugin(defaultConfig);
      await plugin.install(context);

      expect(plugin.sceneRenderTrees).toBeDefined();
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

  describe("orientation", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("emits screen:orientation when the screen orientation changes", async () => {
      let changeHandler: (() => void) | null = null;
      const orientationMock = {
        type: "landscape-primary",
        addEventListener: vi.fn(
          (event: string, fn: () => void) => {
            if (event === "change") changeHandler = fn;
          },
        ),
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
      const windowAddEventListener = vi.fn(
        (event: string, fn: () => void) => {
          if (event === "orientationchange") changeHandler = fn;
        },
      );
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
});
