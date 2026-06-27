/**
 * Shared speech-bubble sizing. The bubble chrome (`BubbleChrome`) and the bubble
 * body text (`BubbleTextView`) are independent presenters that the session drives
 * separately — and the chrome sizes *before* the text (`session.handleSay` calls
 * `chrome.present` then `text.present`). So they can't read a size off each other;
 * instead both compute it from the SAME inputs here, guaranteeing they agree and
 * the text sits inside its frame.
 *
 * Bubbles grow **width first**: a short line gets a snug bubble that widens up to
 * `maxWidth`; only past that does the text wrap and the bubble grow taller. That
 * keeps bubbles short (less likely to run off the top of the screen) and reads
 * more like a real speech bubble. Bitmap fonts size the same way — the renderer's
 * `measureWrappedText` is wrap-aware on both paths.
 */

import { measureWrappedText } from "@yagejs/renderer";

export interface BubbleSizeInput {
  /** Snuggest width (px). The bubble never gets narrower than this. */
  readonly minWidth: number;
  /** Widest the bubble grows before the text wraps to more lines. */
  readonly maxWidth: number;
  readonly padding: number;
  /** Minimum content height. */
  readonly minHeight: number;
  /** Body-text size + line advance (must match the text view's). */
  readonly textSize: number;
  readonly lineHeight: number;
  readonly fontFamily?: string | undefined;
  /** Set → measure via this baked bitmap-font atlas instead of `fontFamily`. */
  readonly bitmapFont?: string | undefined;
}

export interface BubbleSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Outer bubble size to fit `plainText` (markup already stripped): widen to the
 * text up to `maxWidth`, then wrap and grow height. Both clamped to the configured
 * minimums.
 */
export function bubbleSize(plainText: string, cfg: BubbleSizeInput): BubbleSize {
  const oneLine = cfg.lineHeight + 2 * cfg.padding;
  const font = cfg.bitmapFont ?? cfg.fontFamily;
  const fontOpt = font !== undefined ? { fontFamily: font } : {};
  const bitmapOpt = cfg.bitmapFont !== undefined ? { bitmap: true } : {};

  // Natural single-line width — does it fit under maxWidth?
  const natural = measureWrappedText(plainText, {
    fontSize: cfg.textSize,
    lineHeight: cfg.lineHeight,
    ...fontOpt,
    ...bitmapOpt,
  });
  const wantWidth = natural.width + 2 * cfg.padding;
  if (wantWidth <= cfg.maxWidth) {
    return {
      width: Math.max(cfg.minWidth, wantWidth),
      height: Math.max(cfg.minHeight, oneLine),
    };
  }

  // Too wide: cap the width, wrap, and grow the height to the line count.
  const inner = cfg.maxWidth - 2 * cfg.padding;
  const wrapped = measureWrappedText(plainText, {
    fontSize: cfg.textSize,
    lineHeight: cfg.lineHeight,
    wordWrapWidth: inner,
    ...fontOpt,
    ...bitmapOpt,
  });
  return {
    width: cfg.maxWidth,
    height: Math.max(cfg.minHeight, wrapped.lineCount * cfg.lineHeight + 2 * cfg.padding),
  };
}
