import {
  Component,
  makeEntityScopedQueue,
  serializable,
} from "@yagejs/core";
import { Graphics } from "pixi.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";
import type { GraphicsContext } from "./public-types.js";

/** Options for creating a GraphicsComponent. */
export interface GraphicsComponentOptions {
  /** Render layer name. Default: "default". */
  layer?: string;
}

/** Serialisable snapshot of a GraphicsComponent. */
export interface GraphicsData {
  layer: string;
  effects?: EffectStackSnapshot;
  mask?: MaskSnapshot;
}

/** Component that wraps a PixiJS Graphics object for procedural drawing. */
@serializable
export class GraphicsComponent extends Component {
  readonly graphics: GraphicsContext;
  readonly layerName: string;
  /** See {@link SpriteComponent.fx}. */
  readonly fx = new EffectsHost(
    () => this.graphics,
    "component",
    () => makeEntityScopedQueue(this.entity),
  );
  private _mask: MaskHandle | undefined;

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
    const data: GraphicsData = { layer: this.layerName };
    const effects = this.fx.serialize();
    if (effects) data.effects = effects;
    const mask = this._mask?.serialize();
    if (mask) data.mask = mask;
    return data;
  }

  /** Create a GraphicsComponent from a serialised snapshot. */
  static fromSnapshot(data: GraphicsData): GraphicsComponent {
    return new GraphicsComponent({ layer: data.layer });
  }

  /** Restore effects and mask after the graphics object is parented. */
  afterRestore(data: GraphicsData): void {
    if (data.effects) this.fx.restore(data.effects);
    if (data.mask) {
      this._mask?.remove();
      // Clear before restore so an unsavable snapshot (restoreMask returns
      // null) leaves the field genuinely empty instead of holding a torn-down
      // handle for serialize/clearMask to operate on.
      this._mask = undefined;
      const handle = restoreMask(this.graphics, data.mask);
      if (handle) this._mask = handle;
    }
  }

  /** Attach a mask to this graphics object. See {@link SpriteComponent.setMask}. */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.graphics, factory);
    return this._mask;
  }

  /** Detach and destroy the current mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * The currently attached mask handle, if any. Useful after save/load to
   * recover a handle whose caller-side reference went stale: a savable
   * mask (`rectMask`, custom `defineMask`-registered factory) is rebuilt
   * by `afterRestore`, but the handle held in user code is not.
   */
  get mask(): MaskHandle | undefined {
    return this._mask;
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.graphics);
  }

  onDestroy(): void {
    this.fx.destroy();
    this._mask?.remove();
    this.graphics.removeFromParent();
    this.graphics.destroy();
  }
}
