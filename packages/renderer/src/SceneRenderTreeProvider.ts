import { Container } from "pixi.js";
import type { ProcessSystem, Scene } from "@yagejs/core";
import { devWarn, makeSceneScopedQueue } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
  EnsureLayerOptions,
} from "./SceneRenderTree.js";
import { RenderLayerManager } from "./RenderLayer.js";
import type { EffectQueueFactory, RenderLayer } from "./RenderLayer.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";

interface SceneEntry {
  root: Container;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}



class SceneRenderTreeImpl implements SceneRenderTree {
  readonly fx: EffectsHost;
  private _mask: MaskHandle | undefined;

  constructor(
    readonly root: Container,
    private readonly manager: RenderLayerManager,
    queueFactory?: EffectQueueFactory,
  ) {
    this.fx = new EffectsHost(() => this.root, "scene", queueFactory);
  }

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
  _destroyMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _serializeMask(): MaskSnapshot | undefined {
    return this._mask?.serialize() ?? undefined;
  }

  /** @internal — used by the renderer's snapshot contributor. */
  _restoreMask(snap: MaskSnapshot): void {
    this._mask?.remove();
    // Clear before restore so an unsavable snapshot (restoreMask returns
    // null) leaves the field genuinely empty instead of holding a torn-down
    // handle for serialize/clearMask to operate on.
    this._mask = undefined;
    const handle = restoreMask(this.root, snap);
    if (handle) this._mask = handle;
  }
}

/**
 * Materializes a per-scene render tree with one root container per scene,
 * added as a direct child of the renderer plugin's `_worldRoot` container
 * (which itself sits under `app.stage`, but holds the fit transform — see
 * `RendererPlugin._worldRoot` for the rationale). Registered under
 * `SceneRenderTreeProviderKey` by the renderer plugin.
 *
 * ```
 * app.stage                  // identity
 *  └── _worldRoot           // fit transform lives here
 *       ├── scene A root
 *       │    ├── layer "bg" (order -10)
 *       │    ├── layer "world" (order 0)
 *       │    └── layer "hud" (order 100)
 *       └── scene B root
 *            └── ...
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

    // Bind the queue factory to (processSystem, scene) so every layer- and
    // scene-scope effect created on this tree pauses and time-scales with
    // the owning scene, matching component-scope behavior.
    const ps = this.processSystem;
    const queueFactory: EffectQueueFactory | undefined = ps
      ? () => makeSceneScopedQueue(ps, scene)
      : undefined;

    const manager = new RenderLayerManager(root, "passive", queueFactory);

    for (const def of scene.layers ?? []) {
      if (manager.tryGet(def.name)) continue;
      warnUiLayerShadow(def);
      manager.createFromDef(def);
    }

    const tree = new SceneRenderTreeImpl(root, manager, queueFactory);
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
    entry.tree.fx.destroy();
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

  /**
   * Hide below-stack scene trees whose top neighbour has
   * `transparentBelow = false`. The topmost scene is always visible; below
   * neighbours stay visible only while every scene above them is
   * `transparentBelow = true`. Detached scenes (mounted via
   * `_mountDetached`, e.g. the debug overlay) are not in the stack and
   * their visibility is left alone.
   * @internal
   */
  applyTransparentBelow(stack: readonly Scene[]): void {
    let visible = true;
    for (let i = stack.length - 1; i >= 0; i--) {
      const scene = stack[i]!;
      const entry = this.entries.get(scene);
      if (entry) entry.root.visible = visible;
      if (!scene.transparentBelow) visible = false;
    }
  }

  /**
   * Restore every tracked scene's root container to visible. Used while a
   * scene transition runs so both the outgoing and incoming scenes can
   * render even when the new topmost scene has `transparentBelow = false`;
   * the visibility chain is reapplied when the transition ends.
   * @internal
   */
  resetVisibility(): void {
    for (const entry of this.entries.values()) {
      entry.root.visible = true;
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
      const treeSnap = tree.fx.serialize();
      const sceneMask = tree._serializeMask();
      const layers: Record<string, EffectStackSnapshot> = {};
      const layerMasks: Record<string, MaskSnapshot> = {};
      let hasLayers = false;
      let hasLayerMasks = false;
      for (const layer of tree.getAll()) {
        const layerSnap = layer.fx.serialize();
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
   * entry to a live tree by `Scene.name` in stack order, so two snapshot
   * entries with the same name map to two same-named live trees in the
   * order they were pushed (snapshots are also serialized in stack order).
   * Entries with no matching scene live are skipped with a warning.
   * @internal
   */
  restoreAll(snap: SceneTreesSnapshot): void {
    // Group live trees by scene name, preserving insertion (push) order
    // within each group. `Scene.name` is documented as debug-only / not
    // unique, so we cannot rely on first-write-wins.
    const treesByName = new Map<string, SceneRenderTreeImpl[]>();
    for (const [scene, entry] of this.entries) {
      const list = treesByName.get(scene.name);
      if (list) list.push(entry.tree);
      else treesByName.set(scene.name, [entry.tree]);
    }
    const consumed = new Map<string, number>();
    for (const entry of snap) {
      const list = treesByName.get(entry.scene);
      const idx = consumed.get(entry.scene) ?? 0;
      const tree = list?.[idx];
      consumed.set(entry.scene, idx + 1);
      if (!tree) {
        console.warn(
          `SceneRenderTreeProvider.restoreAll: no live scene named ` +
            `"${entry.scene}" — its effects + mask state will be skipped.`,
        );
        continue;
      }
      if (entry.tree) tree.fx.restore(entry.tree);
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
          layer.fx.restore(layerSnap);
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

// String-duplicated from @yagejs/ui's `UI_DEFAULT_LAYER` ("ui") to avoid a
// reverse import (renderer is below ui in the dep graph). Kept in sync via
// the dev warning + a co-located test that pins the literal.
const UI_DEFAULT_LAYER_NAME = "ui";
const warnedShadowScenes = new WeakSet<LayerDef>();

function warnUiLayerShadow(def: LayerDef): void {
  if (def.name !== UI_DEFAULT_LAYER_NAME) return;
  if (def.space !== undefined) return;
  if (warnedShadowScenes.has(def)) return;
  warnedShadowScenes.add(def);
  devWarn(
    `Layer 'ui' is the canonical UI layer name; declaring it without ` +
      `space: 'screen' replaces the auto-screen-space layer with a ` +
      `world-space one. Add \`space: 'screen'\` or rename the layer.`,
  );
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
