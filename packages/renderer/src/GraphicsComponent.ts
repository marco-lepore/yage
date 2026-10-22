import type { Vec2Like } from "@yagejs/core";
import { Graphics } from "pixi.js";
import { readPoint, writePoint } from "./internal/point.js";
import type { GraphicsContext } from "./public-types.js";
import {
  VisualComponent,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a GraphicsComponent. */
export interface GraphicsComponentOptions extends VisualComponentOptions {
  /**
   * The point of the drawing that sits on the entity position, in the
   * drawing's own pixels. Rotation and scale turn the drawing about it.
   * Default `{ x: 0, y: 0 }`, the origin the `draw` callback draws around.
   * The other visual components take `anchor` for the same purpose, as a
   * fraction of the texture; a drawing has no texture size to take a fraction
   * of, so this is in pixels. See {@link GraphicsComponent.pivot}.
   */
  pivot?: Vec2Like;
}

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
export class GraphicsComponent extends VisualComponent {
  private readonly _graphics: GraphicsContext;

  constructor(options?: GraphicsComponentOptions) {
    super(options?.layer);
    this._graphics = new Graphics();
    if (options?.pivot) {
      writePoint(
        "GraphicsComponent.constructor",
        "pivot",
        this._graphics.pivot,
        options.pivot,
      );
    }
    if (options) this.applyVisualOptions(options);
  }

  /**
   * The Pixi object this component draws with. Change the visual through the
   * component; see {@link VisualComponent.renderObject}.
   */
  get renderObject(): GraphicsContext {
    return this._graphics;
  }

  /**
   * The point of the drawing that sits on the entity position, in the
   * drawing's own pixels. Rotation and scale turn the drawing about it.
   * Default `{ x: 0, y: 0 }`. Each read returns a new object; a non-finite
   * coordinate throws.
   */
  get pivot(): Vec2Like {
    return readPoint(this._graphics.pivot);
  }

  set pivot(value: Vec2Like) {
    writePoint("GraphicsComponent.pivot", "pivot", this._graphics.pivot, value);
  }

  /** Execute a drawing function on the graphics object. Returns this for chaining. */
  draw(fn: (g: GraphicsContext) => void): this {
    fn(this._graphics);
    return this;
  }
}
