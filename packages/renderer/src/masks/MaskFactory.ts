import type { Container } from "pixi.js";

/**
 * Internal value returned by a `MaskFactory`. Bundles the pixi node that will
 * serve as the mask with the metadata `attachMask` needs to wire it up
 * correctly.
 *
 * @internal — consumers use `rectMask` / `spriteMask` / `graphicsMask` and
 * never construct this directly.
 */
export interface Mask {
  /** The pixi `Container` (typically `Graphics` or `Sprite`) used as the mask. */
  readonly node: Container;
  /**
   * `true` → `attachMask` destroys `node` on `remove()`.
   * `false` (spriteMask) → caller retains ownership; `remove()` only detaches.
   */
  readonly owned: boolean;
  /**
   * `true` → `attachMask` parents `node` under the target via `addChild`
   * (Pixi requires the mask to be in the display tree).
   * `false` (spriteMask) → assumes the caller already placed `node` somewhere
   * appropriate.
   */
  readonly attachToTarget: boolean;
  /** Initial inverse-mask state. */
  readonly inverse: boolean;
  /** Optional re-draw callback; present only on `graphicsMask`. */
  redraw?(): void;
}

/**
 * Zero-argument factory that produces a fresh `Mask`. User-facing helpers
 * (`rectMask(opts)`, etc.) close over their config and return one of these;
 * `attachMask` calls it once at attach time.
 */
export type MaskFactory = () => Mask;
