import { Container } from "pixi.js";
import type { EventMode } from "pixi.js";
import type { ScopedProcessQueue } from "@yagejs/core";
import type { LayerDef, LayerSpace } from "./LayerDef.js";
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
  /** Whether the container should sort children by their own zIndex. */
  sortableChildren?: boolean;
  /**
   * Coordinate space. `"world"` (default) layers are picked up by cameras
   * spawned without explicit `bindings`; `"screen"` layers are skipped so
   * they stay fixed to the viewport. Cameras can still explicitly bind
   * screen-space layers by naming them in `bindings`.
   */
  space?: LayerSpace;
}

/** A named rendering layer — a pixi container at a given draw order. */
export class RenderLayer {
  readonly name: string;
  readonly order: number;
  readonly container: Container;
  /** Coordinate space — see `CreateLayerOptions.space`. */
  readonly space: LayerSpace;
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
  ) {
    this.name = name;
    this.order = order;
    this.container = container;
    this.space = space;
    this.fx = new EffectsHost(() => this.container, "layer", queueFactory);
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
  ) {
    this.rootContainer = root;
    this._defaultEventMode = defaultEventMode;
    this._queueFactory = queueFactory;
    this._defaultLayer = this.create("default", 0);
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
    if (opts?.sortableChildren) container.sortableChildren = true;

    const layer = new RenderLayer(
      name,
      order,
      container,
      opts?.space ?? "world",
      this._queueFactory,
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
    const merged: CreateLayerOptions = { ...opts };
    if (def.sortableChildren !== undefined) {
      merged.sortableChildren = def.sortableChildren;
    }
    if (def.space !== undefined) merged.space = def.space;
    return this.create(def.name, def.order, merged);
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
