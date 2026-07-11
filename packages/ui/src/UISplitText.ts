import { buildTextOptions } from "@yagejs/renderer";
import type {
  DisplayBitmapText,
  DisplayContainer,
  DisplaySplitBitmapText,
  DisplaySplitText,
  DisplayText,
  SegmentAnchor,
  TextStyle,
} from "@yagejs/renderer";
import {
  BitmapFontManager,
  CanvasTextMetrics,
  SplitText,
  SplitBitmapText,
} from "pixi.js";
import type { Node as YogaNode } from "yoga-layout";
import { MeasureMode, Display } from "yoga-layout";
import type { UIElement, UISplitTextProps } from "./types.js";
import { createYogaNode, applyLayoutProps } from "./yoga-helpers.js";
import { applyConsumeInput, clearConsumeInput } from "./consume-input.js";
import { PointerEvents } from "./pointer-events.js";

/** The per-character / per-word / per-line segments of a split text. */
export interface TextSegments {
  /** Per-glyph display objects (`Text` / `BitmapText`), in reading order. */
  readonly chars: (DisplayText | DisplayBitmapText)[];
  /** Word-group containers, each holding its character segments. */
  readonly words: DisplayContainer[];
  /** Line-group containers, each holding its word containers. */
  readonly lines: DisplayContainer[];
}

/** Listener invoked after the text (re)splits into fresh segments. */
export type SplitListener = (segments: TextSegments) => void;

/**
 * Top-level shallow equality for two style objects. A new style literal of the
 * same shape (the common React re-render case) compares equal, so we skip the
 * expensive re-split; a nested object passed by fresh reference (e.g. a new
 * `dropShadow` literal) compares unequal and re-splits, which is correct-but-
 * conservative.
 */
function shallowEqualStyle(
  a: Partial<TextStyle> | undefined,
  b: Partial<TextStyle> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  return ak.every((k) => ar[k] === br[k]);
}

/**
 * UI element that renders text split into per-character / per-word / per-line
 * display objects for animated text — typewriter reveals, per-letter colour /
 * wave, staggered line entrances. The UI sibling of `@yagejs/renderer`'s
 * `SplitTextComponent`; wraps Pixi v8's experimental `SplitText` /
 * `SplitBitmapText` and lays the whole block out as one Yoga element.
 *
 * Unlike {@link UIText} it does **not** support `truncate` or word-wrap to the
 * Yoga slot — pre-break long copy with `\n`, or use `UIText` for flowing
 * paragraphs. Animate the exposed segments yourself (e.g. with the engine's
 * `Tween` / `Process`); {@link onSplit} fires whenever a `setText` re-split
 * invalidates the previous `chars` so you can rebind.
 *
 * @experimental `SplitText` is experimental in Pixi; char spacing can differ
 * slightly from `Text` (kerning is lost once glyphs are split).
 */
export class UISplitText implements UIElement {
  readonly displayObject: DisplayContainer;
  readonly yogaNode: YogaNode;
  /** The underlying Pixi `SplitText` / `SplitBitmapText`. */
  readonly splitText: DisplaySplitText | DisplaySplitBitmapText;
  /** Whether this renders with a bitmap font (`SplitBitmapText`). */
  readonly isBitmap: boolean;
  /** Source string — measured for layout independent of per-glyph animation. */
  private _source: string;
  // Cached so `setStyle` keeps selecting the right Pixi class (canvas vs bitmap).
  private readonly _bitmap: boolean | undefined;
  // Whether Pixi auto-splits on text/style change. When false, `setText` /
  // `setStyle` clear the segments without rebuilding (the split is deferred to
  // `resplit()`), so emitting `onSplit` then would hand listeners empty arrays.
  private readonly _autoSplit: boolean;
  // Last style applied — `update()` re-applies (and re-splits) only on an
  // actual content change, so a parent re-render passing a fresh style literal
  // of the same shape doesn't re-split and reset in-flight glyph animations.
  private _appliedStyle: Partial<TextStyle> | undefined;
  private readonly pointerEvents: PointerEvents;
  private readonly _splitListeners = new Set<SplitListener>();

  constructor(props: UISplitTextProps) {
    this.yogaNode = createYogaNode();
    this._source = props.children ?? "";
    this._bitmap = props.bitmap;
    this._autoSplit = props.autoSplit ?? true;
    this._appliedStyle = props.style;

    const { options, bitmap } = buildTextOptions(
      this._source,
      props.style,
      props.bitmap,
      undefined,
    );
    this.isBitmap = bitmap;
    const splitOptions = {
      text: this._source,
      style: options.style ?? {},
      ...(props.charAnchor !== undefined
        ? { charAnchor: props.charAnchor }
        : {}),
      ...(props.wordAnchor !== undefined
        ? { wordAnchor: props.wordAnchor }
        : {}),
      ...(props.lineAnchor !== undefined
        ? { lineAnchor: props.lineAnchor }
        : {}),
      ...(props.autoSplit !== undefined ? { autoSplit: props.autoSplit } : {}),
    };
    this.splitText = bitmap
      ? new SplitBitmapText(splitOptions)
      : new SplitText(splitOptions);

    applyLayoutProps(this.yogaNode, props);
    if (props.visible === false) this.splitText.visible = false;

    this.displayObject = this.splitText;
    applyConsumeInput(this.splitText, props.consumeInput);
    this.pointerEvents = new PointerEvents(this.splitText, props);

    // Measure the text's NATURAL size via Pixi's metrics, not the live
    // container bounds — per-glyph animation moves/scales the chars, and we
    // don't want the Yoga box to jitter with the animation. No wordWrap /
    // truncate: the block lays out at its intrinsic size (pre-break with \n).
    this.yogaNode.setMeasureFunc((width, widthMode) => {
      const natural = this.measureNatural();
      let measuredWidth = natural.width;
      if (widthMode === MeasureMode.Exactly) {
        measuredWidth = width;
      } else if (widthMode === MeasureMode.AtMost) {
        measuredWidth = Math.min(natural.width, width);
      }
      return { width: measuredWidth, height: natural.height };
    });
  }

  /** Per-glyph display objects, in reading order. */
  get chars(): (DisplayText | DisplayBitmapText)[] {
    return this.splitText.chars;
  }

  /** Word-group containers. */
  get words(): DisplayContainer[] {
    return this.splitText.words;
  }

  /** Line-group containers. */
  get lines(): DisplayContainer[] {
    return this.splitText.lines;
  }

  /** The current segments as one object — handy for `onSplit` callbacks. */
  get segments(): TextSegments {
    return {
      chars: this.splitText.chars,
      words: this.splitText.words,
      lines: this.splitText.lines,
    };
  }

  /**
   * Subscribe to (re)splits. The listener fires after every `setText` /
   * `setStyle` / `resplit` — i.e. whenever the segment objects may have
   * changed. A `setText` (content) change destroys and recreates `chars`, so
   * animations bound to the old ones must be rebound here; a `setStyle` change
   * reuses the same `chars`. Returns an unsubscribe function.
   */
  onSplit(listener: SplitListener): () => void {
    this._splitListeners.add(listener);
    return () => this._splitListeners.delete(listener);
  }

  private emitSplit(): void {
    if (this._splitListeners.size === 0) return;
    const segments = this.segments;
    // Snapshot: a listener may unsubscribe (or subscribe) itself while running.
    for (const listener of [...this._splitListeners]) listener(segments);
  }

  setText(s?: string): void {
    this._source = s ?? "";
    this.splitText.text = this._source;
    this.yogaNode.markDirty();
    // With autoSplit off, Pixi cleared the segments without rebuilding — the
    // real split is deferred to resplit(), which emits then. Emitting now would
    // hand listeners empty arrays.
    if (this._autoSplit) this.emitSplit();
  }

  setStyle(style: Partial<TextStyle>): void {
    const { options } = buildTextOptions(
      this._source,
      style,
      this._bitmap,
      undefined,
    );
    this.splitText.style = options.style ?? style;
    this._appliedStyle = style;
    this.yogaNode.markDirty();
    if (this._autoSplit) this.emitSplit();
  }

  /** Re-split now (only needed when constructed with `autoSplit: false`). */
  resplit(): void {
    this.splitText.split();
    this.yogaNode.markDirty();
    this.emitSplit();
  }

  /** Transform origin (0–1) each character rotates / scales about. */
  set charAnchor(anchor: SegmentAnchor) {
    this.splitText.charAnchor = anchor;
  }
  get charAnchor(): SegmentAnchor {
    return this.splitText.charAnchor;
  }

  /** Transform origin (0–1) each word rotates / scales about. */
  set wordAnchor(anchor: SegmentAnchor) {
    this.splitText.wordAnchor = anchor;
  }
  get wordAnchor(): SegmentAnchor {
    return this.splitText.wordAnchor;
  }

  /** Transform origin (0–1) each line rotates / scales about. */
  set lineAnchor(anchor: SegmentAnchor) {
    this.splitText.lineAnchor = anchor;
  }
  get lineAnchor(): SegmentAnchor {
    return this.splitText.lineAnchor;
  }

  get visible(): boolean {
    return this.displayObject.visible;
  }
  set visible(v: boolean) {
    this.displayObject.visible = v;
    this.yogaNode.setDisplay(v ? Display.Flex : Display.None);
  }

  update(p: Partial<UISplitTextProps>): void {
    if (p.children !== undefined && p.children !== this._source) {
      this.setText(p.children);
    }
    // Re-style (and thus re-split) only on an actual content change. The React
    // reconciler runs update() on every commit with a fresh style object, so
    // without this guard a parent re-render would re-split every frame and
    // reset any in-flight per-glyph animation.
    if (p.style && !shallowEqualStyle(p.style, this._appliedStyle)) {
      this.setStyle(p.style);
    }
    if (p.charAnchor !== undefined) this.charAnchor = p.charAnchor;
    if (p.wordAnchor !== undefined) this.wordAnchor = p.wordAnchor;
    if (p.lineAnchor !== undefined) this.lineAnchor = p.lineAnchor;
    if (p.consumeInput !== undefined) {
      applyConsumeInput(this.splitText, p.consumeInput);
    }
    this.pointerEvents.set(p);
    applyLayoutProps(this.yogaNode, p);
    if (p.visible !== undefined) this.visible = p.visible;
  }

  destroy(): void {
    this._splitListeners.clear();
    clearConsumeInput(this.splitText);
    this.yogaNode.free();
    // `{ children: true }` so the per-line / word / char display objects that
    // `split()` parented are destroyed too — they're real children, not freed
    // by the default leaf destroy.
    this.splitText.destroy({ children: true });
  }

  /**
   * Natural (un-animated) text dimensions via Pixi's measurement APIs — stable
   * regardless of how the live segments have been transformed by animation.
   */
  private measureNatural(): { width: number; height: number } {
    const style = this.splitText.style;
    const m = this.isBitmap
      ? BitmapFontManager.measureText(this._source, style)
      : CanvasTextMetrics.measureText(this._source, style);
    return { width: m.width, height: m.height };
  }
}
