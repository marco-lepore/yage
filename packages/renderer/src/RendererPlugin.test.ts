import { describe, it, expect, vi, beforeEach } from "vitest";

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
    renderer = { width: 800, height: 600 };
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

vi.mock("pixi.js", () => ({
  Application: mocks.MockApplication,
  Container: mocks.MockContainer,
}));

import {
  EngineContext,
  GameLoop,
  GameLoopKey,
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
      const container = { appendChild: vi.fn() } as unknown as HTMLElement;
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
      // offsetX = (1000 - 400*2) / 2 = 100
      // position.x = offsetX / scale = 100 / 2 = 50
      expect(stage.position.x).toBe(50);
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
      // offsetY = (800 - 300*2) / 2 = 100
      // position.y = offsetY / scale = 100 / 2 = 50
      expect(stage.position.y).toBe(50);
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
});
