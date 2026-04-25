import { Component, serializable } from "@yagejs/core";
import { Graphics } from "pixi.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { EffectStack } from "./effects/EffectStack.js";
import { makeEntityProcessHost } from "./effects/hosts/EntityProcessHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
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
  private _effects?: EffectStack;

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

  /** Attach a visual effect to this graphics object. See {@link SpriteComponent.addEffect}. */
  addEffect<H extends EffectHandle>(factory: EffectFactory<H>): H {
    this._effects ??= new EffectStack(
      this.graphics,
      makeEntityProcessHost(this.entity),
      "component",
    );
    return this._effects.add(factory);
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.graphics);
  }

  onDestroy(): void {
    this._effects?.destroy();
    this.graphics.removeFromParent();
    this.graphics.destroy();
  }
}
