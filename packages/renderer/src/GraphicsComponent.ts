import { Component, serializable } from "@yagejs/core";
import { Graphics } from "pixi.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { EffectStack } from "./effects/EffectStack.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { makeEntityProcessHost } from "./effects/hosts/EntityProcessHost.js";
import type { EffectFactory } from "./effects/Effect.js";
import type { EffectDefinition } from "./effects/defineEffect.js";
import type { EffectHandle } from "./effects/EffectHandle.js";
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
  private _effects?: EffectStack;
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
    const effects = this._effects?.serialize();
    if (effects && effects.entries.length > 0) data.effects = effects;
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
    if (data.effects) {
      this._effects ??= new EffectStack(
        this.graphics,
        makeEntityProcessHost(this.entity),
        "component",
      );
      this._effects.restoreFrom(data.effects);
    }
    if (data.mask) {
      this._mask?.remove();
      const handle = restoreMask(this.graphics, data.mask);
      if (handle) this._mask = handle;
    }
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

  /**
   * Recover the handle for the first attached effect built from `definition`.
   * Primarily useful after save/load: `afterRestore` rebuilds the stack but
   * the original handle reference becomes stale, so `findEffect(hitFlash)`
   * gives you the new handle to call `trigger()` on.
   */
  findEffect<H extends EffectHandle, O>(
    definition: EffectDefinition<H, O>,
  ): H | null {
    return (this._effects?.findHandle(definition.name) as H | undefined) ?? null;
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

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.graphics);
  }

  onDestroy(): void {
    this._effects?.destroy();
    this._mask?.remove();
    this.graphics.removeFromParent();
    this.graphics.destroy();
  }
}
