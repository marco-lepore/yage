import { BitmapText, Text } from "pixi.js";
import { buildTextOptions } from "./internal/textConstruction.js";
import type {
  DisplayBitmapText,
  DisplayText,
  TextStyle,
} from "./public-types.js";
import {
  VisualComponent,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a TextComponent. */
export interface TextComponentOptions extends VisualComponentOptions {
  /** The text string to render. */
  text: string;
  /** Text style — forwards to PixiJS TextStyleOptions (CSS-like font properties). */
  style?: TextStyle;
  /**
   * Render with a bitmap font instead of canvas-rasterised `Text` — the
   * pixel-art escape hatch that stays crisp at non-integer scale. Pixi bakes
   * or looks up the glyph atlas from `style.fontFamily` (the name an
   * {@link installBitmapFont} call registered, or any font for a dynamic
   * bake) at `style.fontSize`.
   */
  bitmap?: boolean;
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
}

/** Component that displays text on a render layer. */
export class TextComponent extends VisualComponent {
  readonly text: DisplayText | DisplayBitmapText;
  // Raw style options are kept so mergeStyle can preserve prior values.
  private _styleOptions?: TextStyle;
  // The bitmap choice is needed when a later style update rebuilds options.
  private _bitmap?: boolean;

  constructor(options: TextComponentOptions) {
    super(options.layer);
    const { options: textOptions, bitmap } = buildTextOptions(
      options.text,
      options.style,
      options.bitmap,
      options.resolution,
    );
    this.text = bitmap ? new BitmapText(textOptions) : new Text(textOptions);
    // Shallow-clone so external mutation does not affect later mergeStyle calls.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) this._bitmap = options.bitmap;

    if (options.anchor) {
      this.text.anchor.set(options.anchor.x, options.anchor.y);
    }
    this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): DisplayText | DisplayBitmapText {
    return this.text;
  }

  /** Replace the displayed string. */
  setText(value: string): void {
    this.text.text = value;
  }

  /**
   * Replace the text style. Unset properties fall back to the engine default
   * (then Pixi's), so this is a full replace, not a patch — to change a few
   * properties while keeping the rest, use {@link mergeStyle}.
   */
  setStyle(style: TextStyle): void {
    // Route through buildTextOptions so the bitmap-variant redirect (synthetic
    // bold/italic via baked variant atlases) runs on the update path too —
    // calling resolveTextStyle directly would let `fontWeight`/`fontStyle`
    // changes silently land on the base atlas on a `bitmap: true` text.
    const { options } = buildTextOptions(
      this.text.text,
      style,
      this._bitmap,
      undefined,
    );
    this.text.style = options.style ?? style;
    this._styleOptions = { ...style };
  }

  /**
   * Patch the current style: merge `style` over the properties already set
   * (construction or a prior `setStyle`/`mergeStyle`) and re-apply. Unlike
   * {@link setStyle}, properties you don't pass are preserved — handy for an
   * imperative recolour (`mergeStyle({ fill })`) that keeps the font, size,
   * weight, etc.
   */
  mergeStyle(style: TextStyle): void {
    this.setStyle({ ...this._styleOptions, ...style });
  }
}
