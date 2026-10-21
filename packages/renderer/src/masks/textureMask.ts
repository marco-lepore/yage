import { Sprite } from "pixi.js";
import { resolveTextureInput } from "../assets.js";
import { assertFiniteNumber } from "../internal/validate.js";
import type { TextureRef } from "../public-types.js";
import type { MaskFactory } from "./MaskFactory.js";

/** Options for {@link textureMask}. */
export interface TextureMaskOptions {
  /** X of the texture's anchor in the masked object's local space. Default `0`. */
  x?: number;
  /** Y of the texture's anchor in the masked object's local space. Default `0`. */
  y?: number;
  /** Stretch the texture to this width. Default: the texture's own width. */
  width?: number;
  /** Stretch the texture to this height. Default: the texture's own height. */
  height?: number;
  /** Anchor point (0-1). Default `{ x: 0, y: 0 }`, the top-left corner. */
  anchor?: { x: number; y: number };
}

/**
 * Build a mask from a texture: its alpha channel defines the visible region.
 * Use it for soft-edged or texture-driven clipping (vignettes, organic frames)
 * that a drawn shape can't express. The renderer owns the sprite that draws
 * the texture and destroys it on `remove()`; the texture itself stays with its
 * asset or registration.
 *
 * `texture` is a loaded asset key, a handle, or a key registered with
 * `registerTexture`; `setMask` throws naming a key that resolves to nothing.
 * Positions are in the masked object's own local space, which is world pixels
 * on a world layer and virtual pixels on a screen layer.
 *
 * ```ts
 * tilemap.setMask(textureMask("vignette", { anchor: { x: 0.5, y: 0.5 } }));
 * ```
 */
export function textureMask(
  texture: TextureRef,
  options: TextureMaskOptions = {},
): MaskFactory {
  for (const key of ["x", "y", "width", "height"] as const) {
    const value = options[key];
    if (value !== undefined) assertFiniteNumber("textureMask", key, value);
  }
  return () => {
    const sprite = Sprite.from(resolveTextureInput(texture));
    if (options.anchor) sprite.anchor.set(options.anchor.x, options.anchor.y);
    sprite.position.set(options.x ?? 0, options.y ?? 0);
    if (options.width !== undefined) sprite.width = options.width;
    if (options.height !== undefined) sprite.height = options.height;
    return {
      node: sprite,
      owned: true,
      attachToTarget: true,
      inverse: false,
    };
  };
}
