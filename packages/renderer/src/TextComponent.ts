import {
  Component,
  makeEntityScopedQueue,
  serializable,
} from "@yagejs/core";
import { Text } from "pixi.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";
import type { DisplayText, TextStyle } from "./public-types.js";

/** Options for creating a TextComponent. */
export interface TextComponentOptions {
  /** The text string to render. */
  text: string;
  /** Text style — forwards to PixiJS TextStyleOptions (CSS-like font properties). */
  style?: TextStyle;
  /** Anchor point (0-1). Default: { x: 0, y: 0 } (top-left). */
  anchor?: { x: number; y: number };
  /** Render layer name. Default: "default". */
  layer?: string;
  /** Initial visibility. Default: true. */
  visible?: boolean;
  /** Tint color. */
  tint?: number;
  /** Alpha (opacity). Default: 1. */
  alpha?: number;
}

/** Serialisable snapshot of a TextComponent. */
export interface TextData {
  text: string;
  style?: TextStyle;
  layer: string;
  tint?: number;
  alpha?: number;
  anchor?: { x: number; y: number };
  visible?: boolean;
  effects?: EffectStackSnapshot;
  mask?: MaskSnapshot;
}

/** Component that displays text on a render layer. */
@serializable
export class TextComponent extends Component {
  readonly text: DisplayText;
  readonly layerName: string;
  // Raw style options as passed in — kept so `serialize()` emits a POJO, not
  // the live pixi `TextStyle` instance (which has non-enumerable getters and
  // would not round-trip through JSON).
  private _styleOptions?: TextStyle;
  /** See {@link SpriteComponent.fx}. */
  readonly fx = new EffectsHost(
    () => this.text,
    "component",
    () => makeEntityScopedQueue(this.entity),
  );
  private _mask: MaskHandle | undefined;

  constructor(options: TextComponentOptions) {
    super();
    this.text = new Text({
      text: options.text,
      ...(options.style ? { style: options.style } : {}),
    });
    this.layerName = options.layer ?? "default";
    // Shallow-clone so external mutation of the caller's options object
    // doesn't drift our cached snapshot away from the live pixi state.
    if (options.style) this._styleOptions = { ...options.style };

    if (options.anchor) {
      this.text.anchor.set(options.anchor.x, options.anchor.y);
    }
    if (options.visible !== undefined) {
      this.text.visible = options.visible;
    }
    if (options.tint !== undefined) {
      this.text.tint = options.tint;
    }
    if (options.alpha !== undefined) {
      this.text.alpha = options.alpha;
    }
  }

  /** Replace the displayed string. */
  setText(value: string): void {
    this.text.text = value;
  }

  /** Replace the text style. */
  setStyle(style: TextStyle): void {
    this.text.style = style;
    this._styleOptions = { ...style };
  }

  /** Tint color applied to the rendered text. */
  set tint(color: number) {
    this.text.tint = color;
  }
  get tint(): number {
    return this.text.tint;
  }

  /** Opacity (0-1). */
  set alpha(alpha: number) {
    this.text.alpha = alpha;
  }
  get alpha(): number {
    return this.text.alpha;
  }

  serialize(): TextData {
    const data: TextData = {
      text: this.text.text,
      layer: this.layerName,
      tint: this.text.tint,
      alpha: this.text.alpha,
      anchor: { x: this.text.anchor.x, y: this.text.anchor.y },
      visible: this.text.visible,
    };
    if (this._styleOptions) data.style = { ...this._styleOptions };
    const effects = this.fx.serialize();
    if (effects) data.effects = effects;
    const mask = this._mask?.serialize();
    if (mask) data.mask = mask;
    return data;
  }

  /** Restore effects and mask after the text node is parented. */
  afterRestore(data: TextData): void {
    if (data.effects) this.fx.restore(data.effects);
    if (data.mask) {
      this._mask?.remove();
      const handle = restoreMask(this.text, data.mask);
      if (handle) this._mask = handle;
    }
  }

  static fromSnapshot(data: TextData): TextComponent {
    const opts: TextComponentOptions = {
      text: data.text,
      layer: data.layer,
    };
    if (data.style) opts.style = data.style;
    if (data.tint !== undefined) opts.tint = data.tint;
    if (data.alpha !== undefined) opts.alpha = data.alpha;
    if (data.anchor) opts.anchor = data.anchor;
    if (data.visible !== undefined) opts.visible = data.visible;
    return new TextComponent(opts);
  }

  /** Attach a mask to this text node. See {@link SpriteComponent.setMask}. */
  setMask(factory: MaskFactory): MaskHandle {
    this._mask?.remove();
    this._mask = attachMask(this.text, factory);
    return this._mask;
  }

  /** Detach and destroy the current mask, if any. */
  clearMask(): void {
    this._mask?.remove();
    this._mask = undefined;
  }

  /**
   * The currently attached mask handle, if any. Useful after save/load to
   * recover a handle whose caller-side reference went stale.
   */
  get mask(): MaskHandle | undefined {
    return this._mask;
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.text);
  }

  onDestroy(): void {
    this.fx.destroy();
    this._mask?.remove();
    this.text.removeFromParent();
    this.text.destroy();
  }
}
