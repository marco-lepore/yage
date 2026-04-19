import { Container } from "pixi.js";
import type { EventMode } from "pixi.js";
import type { LayerDef } from "./LayerDef.js";

/** Options for creating a layer. */
export interface CreateLayerOptions {
  /** Per-layer override for PixiJS event mode. Falls back to the manager default. */
  eventMode?: EventMode;
  /** Whether the container should sort children by their own zIndex. */
  sortableChildren?: boolean;
  /**
   * Whether a `CameraEntity` spawned without explicit `bindings` should
   * auto-bind this layer. Default: true. Set false for plugin-owned
   * screen-space layers (e.g. UI). Cameras can still explicitly bind
   * the layer by naming it in `bindings`.
   */
  autoBindable?: boolean;
}

/** A named rendering layer — a pixi container at a given draw order. */
export class RenderLayer {
  readonly name: string;
  readonly order: number;
  readonly container: Container;
  /**
   * Whether cameras with auto-bindings include this layer. See
   * `CreateLayerOptions.autoBindable`.
   */
  readonly autoBindable: boolean;

  constructor(
    name: string,
    order: number,
    container: Container,
    autoBindable = true,
  ) {
    this.name = name;
    this.order = order;
    this.container = container;
    this.autoBindable = autoBindable;
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

  constructor(root: Container, defaultEventMode?: EventMode) {
    this.rootContainer = root;
    this._defaultEventMode = defaultEventMode;
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
      opts?.autoBindable ?? true,
    );
    this.layers.set(name, layer);

    this.rootContainer.addChild(container);
    this.sortLayers();

    return layer;
  }

  /**
   * Create a layer from a declarative `LayerDef`. Additional runtime
   * options (e.g. `autoBindable: false` for plugin-owned screen-space
   * layers) can be passed via `opts` — these are not part of the public
   * `LayerDef` surface.
   */
  createFromDef(def: LayerDef, opts?: CreateLayerOptions): RenderLayer {
    const merged: CreateLayerOptions = { ...opts };
    if (def.sortableChildren) merged.sortableChildren = def.sortableChildren;
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
