/**
 * Shared speech-bubble sizing. The bubble chrome (`BubbleChrome`) and the bubble
 * body text (`BubbleTextView`) are independent presenters that the session drives
 * separately — and the chrome sizes *before* the text (`session.handleSay` calls
 * `chrome.present` then `text.present`). So they can't read a height off each
 * other; instead both compute it from the SAME inputs here, guaranteeing they
 * agree and the text sits inside its frame.
 *
 * Canvas path wraps via the renderer's `measureWrappedText` metrics; the bitmap
 * path can't wrap, so it keeps the fixed minimum (bubbles with a bitmap font stay
 * a fixed size — author the geometry to fit).
 */

import { measureWrappedText } from "@yagejs/renderer";

export interface BubbleSizeInput {
  /** Outer bubble width (px); inner wrap width is `width - 2*padding`. */
  readonly width: number;
  readonly padding: number;
  /** Minimum content height; also the fixed height on the bitmap path. */
  readonly minHeight: number;
  /** Body-text size + line advance (must match the text view's). */
  readonly textSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: string | undefined;
  /** Set → bitmap font: keep `minHeight` (no wrap-aware measurement). */
  readonly bitmapFont?: string | undefined;
}

/**
 * Content height a bubble needs to fit `plainText` (markup already stripped)
 * wrapped to its inner width — clamped to at least `minHeight`. Vertical only;
 * the bubble keeps its configured width.
 */
export function bubbleContentHeight(
  plainText: string,
  cfg: BubbleSizeInput,
): number {
  if (cfg.bitmapFont) return cfg.minHeight;
  const inner = Math.max(1, cfg.width - 2 * cfg.padding);
  const m = measureWrappedText(plainText, {
    fontSize: cfg.textSize,
    lineHeight: cfg.lineHeight,
    wordWrapWidth: inner,
    ...(cfg.fontFamily !== undefined ? { fontFamily: cfg.fontFamily } : {}),
  });
  const content = m.lineCount * cfg.lineHeight + 2 * cfg.padding;
  return Math.max(cfg.minHeight, content);
}
