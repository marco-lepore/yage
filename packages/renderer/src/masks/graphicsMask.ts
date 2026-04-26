import { Graphics } from "pixi.js";
import type { MaskFactory } from "./MaskFactory.js";

/**
 * Build a procedurally-drawn mask from a `Graphics` callback. The renderer
 * owns the `Graphics` node, runs `draw(g)` once at attach time, and re-runs
 * it whenever you call `handle.redraw()` — typically after a layout pass
 * changes the dimensions the closure references.
 *
 * ```ts
 * const handle = attachMask(panel.container, graphicsMask((g) => {
 *   g.clear();
 *   g.rect(0, 0, panel.width, panel.height);
 *   g.fill({ color: 0xffffff });
 * }));
 * // …after layout changes:
 * handle.redraw();
 * ```
 */
export function graphicsMask(
  draw: (g: Graphics) => void,
): MaskFactory {
  return () => {
    const g = new Graphics();
    draw(g);
    return {
      node: g,
      owned: true,
      attachToTarget: true,
      inverse: false,
      redraw: () => draw(g),
    };
  };
}
