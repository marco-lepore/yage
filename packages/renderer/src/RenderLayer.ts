import { Container } from "pixi.js";
import type { EventMode } from "pixi.js";
import type { LayerDef } from "./LayerDef.js";

/** Options for creating a layer. */
export interface CreateLayerOptions {
  /** Per-layer override for PixiJS event mode. Falls back to the manager default. */
  eventMode?: EventMode;
  /** Whether the container should sort children by their own zIndex. */
  sortableChildren?: boolean;
}

/** A named rendering layer — a pixi container at a given draw order. */
export class RenderLayer {
  readonly name: string;
  readonly order: number;
  readonly space: "world" | "screen";
  readonly container: Container;

  constructor(
    name: string,
    order: number,
    space: "world" | "screen",
    container: Container,
  ) {
    this.name = name;
    this.order = order;
    this.space = space;
    this.container = container;
  }
}

/**
 * Manages named render layers for a single scene. Layers route to one of two
 * root containers based on their `space`:
 * - `"world"` layers live under the camera-transformed `worldRoot`.
 * - `"screen"` layers live under the un-transformed `screenRoot`.
 */
export class RenderLayerManager {
  private layers = new Map<string, RenderLayer>();
  private readonly worldRootContainer: Container;
  private readonly screenRootContainer: Container;
  private readonly _defaultLayer: RenderLayer;
  private readonly _defaultEventMode: EventMode | undefined;

  constructor(
    worldRoot: Container,
    screenRoot: Container,
    defaultEventMode?: EventMode,
  ) {
    this.worldRootContainer = worldRoot;
    this.screenRootContainer = screenRoot;
    this._defaultEventMode = defaultEventMode;
    this._defaultLayer = this.create("default", 0, "world");
  }

  /** Create a new named layer. Throws if `name` already exists. */
  create(
    name: string,
    order: number,
    space: "world" | "screen" = "world",
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

    const layer = new RenderLayer(name, order, space, container);
    this.layers.set(name, layer);

    const root =
      space === "screen" ? this.screenRootContainer : this.worldRootContainer;
    root.addChild(container);
    this.sortLayers(root);

    return layer;
  }

  /** Create a layer from a declarative LayerDef. */
  createFromDef(def: LayerDef): RenderLayer {
    const opts: CreateLayerOptions = {};
    if (def.eventMode) opts.eventMode = def.eventMode;
    if (def.sortableChildren) opts.sortableChildren = def.sortableChildren;
    return this.create(def.name, def.order, def.space ?? "world", opts);
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
    space: "world" | "screen" = "world",
    opts?: CreateLayerOptions,
  ): RenderLayer {
    return this.layers.get(name) ?? this.create(name, order, space, opts);
  }

  /** The default layer (world-space, order 0). */
  get defaultLayer(): RenderLayer {
    return this._defaultLayer;
  }

  /** All layers sorted by draw order. */
  getAll(): readonly RenderLayer[] {
    return [...this.layers.values()].sort((a, b) => a.order - b.order);
  }

  /** The world-space root container. */
  get worldRoot(): Container {
    return this.worldRootContainer;
  }

  /** The screen-space root container. */
  get screenRoot(): Container {
    return this.screenRootContainer;
  }

  /** Clear internal state. Call after both root containers have been destroyed. */
  destroy(): void {
    this.layers.clear();
  }

  private sortLayers(root: Container): void {
    for (const layer of this.layers.values()) {
      if (layer.container.parent === root) {
        layer.container.zIndex = layer.order;
      }
    }
    root.sortableChildren = true;
    root.sortChildren();
  }
}
