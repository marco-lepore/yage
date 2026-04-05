import {
  EngineContext,
  QueryCache,
  QueryCacheKey,
  EventBus,
  EventBusKey,
  ErrorBoundary,
  ErrorBoundaryKey,
  Logger,
  LogLevel,
  GameLoop,
  GameLoopKey,
  SystemScheduler,
  SystemSchedulerKey,
  Scene,
  Entity,
  _resetEntityIdCounter,
} from "@yage/core";
import type { EngineEvents } from "@yage/core";
import { CameraKey, RenderLayerManagerKey, RendererKey, StageKey } from "@yage/renderer";
import { Camera } from "@yage/renderer";
import { RenderLayerManager } from "@yage/renderer";
import { UIContainerKey, UILayerManagerKey } from "./types.js";

// ---- Minimal mock container for test context ----

export class MockContainer {
  children: MockContainer[] = [];
  position = { x: 0, y: 0, set(ax: number, ay: number) { this.x = ax; this.y = ay; } };
  scale = { x: 1, y: 1 };
  rotation = 0;
  visible = true;
  alpha = 1;
  parent: MockContainer | null = null;
  sortableChildren = false;
  zIndex = 0;
  label = "";
  destroyed = false;
  eventMode = "auto";
  cursor = "default";

  addChild(child: MockContainer): MockContainer {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  addChildAt(child: MockContainer, _index: number): MockContainer {
    this.children.splice(_index, 0, child);
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

  removeFromParent(): void {
    this.parent?.removeChild(this);
  }

  sortChildren(): void {
    this.children.sort((a, b) => a.zIndex - b.zIndex);
  }

  destroy(): void {
    this.destroyed = true;
    this.removeFromParent();
  }
}

// ---- Mock RendererPlugin ----

export class MockRendererPlugin {
  application = {
    stage: new MockContainer(),
  };
  virtualSize = { width: 800, height: 600 };
}

// ---- Test Context ----

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

export interface UITestContext {
  context: EngineContext;
  scene: Scene;
  queryCache: QueryCache;
  uiContainer: MockContainer;
  renderer: MockRendererPlugin;
}

export function createUITestContext(): UITestContext {
  _resetEntityIdCounter();

  const ctx = new EngineContext();
  const queryCache = new QueryCache();
  const bus = new EventBus<EngineEvents>();
  const logger = new Logger({ level: LogLevel.Debug });
  const boundary = new ErrorBoundary(logger);
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(QueryCacheKey, queryCache);
  ctx.register(EventBusKey, bus);
  ctx.register(ErrorBoundaryKey, boundary);
  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);

  // Renderer mocks
  const renderer = new MockRendererPlugin();
  const stage = new MockContainer();
  const camera = new Camera(800, 600);
  const layerManager = new RenderLayerManager(stage as never);

  ctx.register(RendererKey, renderer as never);
  ctx.register(StageKey, stage as never);
  ctx.register(CameraKey, camera);
  ctx.register(RenderLayerManagerKey, layerManager);

  // UI layer manager + container
  const uiContainer = new MockContainer();
  uiContainer.label = "ui";
  const uiLayerManager = new RenderLayerManager(uiContainer as never);
  ctx.register(UILayerManagerKey, uiLayerManager);
  ctx.register(UIContainerKey, uiLayerManager.defaultLayer.container as never);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);

  return { context: ctx, scene, queryCache, uiContainer, renderer };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
