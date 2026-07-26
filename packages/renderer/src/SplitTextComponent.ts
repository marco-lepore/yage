import { serializable } from "@yagejs/core";
import { SplitText, SplitBitmapText } from "pixi.js";
import { buildTextOptions } from "./internal/textConstruction.js";
import type {
  DestroyOptions,
  DisplayBitmapText,
  DisplayContainer,
  DisplaySplitBitmapText,
  DisplaySplitText,
  DisplayText,
  TextStyle,
} from "./public-types.js";
import type { RenderFacetSnapshot } from "./internal/renderFacet.js";
import {
  VisualComponent,
  visualOptionsFromData,
  type VisualComponentData,
  type VisualComponentOptions,
} from "./VisualComponent.js";

/**
 * Renderer-specific extras `SplitTextComponent.inspectRender()` attaches on
 * top of the shared {@link RenderFacetSnapshot} base. Lets a typewriter reveal
 * be observed purely through the Inspector — `glyphs[i].visible` mirrors the
 * per-character display objects, and `visibleText` is the currently-painted
 * substring (whitespace-stripped: Pixi treats spaces as separators between
 * `words`/`lines`, not as `chars`, so a fully-revealed `"Hello world"` reports
 * `"Helloworld"`).
 */
export interface SplitTextRenderFacetExtras {
  glyphs: Array<{ visible: boolean }>;
  visibleText: string;
}

/** The full render facet shape returned by {@link SplitTextComponent.inspectRender}. */
export type SplitTextRenderFacet = RenderFacetSnapshot<SplitTextRenderFacetExtras>;

/**
 * Transform origin for a text segment, normalized 0–1. `0` is top-left, `0.5`
 * is center, `1` is bottom-right. A single number applies to both axes.
 */
export type SegmentAnchor = number | { x: number; y: number };

/**
 * Clone an anchor for the serialize cache so a caller mutating the object form
 * after passing it can't drift our snapshot away from the value that was set.
 * Mirrors the shallow-clone of `style` / `bitmap`.
 */
function cloneAnchor(anchor: SegmentAnchor): SegmentAnchor {
  return typeof anchor === "object" ? { ...anchor } : anchor;
}

/** Options for creating a {@link SplitTextComponent}. */
export interface SplitTextComponentOptions extends VisualComponentOptions {
  /** The text string to render and segment. */
  text: string;
  /** Text style — forwards to PixiJS TextStyleOptions (CSS-like font properties). */
  style?: TextStyle;
  /**
   * Transform origin for the whole text block, normalized 0–1.
   * Default: { x: 0, y: 0 } (top-left).
   */
  anchor?: { x: number; y: number };
  /**
   * Render the segments with a bitmap font (`SplitBitmapText`) instead of
   * canvas `Text` (`SplitText`). Pass the installed/baked font name as
   * `style.fontFamily` (and glyph size as `style.fontSize`).
   */
  bitmap?: boolean;
  /** Transform origin for each character. Default `0` (top-left). */
  charAnchor?: SegmentAnchor;
  /** Transform origin for each word. Default `0` (top-left). */
  wordAnchor?: SegmentAnchor;
  /** Transform origin for each line. Default `0` (top-left). */
  lineAnchor?: SegmentAnchor;
  /**
   * Re-split automatically when `text` / `style` change. Default `true`.
   * Set `false` and call {@link SplitTextComponent.resplit} to batch updates.
   */
  autoSplit?: boolean;
}

/** Serialisable snapshot of a SplitTextComponent. */
export interface SplitTextData extends VisualComponentData {
  text: string;
  style?: TextStyle;
  bitmap?: boolean;
  anchor?: { x: number; y: number };
  charAnchor?: SegmentAnchor;
  wordAnchor?: SegmentAnchor;
  lineAnchor?: SegmentAnchor;
  autoSplit?: boolean;
}

/**
 * Displays text split into per-character / per-word / per-line display
 * objects, for animated and rich text — typewriter reveals, per-letter
 * colour / wave, staggered line entrances. Wraps Pixi v8's `SplitText`
 * (canvas) / `SplitBitmapText` (bitmap); the segments are exposed as
 * {@link SplitTextComponent.chars}, {@link SplitTextComponent.words}, and
 * {@link SplitTextComponent.lines} for the game to animate directly.
 *
 * For static or simple dynamic strings prefer {@link TextComponent} — a single
 * display object is cheaper and `SplitText` re-layout on every `text` change is
 * not free.
 *
 * @experimental Pixi marks `SplitText` experimental; its char spacing can
 * differ slightly from `Text` (browser kerning is lost once glyphs are split).
 */
@serializable
export class SplitTextComponent extends VisualComponent {
  /** The underlying Pixi `SplitText` / `SplitBitmapText` container. */
  readonly splitText: DisplaySplitText | DisplaySplitBitmapText;
  /** Whether this renders with a bitmap font (`SplitBitmapText`). */
  readonly isBitmap: boolean;
  // Raw options kept so `serialize()` emits POJOs, not the live pixi objects
  // (whose getters don't faithfully round-trip through JSON). Mirrors TextComponent.
  private _styleOptions?: TextStyle;
  private _bitmap?: boolean;
  private _anchor?: { x: number; y: number };
  private _charAnchor?: SegmentAnchor;
  private _wordAnchor?: SegmentAnchor;
  private _lineAnchor?: SegmentAnchor;
  private _autoSplit?: boolean;

  constructor(options: SplitTextComponentOptions) {
    super(options.layer);
    // Reuse the shared builder for style-default resolution and the
    // canvas/bitmap class pick. `resolution` is N/A for split text (Pixi's
    // SplitOptions has no resolution), so it's not forwarded.
    const { options: textOptions, bitmap } = buildTextOptions(
      options.text,
      options.style,
      options.bitmap,
      undefined,
    );
    this.isBitmap = bitmap;
    const splitOptions = {
      text: options.text,
      style: textOptions.style ?? {},
      ...(options.charAnchor !== undefined
        ? { charAnchor: options.charAnchor }
        : {}),
      ...(options.wordAnchor !== undefined
        ? { wordAnchor: options.wordAnchor }
        : {}),
      ...(options.lineAnchor !== undefined
        ? { lineAnchor: options.lineAnchor }
        : {}),
      ...(options.autoSplit !== undefined
        ? { autoSplit: options.autoSplit }
        : {}),
    };
    this.splitText = bitmap
      ? new SplitBitmapText(splitOptions)
      : new SplitText(splitOptions);

    // Shallow-clone so external mutation of the caller's options can't drift
    // our cached snapshot away from the live pixi state.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) this._bitmap = options.bitmap;
    if (options.anchor) this._anchor = { ...options.anchor };
    if (options.charAnchor !== undefined)
      this._charAnchor = cloneAnchor(options.charAnchor);
    if (options.wordAnchor !== undefined)
      this._wordAnchor = cloneAnchor(options.wordAnchor);
    if (options.lineAnchor !== undefined)
      this._lineAnchor = cloneAnchor(options.lineAnchor);
    if (options.autoSplit !== undefined) this._autoSplit = options.autoSplit;

    this.applyBlockAnchor();
    this.applyVisualOptions(options);
  }

  /** The underlying Pixi display object. */
  get renderObject(): DisplaySplitText | DisplaySplitBitmapText {
    return this.splitText;
  }

  /** Individual character segments (`Text` or `BitmapText`), in reading order. */
  get chars(): (DisplayText | DisplayBitmapText)[] {
    return this.splitText.chars;
  }

  /** Word-group containers, each holding its character segments. */
  get words(): DisplayContainer[] {
    return this.splitText.words;
  }

  /** Line-group containers, each holding its word containers. */
  get lines(): DisplayContainer[] {
    return this.splitText.lines;
  }

  /** Replace the displayed string (re-splits when `autoSplit` is on). */
  setText(value: string): void {
    this.splitText.text = value;
    this.applyBlockAnchor();
  }

  /** Replace the text style (re-splits when `autoSplit` is on). */
  setStyle(style: TextStyle): void {
    const { options } = buildTextOptions(
      this.splitText.text,
      style,
      this._bitmap,
      undefined,
    );
    this.splitText.style = options.style ?? style;
    this._styleOptions = { ...style };
    this.applyBlockAnchor();
  }

  /**
   * Re-split now. Only needed when constructed with `autoSplit: false` — after
   * mutating `text` / `style`, call this to apply the change in one pass.
   */
  resplit(): void {
    this.splitText.split();
    this.applyBlockAnchor();
  }

  /** Transform origin for each character (normalized 0–1). */
  set charAnchor(anchor: SegmentAnchor) {
    this.splitText.charAnchor = anchor;
    this._charAnchor = cloneAnchor(anchor);
  }
  get charAnchor(): SegmentAnchor {
    return this.splitText.charAnchor;
  }

  /** Transform origin for each word (normalized 0–1). */
  set wordAnchor(anchor: SegmentAnchor) {
    this.splitText.wordAnchor = anchor;
    this._wordAnchor = cloneAnchor(anchor);
  }
  get wordAnchor(): SegmentAnchor {
    return this.splitText.wordAnchor;
  }

  /** Transform origin for each line (normalized 0–1). */
  set lineAnchor(anchor: SegmentAnchor) {
    this.splitText.lineAnchor = anchor;
    this._lineAnchor = cloneAnchor(anchor);
  }
  get lineAnchor(): SegmentAnchor {
    return this.splitText.lineAnchor;
  }

  serialize(): SplitTextData {
    const data: SplitTextData = {
      ...this.serializeVisual(),
      text: this.splitText.text,
    };
    if (this._styleOptions) data.style = { ...this._styleOptions };
    if (this._bitmap !== undefined) data.bitmap = this._bitmap;
    if (this._anchor) data.anchor = { ...this._anchor };
    if (this._charAnchor !== undefined)
      data.charAnchor = cloneAnchor(this._charAnchor);
    if (this._wordAnchor !== undefined)
      data.wordAnchor = cloneAnchor(this._wordAnchor);
    if (this._lineAnchor !== undefined)
      data.lineAnchor = cloneAnchor(this._lineAnchor);
    if (this._autoSplit !== undefined) data.autoSplit = this._autoSplit;
    return data;
  }

  /** Restore effects and mask after the split text is parented. */
  afterRestore(data: SplitTextData): void {
    this.restoreVisual(data);
  }

  static fromSnapshot(data: SplitTextData): SplitTextComponent {
    const opts: SplitTextComponentOptions = {
      ...visualOptionsFromData(data),
      text: data.text,
    };
    if (data.style) opts.style = data.style;
    if (data.bitmap !== undefined) opts.bitmap = data.bitmap;
    if (data.anchor) opts.anchor = data.anchor;
    if (data.charAnchor !== undefined) opts.charAnchor = data.charAnchor;
    if (data.wordAnchor !== undefined) opts.wordAnchor = data.wordAnchor;
    if (data.lineAnchor !== undefined) opts.lineAnchor = data.lineAnchor;
    if (data.autoSplit !== undefined) opts.autoSplit = data.autoSplit;
    return new SplitTextComponent(opts);
  }

  private applyBlockAnchor(): void {
    if (!this._anchor) return;
    const bounds = this.splitText.getLocalBounds();
    this.splitText.pivot.set(
      bounds.x + bounds.width * this._anchor.x,
      bounds.y + bounds.height * this._anchor.y,
    );
  }

  /**
   * Derived render facet for the Inspector. Beyond the shared world-space
   * `bounds` and container-level `visible`, this walks the per-character
   * segments and reports `glyphs` (one `{ visible }` per char in reading
   * order) plus `visibleText` — the substring currently painted. This is the
   * read-only window into a typewriter reveal: where `serialize()` reports the
   * full declared string, `visibleText` reports only the glyphs whose
   * `chars[i].visible` is still on. Not part of `serialize()`; see
   * {@link computeRenderFacet} for the bounds coordinate space.
   *
   * Note: Pixi's `chars` array (and therefore `glyphs` / `visibleText`)
   * contains only the rendered glyph segments — whitespace is laid out via
   * `words`/`lines` and is NOT a char. So `visibleText` strips spaces: a fully
   * revealed `"Hello world"` reports `"Helloworld"`. Use it to compare *which
   * glyphs* are on screen, not to reconstruct the original string verbatim.
   */
  inspectRender(): SplitTextRenderFacet {
    const facet = super.inspectRender();
    const chars = this.splitText.chars;
    const glyphs = chars.map((char) => ({ visible: char.visible }));
    const visibleText = chars
      .filter((char) => char.visible)
      .map((char) => char.text)
      .join("");
    return { ...facet, glyphs, visibleText };
  }

  /**
   * `{ children: true }` so the per-line / word / char display objects that
   * `split()` parented are destroyed too (not freed by the default destroy).
   */
  protected destroyOptions(): DestroyOptions {
    return { children: true };
  }
}
