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
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { makeSceneScopedProcessHost } from "./effects/hosts/ProcessSystemHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectDefinition } from "./effects/defineEffect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";

interface SceneEntry {
  root: Container;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}



class SceneRenderTreeImpl implements SceneRenderTree {
  private _effects: EffectStack | undefined;
  private _mask: MaskHandle | undefined;

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

  findEffect<H extends EffectHandle, O>(
    definition: EffectDefinition<H, O>,
  ): H | null {
    return (this._effects?.findHandle(definition.name) as H | undefined) ?? null;
  }

  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.root, factory);
    return this._mask;
  }

  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /** @internal — called by the provider before container teardown. */
  _destroyEffects(): void {
    this._effects?.destroy();
    this._effects = undefined;
  }

  /** @internal — called by the provider before container teardown. */
  _destroyMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _serializeEffects(): EffectStackSnapshot | undefined {
    if (!this._effects || this._effects.size === 0) return undefined;
    const snap = this._effects.serialize();
    return snap.entries.length > 0 ? snap : undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _restoreEffects(snap: EffectStackSnapshot): void {
    if (!this._effects) {
      if (!this.hostFactory) {
        throw new Error(
          "SceneRenderTree: cannot restore effects without an EffectHostFactory.",
        );
      }
      this._effects = new EffectStack(this.root, this.hostFactory(), "scene");
    }
    this._effects.restoreFrom(snap);
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _serializeMask(): MaskSnapshot | undefined {
    return this._mask?.serialize() ?? undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _restoreMask(snap: MaskSnapshot): void {
    this._mask?.remove();
    const handle = restoreMask(this.root, snap);
    if (handle) this._mask = handle;
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
    // Tear down effect stacks AND masks while containers are still alive so
    // user-assigned external filters survive the EffectStack teardown and
    // owned mask Graphics aren't destroyed twice (once via remove(), once
    // via root.destroy({ children: true })).
    entry.tree._destroyEffects();
    entry.tree._destroyMask();
    entry.manager.destroyEffects();
    entry.manager.destroyMasks();
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

  /**
   * Capture the layer/scene-scope effect + mask state across every live
   * scene. Each entry records its scene's `name` so restore matches by
   * name (insensitive to push order or extra scenes pushed at runtime).
   * @internal
   */
  serializeAll(): SceneTreesSnapshot {
    const out: SceneTreeSnapshot[] = [];
    for (const [scene, entry] of this.entries) {
      const tree = entry.tree;
      const treeSnap = tree._serializeEffects();
      const sceneMask = tree._serializeMask();
      const layers: Record<string, EffectStackSnapshot> = {};
      const layerMasks: Record<string, MaskSnapshot> = {};
      let hasLayers = false;
      let hasLayerMasks = false;
      for (const layer of tree.getAll()) {
        const layerSnap = layer._serializeEffects();
        if (layerSnap) {
          layers[layer.name] = layerSnap;
          hasLayers = true;
        }
        const maskSnap = layer._serializeMask();
        if (maskSnap) {
          layerMasks[layer.name] = maskSnap;
          hasLayerMasks = true;
        }
      }
      out.push({
        scene: scene.name,
        ...(treeSnap ? { tree: treeSnap } : {}),
        ...(hasLayers ? { layers } : {}),
        ...(sceneMask ? { mask: sceneMask } : {}),
        ...(hasLayerMasks ? { layerMasks } : {}),
      });
    }
    return out;
  }

  /**
   * Apply a `serializeAll()` snapshot onto the live trees. Matches each
   * entry to its live tree by `Scene.name`, which is stable across
   * push/pop (entries with no matching scene live are skipped with a
   * warning). Multiple scenes sharing a name match to the first.
   * @internal
   */
  restoreAll(snap: SceneTreesSnapshot): void {
    const treesByName = new Map<string, SceneRenderTreeImpl>();
    for (const [scene, entry] of this.entries) {
      // First write wins so duplicate-name scenes resolve consistently.
      if (!treesByName.has(scene.name)) {
        treesByName.set(scene.name, entry.tree);
      }
    }
    for (const entry of snap) {
      const tree = treesByName.get(entry.scene);
      if (!tree) {
        console.warn(
          `SceneRenderTreeProvider.restoreAll: no live scene named ` +
            `"${entry.scene}" — its effects + mask state will be skipped.`,
        );
        continue;
      }
      if (entry.tree) tree._restoreEffects(entry.tree);
      if (entry.mask) tree._restoreMask(entry.mask);
      if (entry.layers) {
        for (const [layerName, layerSnap] of Object.entries(entry.layers)) {
          const layer = tree.tryGet(layerName);
          if (!layer) {
            console.warn(
              `SceneRenderTreeProvider.restoreAll: layer "${layerName}" ` +
                `not found on live tree "${entry.scene}" — skipping its effects.`,
            );
            continue;
          }
          layer._restoreEffects(layerSnap);
        }
      }
      if (entry.layerMasks) {
        for (const [layerName, maskSnap] of Object.entries(entry.layerMasks)) {
          const layer = tree.tryGet(layerName);
          if (!layer) {
            console.warn(
              `SceneRenderTreeProvider.restoreAll: layer "${layerName}" ` +
                `not found on live tree "${entry.scene}" — skipping its mask.`,
            );
            continue;
          }
          layer._restoreMask(maskSnap);
        }
      }
    }
  }
}

/** @internal — emitted by `SceneRenderTreeProviderImpl.serializeAll`. */
export type SceneTreesSnapshot = SceneTreeSnapshot[];

/** @internal — one element of {@link SceneTreesSnapshot}. */
export interface SceneTreeSnapshot {
  /** `Scene.name` at save time — used to match the entry on restore. */
  scene: string;
  tree?: EffectStackSnapshot;
  layers?: Record<string, EffectStackSnapshot>;
  mask?: MaskSnapshot;
  layerMasks?: Record<string, MaskSnapshot>;
}
