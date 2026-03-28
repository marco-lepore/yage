import { Container } from "pixi.js";

/** A named rendering layer with a draw order and PixiJS container. */
export class RenderLayer {
  readonly name: string;
  readonly order: number;
  readonly container: Container;

  constructor(name: string, order: number, container: Container) {
    this.name = name;
    this.order = order;
    this.container = container;
  }
}

/** Manages named render layers attached to a stage container. */
export class RenderLayerManager {
  private layers = new Map<string, RenderLayer>();
  private readonly stageContainer: Container;
  private readonly _defaultLayer: RenderLayer;

  constructor(stageContainer: Container) {
    this.stageContainer = stageContainer;
    this._defaultLayer = this.create("default", 0);
  }

  /** Create a new named layer at the given draw order. Throws if name already exists. */
  create(name: string, order: number): RenderLayer {
    if (this.layers.has(name)) {
      throw new Error(`RenderLayer "${name}" already exists.`);
    }
    const container = new Container();
    container.label = name;

    const layer = new RenderLayer(name, order, container);
    this.layers.set(name, layer);

    this.stageContainer.addChild(container);
    this.sortLayers();

    return layer;
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

  /** Get an existing layer or create it if it doesn't exist. */
  getOrCreate(name: string, order: number): RenderLayer {
    return this.layers.get(name) ?? this.create(name, order);
  }

  /** The default layer (order 0). */
  get defaultLayer(): RenderLayer {
    return this._defaultLayer;
  }

  /** All layers sorted by draw order. */
  getAll(): readonly RenderLayer[] {
    return [...this.layers.values()].sort((a, b) => a.order - b.order);
  }

  private sortLayers(): void {
    for (const layer of this.layers.values()) {
      layer.container.zIndex = layer.order;
    }
    this.stageContainer.sortableChildren = true;
    this.stageContainer.sortChildren();
  }
}
