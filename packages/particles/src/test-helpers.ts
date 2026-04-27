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
  RenderLayerManager,
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "@yagejs/renderer";
import type { SceneRenderTree } from "@yagejs/renderer";

// Minimal mock container matching the renderer test-helpers pattern.
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
  eventMode = "passive";

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

class _TestScene extends Scene {
  readonly name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }
}

export interface ParticlesTestContext {
  context: EngineContext;
  scene: Scene;
  queryCache: QueryCache;
  gameLoop: GameLoop;
  scheduler: SystemScheduler;
  root: MockContainer;
  layerManager: RenderLayerManager;
}

export function createParticlesTestContext(): ParticlesTestContext {
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

  const root = new MockContainer();
  const layerManager = new RenderLayerManager(root as never);
  const tree: SceneRenderTree = {
    root: root as never,
    get: (name) => layerManager.get(name),
    tryGet: (name) => layerManager.tryGet(name),
    getAll: () => layerManager.getAll(),
    get defaultLayer() {
      return layerManager.defaultLayer;
    },
    ensureLayer: (def, opts) =>
      layerManager.tryGet(def.name) ?? layerManager.createFromDef(def, opts),
    fx: {
      addEffect: () => {
        throw new Error(
          "Particles test-helpers tree does not support fx.addEffect.",
        );
      },
      findEffect: () => null,
    } as never,
    setMask: () => {
      throw new Error("Particles test-helpers tree does not support setMask.");
    },
    clearMask: () => undefined,
  };

  const scene = new _TestScene("test-scene");
  ctx.register(SceneRenderTreeProviderKey, {
    createForScene: () => tree,
    destroyForScene: () => undefined,
    getTree: () => tree,
    allTrees: function* () {
      yield [scene, tree];
    },
  });
  scene._setContext(ctx);
  scene._registerScoped(SceneRenderTreeKey, tree);

  return {
    context: ctx,
    scene,
    queryCache,
    gameLoop,
    scheduler,
    root,
    layerManager,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
