import { Container } from "pixi.js";
import type { EventMode } from "pixi.js";
import type { ScopedProcessQueue } from "@yagejs/core";
import type { LayerDef, LayerSortFn, LayerSpace } from "./LayerDef.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";

/**
 * Factory that produces a fresh `ScopedProcessQueue` instance — called once
 * per `EffectStack` so each stack's cancellation scope stays isolated.
 */
export type EffectQueueFactory = () => ScopedProcessQueue;

/** Options for creating a layer. */
export interface CreateLayerOptions {
  /** Per-layer override for PixiJS event mode. Falls back to the manager default. */
  eventMode?: EventMode;
  /**
   * Coordinate space. `"world"` (default) layers are picked up by cameras
   * spawned without explicit `bindings`; `"screen"` layers are skipped so
   * they stay fixed to the viewport. Cameras can still explicitly bind
   * screen-space layers by naming them in `bindings`.
   */
  space?: LayerSpace;
  /**
   * Promote the layer's container to a Pixi v8 render group. See
   * `LayerDef.isRenderGroup` for the full rationale — isolates filter
   * uniforms from sibling layers that read `globalUniforms` directly.
   */
  isRenderGroup?: boolean;
  /**
   * Depth-key function. See `LayerDef.sort` — when set, `DisplaySystem`
   * writes `child.zIndex = sort(child)` on every child each frame, and
   * flips `container.sortableChildren = true` so Pixi orders the layer
   * by zIndex at render time. Default: undefined (insertion order).
   */
  sort?: LayerSortFn;
}

/**
 * Derive `CreateLayerOptions` from a declarative `LayerDef`. Fields set on
 * the def (`space`, `isRenderGroup`, `sort`) take precedence over `base` so
 * a scene's declaration stays authoritative; `base` carries plugin-side
 * defaults for fields the def leaves unset.
 */
export function layerDefToOptions(
  def: LayerDef,
  base?: CreateLayerOptions,
): CreateLayerOptions {
  const merged: CreateLayerOptions = { ...base };
  if (def.space !== undefined) merged.space = def.space;
  if (def.isRenderGroup !== undefined) merged.isRenderGroup = def.isRenderGroup;
  if (def.sort !== undefined) merged.sort = def.sort;
  return merged;
}

/** A named rendering layer — a pixi container at a given draw order. */
export class RenderLayer {
  readonly name: string;
  readonly order: number;
  readonly container: Container;
  /** Coordinate space — see `CreateLayerOptions.space`. */
  readonly space: LayerSpace;
  private _sort: LayerSortFn | undefined;
  /**
   * Layer-scope effects host. `.fx.addEffect(...)` applies a filter to every
   * entity rendered through this layer (one full-screen render pass per
   * layer-scope effect, regardless of how many entities are in the layer).
   * Fades pause with the owning scene and are scaled by its `timeScale`,
   * matching component-scope behavior. Effects survive until the scene
   * exits or the handle is `.remove()`d.
   */
  readonly fx: EffectsHost;
  private _mask: MaskHandle | undefined;

  constructor(
    name: string,
    order: number,
    container: Container,
    space: LayerSpace = "world",
    queueFactory?: EffectQueueFactory,
    sort?: LayerSortFn,
  ) {
    this.name = name;
    this.order = order;
    this.container = container;
    this.space = space;
    this._sort = sort;
    if (sort) container.sortableChildren = true;
    this.fx = new EffectsHost(() => this.container, "layer", queueFactory);
  }

  /**
   * Per-frame depth-key function, or `undefined` for insertion-order
   * rendering. Set via `LayerDef.sort` / `CreateLayerOptions.sort` at
   * creation, or {@link setSort} at runtime. `DisplaySystem` writes
   * `child.zIndex = sort(child)` on every child each Render phase.
   */
  get sort(): LayerSortFn | undefined {
    return this._sort;
  }

  /**
   * Set (or clear) this layer's depth-key function at runtime, flipping
   * `container.sortableChildren` to match. Pass `undefined` to revert to
   * insertion-order rendering. Useful for opting the auto-created
   * `"default"` layer into `ySort` after the scene is live, or toggling
   * depth sorting on/off dynamically.
   */
  setSort(sort: LayerSortFn | undefined): void {
    this._sort = sort;
    this.container.sortableChildren = sort !== undefined;
  }

  /**
   * Attach a mask to this layer's container, replacing any existing mask.
   * Returns a handle for inverse toggling, redraw (graphicsMask), or
   * removal. Torn down on scene exit.
   */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.container, factory);
    return this._mask;
  }

  /** Detach and destroy the layer-scope mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * Tear down any layer-scope mask. Called by `RenderLayerManager` before
   * the layer's container is destroyed so the owned mask Graphics gets
   * cleaned up exactly once.
   * @internal
   */
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
    const handle = restoreMask(this.container, snap);
    if (handle) this._mask = handle;
  }
}

/**
 * Manages named render layers for a single scene. All layers are children
 * of a single root container. Camera transforms are applied per-layer
 * by the DisplaySystem based on CameraEntity bindings.
 */
export class RenderLayerManager {
  private layers = new Map<string, RenderLayer>();
  private readonly rootContainer: Container;
  private readonly _defaultLayer: RenderLayer;
  private readonly _defaultEventMode: EventMode | undefined;
  private readonly _queueFactory: EffectQueueFactory | undefined;

  constructor(
    root: Container,
    defaultEventMode?: EventMode,
    queueFactory?: EffectQueueFactory,
    /**
     * Config for the auto-created `"default"` layer (order 0). Lets a scene
     * that declares `{ name: "default", sort, space, isRenderGroup }`
     * configure the pre-created layer instead of the declaration being a
     * no-op. The provider derives this from the matching `LayerDef`.
     */
    defaultLayerOptions?: CreateLayerOptions,
  ) {
    this.rootContainer = root;
    this._defaultEventMode = defaultEventMode;
    this._queueFactory = queueFactory;
    this._defaultLayer = this.create("default", 0, defaultLayerOptions);
  }

  /** Create a new named layer. Throws if `name` already exists. */
  create(
    name: string,
    order: number,
    opts?: CreateLayerOptions,
  ): RenderLayer {
    if (this.layers.has(name)) {
      throw new Error(`RenderLayer "${name}" already exists.`);
    }
    const container = new Container();
    container.label = name;

    const eventMode = opts?.eventMode ?? this._defaultEventMode;
    if (eventMode) container.eventMode = eventMode;
    if (opts?.isRenderGroup) container.isRenderGroup = true;
    // `sort` is a depth-key fn — DisplaySystem writes the result to each
    // child's zIndex every frame, and Pixi's render pipeline orders the
    // layer by zIndex when `sortableChildren` is true. The `RenderLayer`
    // ctor flips that flag; Pixi's `zIndex` setter marks `sortDirty` on
    // the parent automatically, so we don't need to re-sort manually.
    const layer = new RenderLayer(
      name,
      order,
      container,
      opts?.space ?? "world",
      this._queueFactory,
      opts?.sort,
    );
    this.layers.set(name, layer);

    this.rootContainer.addChild(container);
    this.sortLayers();

    return layer;
  }

  /**
   * Create a layer from a declarative `LayerDef`. Fields on the def
   * (`space`, `sortableChildren`) take precedence over the runtime `opts`
   * so a scene's declaration stays authoritative; `opts` is primarily for
   * plugin-side overrides when auto-provisioning a layer the scene didn't
   * declare (via `ensureLayer`).
   */
  createFromDef(def: LayerDef, opts?: CreateLayerOptions): RenderLayer {
    return this.create(def.name, def.order, layerDefToOptions(def, opts));
  }

  /** Get a layer by name. Throws if not found. */
  get(name: string): RenderLayer {
    const layer = this.layers.get(name);
    if (!layer) {
      throw new Error(`RenderLayer "${name}" not found.`);
    }
    return layer;
  }

  /** Get a layer by name, returning undefined if not found. */
  tryGet(name: string): RenderLayer | undefined {
    return this.layers.get(name);
  }

  /** Get an existing layer, or create it if it doesn't exist. */
  getOrCreate(
    name: string,
    order: number,
    opts?: CreateLayerOptions,
  ): RenderLayer {
    return this.layers.get(name) ?? this.create(name, order, opts);
  }

  /** The default layer (order 0). */
  get defaultLayer(): RenderLayer {
    return this._defaultLayer;
  }

  /** All layers sorted by draw order. */
  getAll(): readonly RenderLayer[] {
    return [...this.layers.values()].sort((a, b) => a.order - b.order);
  }

  /** The root container holding all layers. */
  get root(): Container {
    return this.rootContainer;
  }

  /**
   * Tear down every layer's effect stack. Call BEFORE the root container is
   * destroyed so external (user-assigned) filters get preserved by each
   * stack's destroy logic instead of being clobbered by the container
   * teardown.
   */
  destroyEffects(): void {
    for (const layer of this.layers.values()) {
      layer.fx.destroy();
    }
  }

  /**
   * Tear down every layer's mask. Call BEFORE the root container is
   * destroyed so owned mask Graphics get destroyed exactly once.
   */
  destroyMasks(): void {
    for (const layer of this.layers.values()) {
      layer._destroyMask();
    }
  }

  /** Clear internal state. Call after the root container has been destroyed. */
  destroy(): void {
    this.layers.clear();
  }

  private sortLayers(): void {
    for (const layer of this.layers.values()) {
      layer.container.zIndex = layer.order;
    }
    this.rootContainer.sortableChildren = true;
    this.rootContainer.sortChildren();
  }
}
