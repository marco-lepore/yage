import {
  EngineContext,
  QueryCacheKey,
  ErrorBoundaryKey,
  GameLoop,
  GameLoopKey,
  ProcessSystem,
  ProcessSystemKey,
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
import { EffectStack } from "./effects/EffectStack.js";
import { makeSceneScopedProcessHost } from "./effects/hosts/ProcessSystemHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
import { attachMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle } from "./masks/MaskHandle.js";

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
  filters: unknown = null;
  mask: MockContainer | null = null;
  maskInverse = false;

  setMask(opts: { mask: MockContainer | null; inverse?: boolean }): void {
    this.mask = opts.mask;
    this.maskInverse = opts.inverse ?? false;
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
    {
      manager: RenderLayerManager;
      tree: SceneRenderTree;
      root: MockContainer;
      destroyEffects: () => void;
      destroyMasks: () => void;
    }
  >();

  constructor(
    private readonly stage: MockContainer,
    private readonly processSystem?: ProcessSystem,
  ) {}

  createForScene(scene: Scene): SceneRenderTree {
    if (this.trees.has(scene)) {
      throw new Error(
        `Scene "${scene.name}" already has a render tree attached.`,
      );
    }

    const root = new MockContainer();
    root.label = `scene:${scene.name}`;
    this.stage.addChild(root);

    const ps = this.processSystem;
    const hostFactory = ps
      ? () => makeSceneScopedProcessHost(ps, scene)
      : undefined;

    const manager = new RenderLayerManager(
      root as never,
      undefined,
      hostFactory,
    );

    let sceneStack: EffectStack | undefined;
    let sceneMask: MaskHandle | undefined;
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
      addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H {
        if (!sceneStack) {
          if (!hostFactory) {
            throw new Error(
              "MockSceneRenderTreeProvider was constructed without a ProcessSystem.",
            );
          }
          sceneStack = new EffectStack(
            root as never,
            hostFactory(),
            "scene",
          );
        }
        return sceneStack.add(factory);
      },
      setMask(factory: MaskFactory): MaskHandle {
        sceneMask?.remove();
        sceneMask = attachMask(root as never, factory);
        return sceneMask;
      },
      clearMask(): void {
        sceneMask?.remove();
        sceneMask = undefined;
      },
    };

    const destroyEffects = (): void => {
      sceneStack?.destroy();
      sceneStack = undefined;
      manager.destroyEffects();
    };

    const destroyMasks = (): void => {
      sceneMask?.remove();
      sceneMask = undefined;
      manager.destroyMasks();
    };

    this.trees.set(scene, {
      manager,
      tree,
      root,
      destroyEffects,
      destroyMasks,
    });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.trees.get(scene);
    if (!entry) return;
    entry.destroyEffects();
    entry.destroyMasks();
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
  const processSystem = new ProcessSystem();

  ctx.register(GameLoopKey, gameLoop);
  ctx.register(SystemSchedulerKey, scheduler);
  ctx.register(ProcessSystemKey, processSystem);

  const vw = options?.viewportWidth ?? 800;
  const vh = options?.viewportHeight ?? 600;
  const mockRenderer = { virtualSize: { width: vw, height: vh } };
  ctx.register(RendererKey, mockRenderer as never);

  const stage = new MockContainer();
  const provider = new MockSceneRenderTreeProvider(stage, processSystem);
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
