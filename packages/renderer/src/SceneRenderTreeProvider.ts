import { Container } from "pixi.js";
import type { Scene } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
  EnsureLayerOptions,
} from "./SceneRenderTree.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type { RenderLayer } from "./RenderLayer.js";

interface SceneEntry {
  root: Container;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}

class SceneRenderTreeImpl implements SceneRenderTree {
  constructor(
    readonly root: Container,
    private readonly manager: RenderLayerManager,
  ) {}

  get(name: string): RenderLayer {
    return this.manager.get(name);
  }

  tryGet(name: string): RenderLayer | undefined {
    return this.manager.tryGet(name);
  }

  getAll(): readonly RenderLayer[] {
    return this.manager.getAll();
  }

  get defaultLayer(): RenderLayer {
    return this.manager.defaultLayer;
  }

  ensureLayer(def: LayerDef, opts?: EnsureLayerOptions): RenderLayer {
    return (
      this.manager.tryGet(def.name) ?? this.manager.createFromDef(def, opts)
    );
  }
}

/**
 * Materializes a per-scene render tree with one root container per scene,
 * added as a direct child of `app.stage`. Registered under
 * `SceneRenderTreeProviderKey` by the renderer plugin.
 *
 * ```
 * app.stage
 *  ├── scene A root
 *  │    ├── layer "bg" (order -10)
 *  │    ├── layer "world" (order 0)
 *  │    └── layer "hud" (order 100)
 *  └── scene B root
 *       └── ...
 * ```
 */
export class SceneRenderTreeProviderImpl implements SceneRenderTreeProvider {
  private entries = new Map<Scene, SceneEntry>();

  constructor(private readonly stage: Container) {}

  createForScene(scene: Scene): SceneRenderTree {
    if (this.entries.has(scene)) {
      throw new Error(
        `Scene "${scene.name}" already has a render tree attached.`,
      );
    }

    const root = new Container();
    root.label = `scene:${scene.name}`;
    this.stage.addChild(root);

    const manager = new RenderLayerManager(root, "passive");

    for (const def of scene.layers ?? []) {
      if (manager.tryGet(def.name)) continue;
      manager.createFromDef(def);
    }

    const tree = new SceneRenderTreeImpl(root, manager);
    this.entries.set(scene, { root, manager, tree });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    entry.root.removeFromParent();
    entry.root.destroy({ children: true });
    entry.manager.destroy();
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

  bringSceneToFront(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    const parent = entry.root.parent;
    if (parent) {
      parent.removeChild(entry.root);
      parent.addChild(entry.root);
    }
  }

  /** Destroy every tracked scene's tree. Used on renderer shutdown. */
  destroyAll(): void {
    for (const scene of [...this.entries.keys()]) {
      this.destroyForScene(scene);
    }
  }
}
