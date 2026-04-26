import type { Sprite } from "pixi.js";
import type { MaskFactory } from "./MaskFactory.js";

/**
 * Use a caller-supplied `Sprite` as a mask — the sprite's alpha channel
 * defines the visible region. Useful for soft-edged or texture-driven
 * clipping (vignettes, organic frames) that a Graphics shape can't express.
 *
 * Ownership stays with the caller: the sprite is NOT parented or destroyed
 * by the mask system. Make sure it's already in the display tree
 * (typically as a child of the target or a hidden sibling) before calling
 * `setMask`, or pixi will silently fail to apply the mask.
 */
export function spriteMask(sprite: Sprite): MaskFactory {
  return () => ({
    node: sprite,
    owned: false,
    attachToTarget: false,
    inverse: false,
  });
}
