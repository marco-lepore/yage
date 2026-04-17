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
import { CameraKey, StageKey, WorldRootKey } from "./types.js";
import { Camera } from "./Camera.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "./SceneRenderTree.js";
import { SceneRenderTreeKey, SceneRenderTreeProviderKey } from "./SceneRenderTree.js";

// ---- Minimal mock container for test context ----

export class MockContainer {
  children: MockContainer[] = [];
  position = { x: 0, y: 0 };
  scale = { x: 1, y: 1 };
  rotation = 0;
  visible = true;
  alpha = 1;
  parent: MockContainer | null = null;
  sortableChildren = false;
  zIndex = 0;
  label = "";
  destroyed = false;

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

// ---- Scene subclass for tests ----

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

export interface RendererTestContext {
  context: EngineContext;
  scene: Scene;
  queryCache: QueryCache;
  gameLoop: GameLoop;
  scheduler: SystemScheduler;
  worldRoot: MockContainer;
  screenRoot: MockContainer;
  stage: MockContainer;
  camera: Camera;
  layerManager: RenderLayerManager;
  tree: SceneRenderTree;
  provider: SceneRenderTreeProvider;
}

/**
 * Minimal provider that builds a per-scene `RenderLayerManager` around the
 * given root containers. Sufficient for renderer unit tests that don't
 * exercise multi-scene topology.
 */
class MockSceneRenderTreeProvider implements SceneRenderTreeProvider {
  private trees = new Map<Scene, { manager: RenderLayerManager; tree: SceneRenderTree }>();

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
    this.trees.set(scene, { manager, tree });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.trees.get(scene);
    if (!entry) return;
    entry.manager.destroy();
    this.trees.delete(scene);
  }

  managerFor(scene: Scene): RenderLayerManager | undefined {
    return this.trees.get(scene)?.manager;
  }
}

export function createRendererTestContext(
  options?: {
    viewportWidth?: number;
    viewportHeight?: number;
  },
): RendererTestContext {
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

  const vw = options?.viewportWidth ?? 800;
  const vh = options?.viewportHeight ?? 600;
  const worldRoot = new MockContainer();
  const screenRoot = new MockContainer();
  const camera = new Camera(vw, vh);

  const provider = new MockSceneRenderTreeProvider(worldRoot, screenRoot);
  ctx.register(StageKey, worldRoot as never);
  ctx.register(WorldRootKey, worldRoot as never);
  ctx.register(CameraKey, camera);
  ctx.register(SceneRenderTreeProviderKey, provider);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);

  // Materialize the tree as if a beforeEnter hook ran.
  const tree = provider.createForScene(scene);
  scene._registerScoped(SceneRenderTreeKey, tree);
  const layerManager = provider.managerFor(scene)!;

  return {
    context: ctx,
    scene,
    queryCache,
    gameLoop,
    scheduler,
    worldRoot,
    screenRoot,
    stage: worldRoot,
    camera,
    layerManager,
    tree,
    provider,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
