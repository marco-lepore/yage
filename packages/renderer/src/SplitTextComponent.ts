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
export type SplitTextRenderFacet =
  RenderFacetSnapshot<SplitTextRenderFacetExtras>;

/**
 * Transform origin for a text segment, normalized 0–1. `0` is top-left, `0.5`
 * is center, `1` is bottom-right. A single number applies to both axes.
 */
export type SegmentAnchor = number | { x: number; y: number };

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
export class SplitTextComponent extends VisualComponent {
  /** The underlying Pixi `SplitText` / `SplitBitmapText` container. */
  readonly splitText: DisplaySplitText | DisplaySplitBitmapText;
  /** Whether this renders with a bitmap font (`SplitBitmapText`). */
  readonly isBitmap: boolean;
  private _bitmap?: boolean;
  private _anchor?: { x: number; y: number };

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

    if (options.bitmap !== undefined) this._bitmap = options.bitmap;
    if (options.anchor) this._anchor = { ...options.anchor };

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

  /**
   * The string currently displayed. {@link splitText} is the Pixi display
   * object, so this is the way to read the rendered string back — including
   * from the Inspector, which reflects public getters but skips display
   * objects.
   */
  get content(): string {
    return this.splitText.text;
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
  }
  get charAnchor(): SegmentAnchor {
    return this.splitText.charAnchor;
  }

  /** Transform origin for each word (normalized 0–1). */
  set wordAnchor(anchor: SegmentAnchor) {
    this.splitText.wordAnchor = anchor;
  }
  get wordAnchor(): SegmentAnchor {
    return this.splitText.wordAnchor;
  }

  /** Transform origin for each line (normalized 0–1). */
  set lineAnchor(anchor: SegmentAnchor) {
    this.splitText.lineAnchor = anchor;
  }
  get lineAnchor(): SegmentAnchor {
    return this.splitText.lineAnchor;
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
   * read-only window into a typewriter reveal: `visibleText` reports only the
   * glyphs whose `chars[i].visible` is still on. See {@link computeRenderFacet}
   * for the bounds coordinate space.
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
