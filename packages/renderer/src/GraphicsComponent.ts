import { Component } from "@yage/core";
import { Graphics } from "pixi.js";
import { RenderLayerManagerKey } from "./types.js";

/** Options for creating a GraphicsComponent. */
export interface GraphicsComponentOptions {
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
export class GraphicsComponent extends Component {
  readonly graphics: Graphics;
  readonly layerName: string;

  constructor(options?: GraphicsComponentOptions) {
    super();
    this.graphics = new Graphics();
    this.layerName = options?.layer ?? "default";
  }

  /** Execute a drawing function on the graphics object. Returns this for chaining. */
  draw(fn: (g: Graphics) => void): this {
    fn(this.graphics);
    return this;
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
