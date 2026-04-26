import { Graphics } from "pixi.js";
import type { MaskFactory } from "./MaskFactory.js";

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
 * For a mask that needs to update with the target's dimensions (e.g. a
 * layout-driven panel), use {@link graphicsMask} so you can call
 * `handle.redraw()` after each layout pass.
 */
export function rectMask(opts: RectMaskOptions): MaskFactory {
  return () => {
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
  };
}
