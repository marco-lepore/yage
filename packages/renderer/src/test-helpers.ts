import {
  EngineContext,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoop,
  GameLoopKey,
  SystemScheduler,
  SystemSchedulerKey,
  Scene,
  Entity,
  createMockScene,
} from "@yagejs/core";
import type { QueryCache } from "@yagejs/core";
import { RendererKey } from "./types.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
} from "./SceneRenderTree.js";
import {
  SceneRenderTreeKey,
  SceneRenderTreeProviderKey,
} from "./SceneRenderTree.js";

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
  scale = {
    x: 1,
    y: 1,
    set(this: { x: number; y: number }, ax: number, ay?: number) {
      this.x = ax;
      this.y = ay ?? ax;
    },
  };
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

export interface RendererTestContext {
  context: EngineContext;
  scene: Scene;
  queryCache: QueryCache;
  gameLoop: GameLoop;
  scheduler: SystemScheduler;
  root: MockContainer;
  layerManager: RenderLayerManager;
  tree: SceneRenderTree;
  provider: MockSceneRenderTreeProvider;
}

/**
 * Minimal provider that builds a per-scene `RenderLayerManager` around a
 * single root container per scene. Matches the one-container-per-scene
 * topology used in production.
 */
export class MockSceneRenderTreeProvider implements SceneRenderTreeProvider {
  private trees = new Map<
    Scene,
    { manager: RenderLayerManager; tree: SceneRenderTree; root: MockContainer }
  >();

  constructor(private readonly stage: MockContainer) {}

  createForScene(scene: Scene): SceneRenderTree {
    if (this.trees.has(scene)) {
      throw new Error(
        `Scene "${scene.name}" already has a render tree attached.`,
      );
    }

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
    };
    this.trees.set(scene, { manager, tree, root });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.trees.get(scene);
    if (!entry) return;
    entry.root.destroy();
    entry.manager.destroy();
    this.trees.delete(scene);
  }

  getTree(scene: Scene): SceneRenderTree | undefined {
    return this.trees.get(scene)?.tree;
  }

  *allTrees(): IterableIterator<[Scene, SceneRenderTree]> {
    for (const [scene, entry] of this.trees) {
      yield [scene, entry.tree];
    }
  }

  bringSceneToFront(scene: Scene): void {
    const entry = this.trees.get(scene);
    if (!entry) return;
    const parent = entry.root.parent;
    if (parent) {
      parent.removeChild(entry.root);
      parent.addChild(entry.root);
    }
  }

  managerFor(scene: Scene): RenderLayerManager | undefined {
    return this.trees.get(scene)?.manager;
  }

  rootFor(scene: Scene): MockContainer | undefined {
    return this.trees.get(scene)?.root;
  }
}

export function createRendererTestContext(options?: {
  viewportWidth?: number;
  viewportHeight?: number;
}): RendererTestContext {
  const { scene, context: ctx } = createMockScene("test-scene");
  const queryCache = ctx.resolve(QueryCacheKey);
  const boundary = ctx.resolve(ErrorBoundaryKey);
  const gameLoop = new GameLoop();
  const scheduler = new SystemScheduler();
  scheduler.setErrorBoundary(boundary);

  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);

  const vw = options?.viewportWidth ?? 800;
  const vh = options?.viewportHeight ?? 600;
  const mockRenderer = { virtualSize: { width: vw, height: vh } };
  ctx.register(RendererKey, mockRenderer as never);

  const stage = new MockContainer();
  const provider = new MockSceneRenderTreeProvider(stage);
  ctx.register(SceneRenderTreeProviderKey, provider);

  const tree = provider.createForScene(scene);
  scene._registerScoped(SceneRenderTreeKey, tree);
  const layerManager = provider.managerFor(scene)!;
  const root = provider.rootFor(scene)!;

  return {
    context: ctx,
    scene,
    queryCache,
    gameLoop,
    scheduler,
    root,
    layerManager,
    tree,
    provider,
  };
}

export function spawnEntityInScene(scene: Scene, name = "entity"): Entity {
  return scene.spawn(name);
}
