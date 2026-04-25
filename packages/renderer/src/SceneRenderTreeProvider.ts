import { Container } from "pixi.js";
import type { Scene, ProcessSystem } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
  EnsureLayerOptions,
} from "./SceneRenderTree.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type { EffectHostFactory, RenderLayer } from "./RenderLayer.js";
import { EffectStack } from "./effects/EffectStack.js";
import { makeSceneScopedProcessHost } from "./effects/hosts/ProcessSystemHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";

interface SceneEntry {
  root: Container;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}



class SceneRenderTreeImpl implements SceneRenderTree {
  private _effects: EffectStack | undefined;

  constructor(
    readonly root: Container,
    private readonly manager: RenderLayerManager,
    private readonly hostFactory?: EffectHostFactory,
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

  addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H {
    if (!this._effects) {
      if (!this.hostFactory) {
        throw new Error(
          "SceneRenderTree.addEffect requires an EffectHostFactory. " +
            "This tree was constructed outside a fully-wired renderer plugin.",
        );
      }
      this._effects = new EffectStack(
        this.root,
        this.hostFactory(),
        "scene",
      );
    }
    return this._effects.add(factory);
  }

  /** @internal — called by the provider before container teardown. */
  _destroyEffects(): void {
    this._effects?.destroy();
    this._effects = undefined;
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

  constructor(
    private readonly stage: Container,
    private readonly processSystem?: ProcessSystem,
  ) {}

  createForScene(scene: Scene): SceneRenderTree {
    if (this.entries.has(scene)) {
      throw new Error(
        `Scene "${scene.name}" already has a render tree attached.`,
      );
    }

    const root = new Container();
    root.label = `scene:${scene.name}`;
    this.stage.addChild(root);

    // Bind the host factory to (processSystem, scene) so every layer- and
    // scene-scope effect created on this tree pauses and time-scales with
    // the owning scene, matching component-scope behavior.
    const ps = this.processSystem;
    const hostFactory: EffectHostFactory | undefined = ps
      ? () => makeSceneScopedProcessHost(ps, scene)
      : undefined;

    const manager = new RenderLayerManager(root, "passive", hostFactory);

    for (const def of scene.layers ?? []) {
      if (manager.tryGet(def.name)) continue;
      manager.createFromDef(def);
    }

    const tree = new SceneRenderTreeImpl(root, manager, hostFactory);
    this.entries.set(scene, { root, manager, tree });
    return tree;
  }

  destroyForScene(scene: Scene): void {
    const entry = this.entries.get(scene);
    if (!entry) return;
    // Tear down effect stacks while containers are still alive so any
    // user-assigned external filters get preserved by EffectStack.destroy.
    entry.tree._destroyEffects();
    entry.manager.destroyEffects();
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
