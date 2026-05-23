import {
  Component,
  makeEntityScopedQueue,
  serializable,
} from "@yagejs/core";
import { BitmapText, Text } from "pixi.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import type { EffectStackSnapshot } from "./effects/EffectStack.js";
import { EffectsHost } from "./effects/EffectsHost.js";
import { buildTextOptions, foldBitmapStyle } from "./internal/textConstruction.js";
import { attachMask, restoreMask } from "./masks/attachMask.js";
import type { MaskFactory } from "./masks/MaskFactory.js";
import type { MaskHandle, MaskSnapshot } from "./masks/MaskHandle.js";
import type {
  BitmapTextOption,
  DisplayBitmapText,
  DisplayText,
  TextStyle,
} from "./public-types.js";

/** Options for creating a TextComponent. */
export interface TextComponentOptions {
  /** The text string to render. */
  text: string;
  /** Text style — forwards to PixiJS TextStyleOptions (CSS-like font properties). */
  style?: TextStyle;
  /**
   * Render with a bitmap font instead of canvas-rasterised `Text` — the
   * pixel-art escape hatch. `true` bakes a dynamic font from `style`;
   * `{ font }` uses an installed/loaded font by name (`size` overrides the
   * glyph size). See {@link BitmapTextOption}.
   */
  bitmap?: BitmapTextOption;
  /**
   * Per-text render resolution. Mirrors the Pixi v8 `Text` constructor
   * option — note `resolution` is NOT a `TextStyle` property in v8, so
   * setting it here is the only way to get crisp canvas text without a
   * prototype patch. Ignored when `bitmap` is set (bitmap resolution is
   * fixed at font-bake time).
   */
  resolution?: number;
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
  bitmap?: BitmapTextOption;
  resolution?: number;
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
  readonly text: DisplayText | DisplayBitmapText;
  readonly layerName: string;
  // Raw style options as passed in — kept so `serialize()` emits a POJO, not
  // the live pixi `TextStyle` instance (which has non-enumerable getters and
  // would not round-trip through JSON).
  private _styleOptions?: TextStyle;
  // Raw bitmap / resolution options, cached for the same round-trip reason:
  // the pixi instance doesn't faithfully read them back.
  private _bitmap?: BitmapTextOption;
  private _resolution?: number;
  /** See {@link SpriteComponent.fx}. */
  readonly fx = new EffectsHost(
    () => this.text,
    "component",
    () => makeEntityScopedQueue(this.entity),
  );
  private _mask: MaskHandle | undefined;

  constructor(options: TextComponentOptions) {
    super();
    const { options: textOptions, bitmap } = buildTextOptions(
      options.text,
      options.style,
      options.bitmap,
      options.resolution,
    );
    this.text = bitmap
      ? new BitmapText(textOptions)
      : new Text(textOptions);
    this.layerName = options.layer ?? "default";
    // Shallow-clone so external mutation of the caller's options object
    // doesn't drift our cached snapshot away from the live pixi state.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) {
      this._bitmap =
        typeof options.bitmap === "object"
          ? { ...options.bitmap }
          : options.bitmap;
    }
    if (options.resolution !== undefined) {
      this._resolution = options.resolution;
    }

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
    // Re-fold the cached `bitmap.font` → `fontFamily`: the raw `style` has no
    // `fontFamily`, so a bitmap node would otherwise revert to the default
    // canvas family on recolour. Cache the raw style (pre-fold) for round-trip.
    this.text.style = foldBitmapStyle(style, this._bitmap) ?? style;
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
    if (this._bitmap !== undefined) {
      data.bitmap =
        typeof this._bitmap === "object"
          ? { ...this._bitmap }
          : this._bitmap;
    }
    if (this._resolution !== undefined) data.resolution = this._resolution;
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
      // Clear before restore so an unsavable snapshot (restoreMask returns
      // null) leaves the field genuinely empty instead of holding a torn-down
      // handle for serialize/clearMask to operate on.
      this._mask = undefined;
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
    if (data.bitmap !== undefined) opts.bitmap = data.bitmap;
    if (data.resolution !== undefined) opts.resolution = data.resolution;
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
