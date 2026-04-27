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
 *
 * **Two gotchas:**
 *
 * 1. **Always `g.clear()` first.** Pixi `Graphics` commands accumulate, so
 *    without `clear()` each `redraw()` layers another shape on top of the
 *    previous one. We don't auto-clear — some draws intentionally compose.
 * 2. **Read live state inside the closure, don't snapshot it outside.** JS
 *    closures capture variable bindings, not values; if you save a number
 *    into a `const` and reference that, `redraw()` keeps using the original
 *    number. Reach through to a live source — a property access on a
 *    captured object, a method call, a getter — so each invocation pulls
 *    the current value:
 *
 *    ```ts
 *    // ❌ Stale — captures const value
 *    const w = 200, h = 100;
 *    graphicsMask((g) => { g.clear(); g.rect(0, 0, w, h).fill(0xffffff); });
 *
 *    // ✅ Fresh — reads live state every call
 *    graphicsMask((g) => {
 *      g.clear();
 *      g.rect(0, 0, panel.width, panel.height).fill(0xffffff);
 *    });
 *    ```
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
