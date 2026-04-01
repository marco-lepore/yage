import { Component, serializable } from "@yage/core";
import { Graphics } from "pixi.js";
import { RenderLayerManagerKey } from "./types.js";
import type { GraphicsContext } from "./public-types.js";

/** Options for creating a GraphicsComponent. */
export interface GraphicsComponentOptions {
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Serialisable snapshot of a GraphicsComponent. */
export interface GraphicsData {
  layer: string;
}

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
@serializable
export class GraphicsComponent extends Component {
  readonly graphics: GraphicsContext;
  readonly layerName: string;

  constructor(options?: GraphicsComponentOptions) {
    super();
    this.graphics = new Graphics();
    this.layerName = options?.layer ?? "default";
  }

  /** Execute a drawing function on the graphics object. Returns this for chaining. */
  draw(fn: (g: GraphicsContext) => void): this {
    fn(this.graphics);
    return this;
  }

  /** Serialise to a plain object for save/load. */
  serialize(): GraphicsData {
    return { layer: this.layerName };
  }

  /** Create a GraphicsComponent from a serialised snapshot. */
  static fromSnapshot(data: GraphicsData): GraphicsComponent {
    return new GraphicsComponent({ layer: data.layer });
  }

  onAdd(): void {
    const layers = this.use(RenderLayerManagerKey);
    const layer = layers.get(this.layerName);
    layer.container.addChild(this.graphics);
  }

  onDestroy(): void {
    this.graphics.removeFromParent();
    this.graphics.destroy();
  }
}
