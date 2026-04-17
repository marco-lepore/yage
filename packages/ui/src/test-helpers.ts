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
} from "@yagejs/core";
import type { EngineEvents } from "@yagejs/core";
import {
  CameraKey,
  RendererKey,
  StageKey,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
  WorldRootKey,
} from "@yagejs/renderer";
import { Camera, RenderLayerManager } from "@yagejs/renderer";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "@yagejs/renderer";

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

// ---- Mock SceneRenderTree provider ----

class MockSceneRenderTreeProvider implements SceneRenderTreeProvider {
  private entries = new Map<Scene, { manager: RenderLayerManager; tree: SceneRenderTree }>();

  constructor(
    private readonly worldRoot: MockContainer,
    private readonly screenRoot: MockContainer,
  ) {}

  createForScene(scene: Scene): SceneRenderTree {
    const manager = new RenderLayerManager(
      this.worldRoot as never,
      this.screenRoot as never,
    );
    const tree: SceneRenderTree = {
      get: (name) => manager.get(name),
      tryGet: (name) => manager.tryGet(name),
      getAll: () => manager.getAll(),
      get defaultLayer() {
        return manager.defaultLayer;
      },
      ensureLayer: (def) =>
        manager.tryGet(def.name) ?? manager.createFromDef(def),
    };
    this.entries.set(scene, { manager, tree });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    entry.manager.destroy();
    this.entries.delete(scene);
  }
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
  const worldRoot = new MockContainer();
  const screenRoot = new MockContainer();
  const camera = new Camera(800, 600);

  ctx.register(RendererKey, renderer as never);
  ctx.register(StageKey, worldRoot as never);
  ctx.register(WorldRootKey, worldRoot as never);
  ctx.register(CameraKey, camera);

  const provider = new MockSceneRenderTreeProvider(worldRoot, screenRoot);
  ctx.register(SceneRenderTreeProviderKey, provider);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);
  const tree = provider.createForScene(scene);
  scene._registerScoped(SceneRenderTreeKey, tree);

  // `uiContainer` is the screen-root container the UI auto-provisions into.
  return {
    context: ctx,
    scene,
    queryCache,
    uiContainer: screenRoot,
    renderer,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
