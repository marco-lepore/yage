import type { Vec2Like } from "@yagejs/core";
import { Graphics } from "pixi.js";
import { assertFiniteNumber } from "./internal/validate.js";
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
   * of, so this is in pixels.
   */
  pivot?: Vec2Like;
}

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
export class GraphicsComponent extends VisualComponent {
  readonly graphics: GraphicsContext;

  constructor(options?: GraphicsComponentOptions) {
    super(options?.layer);
    this.graphics = new Graphics();
    if (options?.pivot) {
      const { x, y } = options.pivot;
      assertFiniteNumber("GraphicsComponent.constructor", "pivot.x", x);
      assertFiniteNumber("GraphicsComponent.constructor", "pivot.y", y);
      this.graphics.pivot.set(x, y);
    }
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
}
