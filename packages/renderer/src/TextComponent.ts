import type { Vec2Like } from "@yagejs/core";
import { BitmapText, Text } from "pixi.js";
import { readPoint, writePoint } from "./internal/point.js";
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
  /**
   * Anchor point (0-1). Default: { x: 0, y: 0 } (top-left). See
   * {@link TextComponent.anchor}.
   */
  anchor?: Vec2Like;
}

/** Component that displays text on a render layer. */
export class TextComponent extends VisualComponent {
  private readonly _text: DisplayText | DisplayBitmapText;
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
    this._text = bitmap ? new BitmapText(textOptions) : new Text(textOptions);
    // Shallow-clone so external mutation does not affect later mergeStyle calls.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) this._bitmap = options.bitmap;

    if (options.anchor) {
      writePoint(
        "TextComponent.constructor",
        "anchor",
        this._text.anchor,
        options.anchor,
      );
    }
    this.applyVisualOptions(options);
  }

  /**
   * The Pixi object this component draws with. Change the visual through the
   * component; see {@link VisualComponent.renderObject}.
   */
  get renderObject(): DisplayText | DisplayBitmapText {
    return this._text;
  }

  /**
   * The point of the text that sits on the entity position, as a fraction of
   * the text's size: `{ x: 0, y: 0 }` (the default) is the top-left corner
   * and `{ x: 0.5, y: 0.5 }` the centre. The anchored point stays put when
   * the string or style changes the size. Each read returns a new object; a
   * non-finite coordinate throws.
   */
  get anchor(): Vec2Like {
    return readPoint(this._text.anchor);
  }

  set anchor(value: Vec2Like) {
    writePoint("TextComponent.anchor", "anchor", this._text.anchor, value);
  }

  /** The string currently displayed. */
  get content(): string {
    return this._text.text;
  }

  /** Replace the displayed string. */
  setText(value: string): void {
    this._text.text = value;
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
      this._text.text,
      style,
      this._bitmap,
      undefined,
    );
    this._text.style = options.style ?? style;
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
