import { Graphics } from "pixi.js";
import { defineMask } from "./defineMask.js";

/** Options for {@link rectMask}. */
export interface RectMaskOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in pixels. Omit or pass 0 for a sharp rectangle. */
  rounded?: number;
}

/**
 * Build a static rectangular mask. The renderer owns the underlying
 * `Graphics` node and destroys it on `remove()`.
 *
 * `x`/`y`/`width`/`height` are in the masked object's own local space, which
 * is world pixels on a world layer — the mask then scrolls with the camera —
 * and virtual pixels on a screen layer, where it stays put.
 *
 * For a mask that needs to update with the target's dimensions (e.g. a
 * layout-driven panel), use {@link graphicsMask} so you can call
 * `handle.redraw()` after each layout pass.
 */
export const rectMask = defineMask<RectMaskOptions>({
  name: "yage:rectMask",
  factory: (opts) => {
    const g = new Graphics();
    if (opts.rounded && opts.rounded > 0) {
      g.roundRect(opts.x, opts.y, opts.width, opts.height, opts.rounded);
    } else {
      g.rect(opts.x, opts.y, opts.width, opts.height);
    }
    g.fill({ color: 0xffffff });
    return {
      node: g,
      owned: true,
      attachToTarget: true,
      inverse: false,
    };
  },
});
