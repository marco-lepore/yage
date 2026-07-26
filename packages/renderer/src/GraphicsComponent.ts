import { serializable } from "@yagejs/core";
import { Graphics } from "pixi.js";
import type { GraphicsContext } from "./public-types.js";
import {
  VisualComponent,
  visualOptionsFromData,
  type VisualComponentData,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a GraphicsComponent. */
export type GraphicsComponentOptions = VisualComponentOptions;

/** Serialisable snapshot of a GraphicsComponent. */
export type GraphicsData = VisualComponentData;

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
@serializable
export class GraphicsComponent extends VisualComponent {
  readonly graphics: GraphicsContext;

  constructor(options?: GraphicsComponentOptions) {
    super(options?.layer);
    this.graphics = new Graphics();
    if (options) this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): GraphicsContext {
    return this.graphics;
  }

  /** Execute a drawing function on the graphics object. Returns this for chaining. */
  draw(fn: (g: GraphicsContext) => void): this {
    fn(this.graphics);
    return this;
  }

  /** Serialise to a plain object for save/load. */
  serialize(): GraphicsData {
    return this.serializeVisual();
  }

  /** Create a GraphicsComponent from a serialised snapshot. */
  static fromSnapshot(data: GraphicsData): GraphicsComponent {
    return new GraphicsComponent(visualOptionsFromData(data));
  }

  /** Restore effects and mask after the graphics object is parented. */
  afterRestore(data: GraphicsData): void {
    this.restoreVisual(data);
  }
}
