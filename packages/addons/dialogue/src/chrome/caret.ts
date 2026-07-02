/**
 * The blinking "continue" caret every chrome draws — one triangle + one blink
 * formula, shared so the box and bubble chromes can't drift apart (their
 * polygons had already diverged before this was extracted), and both
 * parameterized by the theme's {@link CaretTheme} so a game can restyle the
 * caret without forking a presenter.
 */

import type { GraphicsContext } from "@yagejs/renderer";
import { DEFAULT_CARET_BLINK, DEFAULT_CARET_SIZE, type CaretTheme } from "../factory/theme.js";

/**
 * Blink alpha for the continue caret, `time` seconds since it was (re)shown.
 * `blink` is the time constant in `0.35 + 0.65·(0.5 + 0.5·sin(t/blink))`.
 */
export function caretAlpha(time: number, blink: number = DEFAULT_CARET_BLINK): number {
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time / blink));
}

/** The continue-caret triangle (pointing down) at the local origin, sized by
 *  `size` (default {@link DEFAULT_CARET_SIZE}). Position the owning entity's
 *  `Transform` to place it. */
export function drawCaret(
  g: GraphicsContext,
  color: number,
  size: CaretTheme["size"] = DEFAULT_CARET_SIZE,
): void {
  const w = size.width;
  const h = size.height;
  g.poly([0, 0, w, 0, w / 2, h]).fill({ color, alpha: 1 });
}
