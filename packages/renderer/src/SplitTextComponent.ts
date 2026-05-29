import { Component, serializable } from "@yagejs/core";
import type { RenderFacetSnapshot } from "@yagejs/core";
import { SplitText, SplitBitmapText } from "pixi.js";
import type { BitmapText, Container, Text } from "pixi.js";
import { computeRenderFacet } from "./internal/renderFacet.js";
import { SceneRenderTreeKey } from "./SceneRenderTree.js";
import { buildTextOptions } from "./internal/textConstruction.js";
import type { TextStyle } from "./public-types.js";

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
export interface SplitTextComponentOptions {
  /** The text string to render and segment. */
  text: string;
  /** Text style — forwards to PixiJS TextStyleOptions (CSS-like font properties). */
  style?: TextStyle;
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
  /** Render layer name. Default: "default". */
  layer?: string;
  /** Initial visibility. Default: true. */
  visible?: boolean;
  /** Tint color applied to the whole text (cascades to every segment). */
  tint?: number;
  /** Alpha (opacity). Default: 1. */
  alpha?: number;
}

/** Serialisable snapshot of a SplitTextComponent. */
export interface SplitTextData {
  text: string;
  style?: TextStyle;
  bitmap?: boolean;
  charAnchor?: SegmentAnchor;
  wordAnchor?: SegmentAnchor;
  lineAnchor?: SegmentAnchor;
  autoSplit?: boolean;
  layer: string;
  tint?: number;
  alpha?: number;
  visible?: boolean;
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
export class SplitTextComponent extends Component {
  /** The underlying Pixi `SplitText` / `SplitBitmapText` container. */
  readonly splitText: SplitText | SplitBitmapText;
  /** Whether this renders with a bitmap font (`SplitBitmapText`). */
  readonly isBitmap: boolean;
  readonly layerName: string;
  // Raw options kept so `serialize()` emits POJOs, not the live pixi objects
  // (whose getters don't faithfully round-trip through JSON). Mirrors TextComponent.
  private _styleOptions?: TextStyle;
  private _bitmap?: boolean;
  private _charAnchor?: SegmentAnchor;
  private _wordAnchor?: SegmentAnchor;
  private _lineAnchor?: SegmentAnchor;
  private _autoSplit?: boolean;

  constructor(options: SplitTextComponentOptions) {
    super();
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
    this.layerName = options.layer ?? "default";

    // Shallow-clone so external mutation of the caller's options can't drift
    // our cached snapshot away from the live pixi state.
    if (options.style) this._styleOptions = { ...options.style };
    if (options.bitmap !== undefined) this._bitmap = options.bitmap;
    if (options.charAnchor !== undefined)
      this._charAnchor = cloneAnchor(options.charAnchor);
    if (options.wordAnchor !== undefined)
      this._wordAnchor = cloneAnchor(options.wordAnchor);
    if (options.lineAnchor !== undefined)
      this._lineAnchor = cloneAnchor(options.lineAnchor);
    if (options.autoSplit !== undefined) this._autoSplit = options.autoSplit;

    if (options.visible !== undefined) this.splitText.visible = options.visible;
    if (options.tint !== undefined) this.splitText.tint = options.tint;
    if (options.alpha !== undefined) this.splitText.alpha = options.alpha;
  }

  /** Individual character segments (`Text` or `BitmapText`), in reading order. */
  get chars(): (Text | BitmapText)[] {
    return this.splitText.chars;
  }

  /** Word-group containers, each holding its character segments. */
  get words(): Container[] {
    return this.splitText.words;
  }

  /** Line-group containers, each holding its word containers. */
  get lines(): Container[] {
    return this.splitText.lines;
  }

  /** Replace the displayed string (re-splits when `autoSplit` is on). */
  setText(value: string): void {
    this.splitText.text = value;
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
  }

  /**
   * Re-split now. Only needed when constructed with `autoSplit: false` — after
   * mutating `text` / `style`, call this to apply the change in one pass.
   */
  resplit(): void {
    this.splitText.split();
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

  /** Tint color applied to the whole text (cascades to every segment). */
  set tint(color: number) {
    this.splitText.tint = color;
  }
  get tint(): number {
    return this.splitText.tint;
  }

  /** Opacity (0-1). */
  set alpha(alpha: number) {
    this.splitText.alpha = alpha;
  }
  get alpha(): number {
    return this.splitText.alpha;
  }

  serialize(): SplitTextData {
    const data: SplitTextData = {
      text: this.splitText.text,
      layer: this.layerName,
      tint: this.splitText.tint,
      alpha: this.splitText.alpha,
      visible: this.splitText.visible,
    };
    if (this._styleOptions) data.style = { ...this._styleOptions };
    if (this._bitmap !== undefined) data.bitmap = this._bitmap;
    if (this._charAnchor !== undefined)
      data.charAnchor = cloneAnchor(this._charAnchor);
    if (this._wordAnchor !== undefined)
      data.wordAnchor = cloneAnchor(this._wordAnchor);
    if (this._lineAnchor !== undefined)
      data.lineAnchor = cloneAnchor(this._lineAnchor);
    if (this._autoSplit !== undefined) data.autoSplit = this._autoSplit;
    return data;
  }

  static fromSnapshot(data: SplitTextData): SplitTextComponent {
    const opts: SplitTextComponentOptions = {
      text: data.text,
      layer: data.layer,
    };
    if (data.style) opts.style = data.style;
    if (data.bitmap !== undefined) opts.bitmap = data.bitmap;
    if (data.charAnchor !== undefined) opts.charAnchor = data.charAnchor;
    if (data.wordAnchor !== undefined) opts.wordAnchor = data.wordAnchor;
    if (data.lineAnchor !== undefined) opts.lineAnchor = data.lineAnchor;
    if (data.autoSplit !== undefined) opts.autoSplit = data.autoSplit;
    if (data.tint !== undefined) opts.tint = data.tint;
    if (data.alpha !== undefined) opts.alpha = data.alpha;
    if (data.visible !== undefined) opts.visible = data.visible;
    return new SplitTextComponent(opts);
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
   */
  inspectRender(): RenderFacetSnapshot {
    const facet = computeRenderFacet(this.splitText);
    const chars = this.splitText.chars;
    const glyphs = chars.map((char) => ({ visible: char.visible }));
    const visibleText = chars
      .filter((char) => char.visible)
      .map((char) => char.text)
      .join("");
    return { ...facet, glyphs, visibleText };
  }

  onAdd(): void {
    const layer = this.use(SceneRenderTreeKey).get(this.layerName);
    layer.container.addChild(this.splitText);
  }

  onDestroy(): void {
    this.splitText.removeFromParent();
    // `{ children: true }` so the per-line / word / char display objects that
    // `split()` parented are destroyed too (not freed by the default destroy).
    this.splitText.destroy({ children: true });
  }
}
