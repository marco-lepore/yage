import { Container, RenderLayer as PixiRenderLayer } from "pixi.js";
import type { ProcessSystem, Scene } from "@yagejs/core";
import { devWarn, isDev, makeSceneScopedQueue } from "@yagejs/core";
import type { LayerDef } from "./LayerDef.js";
import type {
  SceneRenderTree,
  SceneRenderTreeProvider,
  EnsureLayerOptions,
} from "./SceneRenderTree.js";
import { RenderLayerManager, layerDefToOptions } from "./RenderLayer.js";
import type { EffectQueueFactory, RenderLayer } from "./RenderLayer.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { fanOutHandle } from "./effects/fanOutHandle.js";
import { attachMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle } from "./masks/MaskHandle.js";
import type { DisplayContainer } from "./public-types.js";

interface SceneEntry {
  root: DisplayContainer;
  manager: RenderLayerManager;
  tree: SceneRenderTreeImpl;
}

class SceneRenderTreeImpl implements SceneRenderTree {
  readonly fx: EffectsHost;
  private _mask: MaskHandle | undefined;
  private readonly warnedOrders = new Map<string, Set<number>>();
  /**
   * Pixi render layer holding the nodes drawn after this scene's layers.
   * Built on the first `renderAboveEffects` call.
   */
  private _aboveLayer: PixiRenderLayer | undefined;
  /**
   * Attached node → the listener that re-attaches it after a re-parent.
   * Pixi drops a render-layer attachment in `removeChild`, which every
   * re-parent (`setLayer`, a sort group claiming a visual) goes through.
   */
  private readonly _aboveListeners = new WeakMap<
    DisplayContainer,
    () => void
  >();

  constructor(
    readonly root: DisplayContainer,
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
    const existing = this.manager.tryGet(def.name);
    if (!existing) return this.manager.createFromDef(def, opts);
    if (isDev() && existing.order !== def.order) {
      let orders = this.warnedOrders.get(def.name);
      if (!orders) {
        orders = new Set();
        this.warnedOrders.set(def.name, orders);
      }
      if (!orders.has(def.order)) {
        orders.add(def.order);
        devWarn(
          `SceneRenderTree.ensureLayer: layer "${def.name}" has order ${existing.order}; requested ${def.order}. The existing order is preserved.`,
        );
      }
    }
    return existing;
  }

  addLayerEffect<H extends EffectHandle>(
    factory: EffectFactory<H>,
    layers: readonly string[],
  ): H {
    if (layers.length === 0) {
      throw new Error(
        "SceneRenderTree.addLayerEffect: layers must name at least one layer, got [].",
      );
    }
    // Resolve every name before attaching anything, so an unknown name
    // leaves no half-applied effect behind.
    const targets: RenderLayer[] = [];
    for (const name of layers) {
      if (targets.some((t) => t.name === name)) {
        throw new Error(
          `SceneRenderTree.addLayerEffect: layer "${name}" is listed twice; ` +
            `each layer gets one filter pass.`,
        );
      }
      const layer = this.manager.tryGet(name);
      if (!layer) {
        const declared = this.manager
          .getAll()
          .map((l) => l.name)
          .join(", ");
        throw new Error(
          `SceneRenderTree.addLayerEffect: unknown layer "${name}". ` +
            `Declared layers: ${declared}.`,
        );
      }
      targets.push(layer);
    }
    return fanOutHandle(targets.map((layer) => layer.fx.addEffect(factory)));
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

  renderAboveEffects(node: DisplayContainer): void {
    if (this._aboveListeners.has(node)) return;
    if (!this.contains(node)) {
      throw new Error(
        `SceneRenderTree.renderAboveEffects: node "${node.label}" is not in ` +
          `the "${this.root.label}" tree. Add it to a layer first.`,
      );
    }
    const reattach = (): void => {
      this._aboveLayer?.attach(node);
    };
    this._aboveListeners.set(node, reattach);
    node.on("added", reattach);
    this.ensureAboveLayer().attach(node);
  }

  renderWithEffects(node: DisplayContainer): void {
    const reattach = this._aboveListeners.get(node);
    if (!reattach) return;
    this._aboveListeners.delete(node);
    node.off("added", reattach);
    this._aboveLayer?.detach(node);
  }

  /** @internal — called by the provider before container teardown. */
  _destroyMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * Re-seat the render layer immediately after the scene root. Called after
   * the provider moves the root among its siblings.
   * @internal
   */
  _placeAboveLayer(): void {
    const layer = this._aboveLayer;
    const parent = this.root.parent;
    if (!layer || !parent) return;
    layer.removeFromParent();
    parent.addChildAt(layer, parent.children.indexOf(this.root) + 1);
  }

  /** @internal — called by the provider after the root is destroyed. */
  _destroyAboveLayer(): void {
    if (!this._aboveLayer) return;
    this._aboveLayer.detachAll();
    this._aboveLayer.removeFromParent();
    this._aboveLayer.destroy();
    this._aboveLayer = undefined;
  }

  private ensureAboveLayer(): PixiRenderLayer {
    if (this._aboveLayer) return this._aboveLayer;
    const layer = new PixiRenderLayer({ sortableChildren: false });
    layer.label = `${this.root.label}:above`;
    this._aboveLayer = layer;
    this._placeAboveLayer();
    return layer;
  }

  /** Whether `node` sits somewhere under this scene's root. */
  private contains(node: DisplayContainer): boolean {
    for (let current = node.parent; current != null; current = current.parent) {
      if (current === this.root) return true;
    }
    return false;
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
 *
 * A scene that uses `renderAboveEffects` also owns a Pixi `RenderLayer`
 * placed immediately after its root, so the nodes attached to it draw after
 * the scene's layers and outside the scene root's filters and mask.
 */
export class SceneRenderTreeProviderImpl implements SceneRenderTreeProvider {
  private entries = new Map<Scene, SceneEntry>();

  constructor(
    private readonly stage: DisplayContainer,
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

    // A declared `{ name: "default", ... }` configures the pre-created
    // default layer (order 0) rather than being skipped: the manager bakes
    // its `sort`/`space`/`isRenderGroup` into the layer it builds in its
    // ctor. `order` stays 0 — "default" is the order-0 layer by definition.
    const layers = scene.layers ?? [];
    const defaultDef = layers.find((def) => def.name === "default");
    const manager = new RenderLayerManager(
      root,
      "passive",
      queueFactory,
      defaultDef ? layerDefToOptions(defaultDef) : undefined,
    );

    for (const def of layers) {
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
    entry.tree._destroyAboveLayer();
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
      entry.tree._placeAboveLayer();
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
   * Restore in-stack scene roots to visible. Used while a scene transition
   * runs so both the outgoing and incoming scenes can render even when the
   * new topmost scene has `transparentBelow = false`; the visibility chain
   * is reapplied when the transition ends. Detached scenes (mounted via
   * `_mountDetached`, e.g. the debug overlay) are left alone — same
   * contract as `applyTransparentBelow`, so callers can hide a detached
   * root without it being silently un-hidden on every transition start.
   * @internal
   */
  resetVisibility(stack: readonly Scene[]): void {
    for (const scene of stack) {
      const entry = this.entries.get(scene);
      if (entry) entry.root.visible = true;
    }
  }

  /** Destroy every tracked scene's tree. Used on renderer shutdown. */
  destroyAll(): void {
    for (const scene of [...this.entries.keys()]) {
      this.destroyForScene(scene);
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
