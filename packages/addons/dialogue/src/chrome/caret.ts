/**
 * The blinking "continue" caret every chrome draws — one triangle + one blink
 * formula, shared so the four chromes can't drift apart (the box and bubble
 * polygons had already diverged before this was extracted).
 */

import type { GraphicsContext } from "@yagejs/renderer";

/** Blink alpha for the continue caret, `timeMs` since it was (re)shown. */
export function caretAlpha(timeMs: number): number {
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(timeMs / 260));
}

/** The continue-caret triangle (7×5 px, pointing down), at the local origin.
 *  Position the owning entity's `Transform` to place it. */
export function drawCaret(g: GraphicsContext, color: number): void {
  g.poly([0, 0, 7, 0, 3.5, 5]).fill({ color, alpha: 1 });
}
