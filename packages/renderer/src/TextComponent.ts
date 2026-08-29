import {
  LocalizationKey,
  LocalizedTextController,
  resolveStatic,
  serializable,
} from "@yagejs/core";
import type { LocalizableText } from "@yagejs/core";
import { BitmapText, Text } from "pixi.js";
import { buildTextOptions } from "./internal/textConstruction.js";
import type {
  DisplayBitmapText,
  DisplayText,
  TextStyle,
} from "./public-types.js";
import {
  VisualComponent,
  visualOptionsFromData,
  type VisualComponentData,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/** Options for creating a TextComponent. */
export interface TextComponentOptions extends VisualComponentOptions {
  /**
   * The text to render — a literal, or a {@link LocalizedBinding} (via `msg`)
   * that re-resolves when the locale changes. A binding is retained: the
   * component subscribes to the localization plugin on add and re-renders on
   * every revision bump.
   */
  text: LocalizableText;
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

/** Serialisable snapshot of a TextComponent. */
export interface TextData extends VisualComponentData {
  /** The source text — the binding descriptor when bound, else the literal.
   *  Restored under the current locale (saved `values` are snapshotted). */
  text: LocalizableText;
  style?: TextStyle;
  bitmap?: boolean;
  resolution?: number;
  anchor?: { x: number; y: number };
}

/** Component that displays text on a render layer. */
@serializable
export class TextComponent extends VisualComponent {
  readonly text: DisplayText | DisplayBitmapText;
  // Raw style options as passed in — kept so `serialize()` emits a POJO, not
  // the live pixi `TextStyle` instance (which has non-enumerable getters and
  // would not round-trip through JSON).
  private _styleOptions?: TextStyle;
  // Raw bitmap / resolution options, cached for the same round-trip reason:
  // the pixi instance doesn't faithfully read them back.
  private _bitmap?: boolean;
  private _resolution?: number;
  // Retains a LocalizedBinding (if the text is one), re-resolves on locale
  // change. A plain string leaves it inert.
  private readonly _localizer: LocalizedTextController;

  constructor(options: TextComponentOptions) {
    super(options.layer);
    const initialText = resolveStatic(options.text);
    const { options: textOptions, bitmap } = buildTextOptions(
      initialText,
      options.style,
      options.bitmap,
      options.resolution,
    );
    this.text = bitmap
      ? new BitmapText(textOptions)
      : new Text(textOptions);
    this._localizer = new LocalizedTextController((value) => {
      this.text.text = value;
    });
    this._localizer.seed(options.text);
    // Shallow-clone so external mutation of the caller's options object
    // doesn't drift our cached snapshot away from the live pixi state.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) this._bitmap = options.bitmap;
    if (options.resolution !== undefined) {
      this._resolution = options.resolution;
    }

    if (options.anchor) {
      this.text.anchor.set(options.anchor.x, options.anchor.y);
    }
    this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): DisplayText | DisplayBitmapText {
    return this.text;
  }

  onAdd(): void {
    super.onAdd();
    this._localizer.attach(this.context.tryResolve(LocalizationKey));
    this.addCleanup(() => this._localizer.detach());
  }

  /**
   * Replace the displayed text — a literal, or a {@link LocalizedBinding} that
   * re-resolves on locale change. Passing a string clears any retained binding.
   */
  setText(value: LocalizableText): void {
    this._localizer.set(value);
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

  serialize(): TextData {
    const data: TextData = {
      ...this.serializeVisual(),
      // Store the SOURCE descriptor when bound (so a restore re-resolves under
      // the then-current locale), else the resolved literal.
      text: this._localizer.binding ?? this.text.text,
      anchor: { x: this.text.anchor.x, y: this.text.anchor.y },
    };
    if (this._styleOptions) data.style = { ...this._styleOptions };
    if (this._bitmap !== undefined) data.bitmap = this._bitmap;
    if (this._resolution !== undefined) data.resolution = this._resolution;
    return data;
  }

  /** Restore effects and mask after the text node is parented. */
  afterRestore(data: TextData): void {
    this.restoreVisual(data);
  }

  static fromSnapshot(data: TextData): TextComponent {
    const opts: TextComponentOptions = {
      ...visualOptionsFromData(data),
      text: data.text,
    };
    if (data.style) opts.style = data.style;
    if (data.bitmap !== undefined) opts.bitmap = data.bitmap;
    if (data.resolution !== undefined) opts.resolution = data.resolution;
    if (data.anchor) opts.anchor = data.anchor;
    return new TextComponent(opts);
  }
}
