import { Container } from "pixi.js";
import type { EventMode } from "pixi.js";
import type { ScopedProcessQueue } from "@yagejs/core";
import type {
  LayerDef,
  LayerSortFn,
  LayerSpace,
  RenderLayerSpace,
} from "./LayerDef.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle } from "./masks/MaskHandle.js";
import type { DisplayContainer, TextureResource } from "./public-types.js";
import type {
  LayerRenderTarget,
  LayerRenderTargetOptions,
  LayerTargetFactory,
  RenderTargetHandle,
} from "./RenderTarget.js";
import {
  assertTextureKeyFree,
  registerTexture,
  releaseTexture,
} from "./assets.js";
import { assertPositiveNumber } from "./internal/validate.js";
import { restoreZIndex } from "./SortGroupComponent.js";

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
   * Coordinate space. `"world"` (default) layers are auto-bound by every
   * camera unless it sets `autoBind: false`; `"screen"` layers are skipped
   * so they stay fixed to the viewport. Cameras can still explicitly bind
   * screen-space layers by naming them in `bindings`. `"canvas"` layers draw
   * in canvas pixels outside the responsive fit; see `LayerDef.space`.
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
   * keys every child each frame and the layer draws its children in key
   * order. Default: undefined (insertion order).
   */
  sort?: LayerSortFn;
  /** Draw the layer into a texture. See `LayerDef.renderTarget`. */
  renderTarget?: LayerRenderTargetOptions;
}

/**
 * Derive `CreateLayerOptions` from a declarative `LayerDef`. Fields set on
 * the def (`space`, `isRenderGroup`, `sort`, `renderTarget`) take precedence over `base` so
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
  if (def.renderTarget !== undefined) merged.renderTarget = def.renderTarget;
  return merged;
}

/** A named rendering layer — a pixi container at a given draw order. */
export class RenderLayer {
  readonly name: string;
  /** Draw order within the scene; `0` on a render-target layer, which never draws on screen. */
  readonly order: number;
  /**
   * The layer's Pixi container, for code that adds its own Pixi objects to
   * the layer, such as a custom visual component or a lighting renderer.
   * Game code puts a visual on the layer with the component's `layer`
   * option and changes the layer through `fx`, `setSort` and `setMask`.
   */
  readonly container: DisplayContainer;
  /**
   * Coordinate space: the declared `space`, or `"texture"` for a layer
   * declared with `renderTarget`.
   */
  readonly space: RenderLayerSpace;
  /**
   * The texture this layer draws into, for a layer declared with
   * `renderTarget`; `undefined` for a layer that draws on screen.
   */
  readonly renderTarget: LayerRenderTarget | undefined;
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
    container: DisplayContainer,
    space: RenderLayerSpace = "world",
    queueFactory?: EffectQueueFactory,
    sort?: LayerSortFn,
    renderTarget?: LayerRenderTarget,
  ) {
    this.name = name;
    this.order = order;
    this.container = container;
    this.space = space;
    this.renderTarget = renderTarget;
    this._sort = sort;
    if (sort) container.sortableChildren = true;
    this.fx = new EffectsHost(() => this.container, "layer", queueFactory);
  }

  /**
   * Per-frame depth-key function, or `undefined` for insertion-order
   * rendering. Set via `LayerDef.sort` / `CreateLayerOptions.sort` at
   * creation, or {@link setSort} at runtime. `DisplaySystem` keys every
   * child with it each Render phase.
   */
  get sort(): LayerSortFn | undefined {
    return this._sort;
  }

  /**
   * Set (or clear) this layer's depth-key function at runtime, flipping
   * `container.sortableChildren` to match. Useful for opting the
   * auto-created `"default"` layer into `ySort` after the scene is live,
   * or toggling depth sorting on dynamically.
   *
   * Passing `undefined` stops the per-frame re-sort and gives each visual
   * back its own `zIndex`, but does **not** restore the original insertion
   * order: Pixi reorders `container.children` in place while sorting is on,
   * so visuals with equal `zIndex` keep their last-sorted order. Re-establish
   * paint order yourself if you need the original sequence back.
   */
  setSort(sort: LayerSortFn | undefined): void {
    this._sort = sort;
    this.container.sortableChildren = sort !== undefined;
    if (sort === undefined) {
      for (const child of this.container.children) restoreZIndex(child);
      // Pixi turns sorting on only when a zIndex changes; one that matched
      // its last depth key changed nothing.
      this.container.sortableChildren = this.container.children.some(
        (child) => child.zIndex !== 0,
      );
    }
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
}

/**
 * Manages named render layers for a single scene. World and screen layers
 * are children of the scene's root container, canvas layers of its canvas
 * root, and a render-target layer's container belongs to no parent. Camera
 * transforms are applied per-layer by the DisplaySystem based on
 * CameraEntity bindings.
 */
export class RenderLayerManager {
  private layers = new Map<string, RenderLayer>();
  /** Each render-target layer's target and the texture key it registered. */
  private readonly targets = new Map<
    RenderLayer,
    { handle: RenderTargetHandle; key: string | undefined }
  >();
  private readonly rootContainer: DisplayContainer;
  private readonly canvasRoot: DisplayContainer | undefined;
  private readonly _defaultLayer: RenderLayer;
  private readonly _defaultEventMode: EventMode | undefined;
  private readonly _queueFactory: EffectQueueFactory | undefined;

  constructor(
    root: DisplayContainer,
    defaultEventMode?: EventMode,
    queueFactory?: EffectQueueFactory,
    /**
     * Config for the auto-created `"default"` layer (order 0). Lets a scene
     * that declares `{ name: "default", sort, space, isRenderGroup }`
     * configure the pre-created layer instead of the declaration being a
     * no-op. The provider derives this from the matching `LayerDef`.
     */
    defaultLayerOptions?: CreateLayerOptions,
    /** Parent of the scene's `"canvas"` layers, outside the fit transform. */
    canvasRoot?: DisplayContainer,
    /** Builds the texture of a layer declared with `renderTarget`. */
    private readonly renderTargets?: LayerTargetFactory,
  ) {
    this.rootContainer = root;
    this.canvasRoot = canvasRoot;
    this._defaultEventMode = defaultEventMode;
    this._queueFactory = queueFactory;
    this._defaultLayer = this.create("default", 0, defaultLayerOptions);
  }

  /**
   * Throw for the first of `defs` this manager cannot create, before any of
   * them is created. A scene's declared layers are checked together, so a
   * bad declaration leaves no texture allocated or key registered.
   */
  assertCanCreate(defs: readonly LayerDef[]): void {
    const keys = new Set<string>();
    for (const def of defs) {
      if (this.layers.has(def.name)) continue;
      this.assertCreatable(def.name, layerDefToOptions(def));
      const key = def.renderTarget?.texture;
      if (key === undefined) continue;
      if (keys.has(key)) {
        throw new Error(
          `RenderLayer "${def.name}": another layer of this scene already ` +
            `registers its texture as "${key}".`,
        );
      }
      keys.add(key);
    }
  }

  /** Create a new named layer. Throws if `name` already exists. */
  create(name: string, order: number, opts?: CreateLayerOptions): RenderLayer {
    if (this.layers.has(name)) {
      throw new Error(`RenderLayer "${name}" already exists.`);
    }
    this.assertCreatable(name, opts);
    const targetOptions = opts?.renderTarget;
    const space: RenderLayerSpace = targetOptions
      ? "texture"
      : (opts?.space ?? "world");
    const container = new Container();
    container.label = name;
    const target = targetOptions && this.createTarget(container, targetOptions);

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
      space,
      this._queueFactory,
      opts?.sort,
      target,
    );
    this.layers.set(name, layer);
    // A render-target layer stays out of the scene's display tree: it draws
    // only into its texture, which another layer shows.
    if (target) {
      this.targets.set(layer, { handle: target, key: targetOptions?.texture });
    } else if (space === "canvas") {
      this.canvasRoot?.addChild(container);
    } else {
      this.rootContainer.addChild(container);
    }
    this.sortLayers();

    return layer;
  }

  /** Throw when a layer named `name` with `opts` cannot be created here. */
  private assertCreatable(name: string, opts: CreateLayerOptions | undefined) {
    if (opts?.space === "canvas" && !this.canvasRoot) {
      throw new Error(
        `RenderLayer "${name}": this render tree has no canvas root, so it ` +
          `cannot hold a "canvas" layer.`,
      );
    }
    const target = opts?.renderTarget;
    if (!target) return;
    if (name === "default") {
      throw new Error(
        `RenderLayer "default": the default layer cannot draw into a texture. ` +
          `Declare the render target on a layer of its own.`,
      );
    }
    if (opts.space !== undefined) {
      throw new Error(
        `RenderLayer "${name}": a render-target layer draws only into its ` +
          `texture, so it takes no space, got "${opts.space}".`,
      );
    }
    if (!this.renderTargets) {
      throw new Error(
        `RenderLayer "${name}": this render tree cannot draw a layer into a texture.`,
      );
    }
    const context = `RenderLayer "${name}".renderTarget`;
    assertPositiveNumber(context, "width", target.width);
    assertPositiveNumber(context, "height", target.height);
    if (target.resolutionScale !== undefined) {
      assertPositiveNumber(context, "resolutionScale", target.resolutionScale);
    }
    if (target.texture !== undefined && this.textureFor(target.texture)) {
      throw new Error(
        `RenderLayer "${name}": another layer of this scene already ` +
          `registers its texture as "${target.texture}".`,
      );
    }
    if (target.texture !== undefined) {
      assertTextureKeyFree(
        `${context}.texture "${target.texture}"`,
        target.texture,
      );
    }
  }

  /**
   * Build the texture a layer declared with `renderTarget` draws into, and
   * register it under its texture key.
   */
  private createTarget(
    container: DisplayContainer,
    options: LayerRenderTargetOptions,
  ): RenderTargetHandle {
    // `assertCreatable` has checked that the factory exists.
    const target = this.renderTargets!(container, options);
    if (options.texture !== undefined) {
      registerTexture(options.texture, target.texture);
    }
    return target;
  }

  /** The texture this manager's layers registered under `key`, if any. */
  textureFor(key: string): TextureResource | undefined {
    for (const { handle, key: owned } of this.targets.values()) {
      if (owned === key) return handle.texture;
    }
    return undefined;
  }

  /**
   * Create a layer from a declarative `LayerDef`. Fields on the def
   * (`space`, `sortableChildren`) take precedence over the runtime `opts`
   * so a scene's declaration stays authoritative; `opts` is primarily for
   * plugin-side overrides when auto-provisioning a layer the scene didn't
   * declare (via `ensureLayer`).
   */
  createFromDef(def: LayerDef, opts?: CreateLayerOptions): RenderLayer {
    // A render-target layer has no order; `0` is never used to draw it.
    return this.create(def.name, def.order ?? 0, layerDefToOptions(def, opts));
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

  /**
   * The root container holding the world and screen layers, for code that
   * adds its own Pixi objects.
   */
  get root(): DisplayContainer {
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

  /**
   * Destroy every render-target layer's texture, unregister its texture key,
   * and destroy the layer's container, which sits outside the root. Call
   * after {@link destroyEffects} and {@link destroyMasks}. Returns the keys
   * it unregistered; a key a later scene registered stays with that scene.
   */
  destroyRenderTargets(): string[] {
    const released: string[] = [];
    for (const [layer, { handle, key }] of this.targets) {
      if (key !== undefined && releaseTexture(key, handle.texture)) {
        released.push(key);
      }
      handle.destroy();
      layer.container.destroy({ children: true });
    }
    this.targets.clear();
    return released;
  }

  /** Clear internal state. Call after the root container has been destroyed. */
  destroy(): void {
    this.layers.clear();
  }

  private sortLayers(): void {
    for (const layer of this.layers.values()) {
      layer.container.zIndex = layer.order;
    }
    for (const root of [this.rootContainer, this.canvasRoot]) {
      if (!root) continue;
      root.sortableChildren = true;
      root.sortChildren();
    }
  }
}
