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
  RendererKey,
  RenderLayerManager,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "@yagejs/renderer";

// ---- Minimal mock container for test context ----

export class MockContainer {
  children: MockContainer[] = [];
  position = {
    x: 0,
    y: 0,
    set(this: { x: number; y: number }, ax: number, ay: number) {
      this.x = ax;
      this.y = ay;
    },
  };
  scale = { x: 1, y: 1 };
  rotation = 0;
  visible = true;
  alpha = 1;
  parent: MockContainer | null = null;
  sortableChildren = false;
  zIndex = 0;
  label = "";
  destroyed = false;
  eventMode = "passive";
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
  private entries = new Map<
    Scene,
    { manager: RenderLayerManager; tree: SceneRenderTree; root: MockContainer }
  >();

  constructor(private readonly stage: MockContainer) {}

  createForScene(scene: Scene): SceneRenderTree {
    const root = new MockContainer();
    root.label = `scene:${scene.name}`;
    this.stage.addChild(root);

    const manager = new RenderLayerManager(root as never);
    const tree: SceneRenderTree = {
      root: root as never,
      get: (name) => manager.get(name),
      tryGet: (name) => manager.tryGet(name),
      getAll: () => manager.getAll(),
      get defaultLayer() {
        return manager.defaultLayer;
      },
      ensureLayer: (def, opts) =>
        manager.tryGet(def.name) ?? manager.createFromDef(def, opts),
      fx: {
        addEffect: () => {
          throw new Error("UI test-helpers tree does not support fx.addEffect.");
        },
        findEffect: () => null,
      } as never,
      setMask: () => {
        throw new Error("UI test-helpers tree does not support setMask.");
      },
      clearMask: () => undefined,
    };
    this.entries.set(scene, { manager, tree, root });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    entry.manager.destroy();
    entry.root.removeFromParent();
    this.entries.delete(scene);
  }

  getTree(scene: Scene): SceneRenderTree | undefined {
    return this.entries.get(scene)?.tree;
  }

  *allTrees(): IterableIterator<[Scene, SceneRenderTree]> {
    for (const [scene, entry] of this.entries) {
      yield [scene, entry.tree];
    }
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
  renderer: MockRendererPlugin;
  tree: SceneRenderTree;
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

  const renderer = new MockRendererPlugin();
  ctx.register(RendererKey, renderer as never);

  const stage = renderer.application.stage;
  const provider = new MockSceneRenderTreeProvider(stage);
  ctx.register(SceneRenderTreeProviderKey, provider);

  const scene = new _TestScene("test-scene");
  scene._setContext(ctx);
  const tree = provider.createForScene(scene);
  scene._registerScoped(SceneRenderTreeKey, tree);

  return {
    context: ctx,
    scene,
    queryCache,
    renderer,
    tree,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
