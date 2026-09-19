/**
 * Shared colour derivation for the hover and press backgrounds, so every
 * element that has them brightens and darkens its resting background by the
 * same amounts.
 */

import type { BackgroundOptions } from "../types.js";
import { isTextureBackground } from "../types.js";

/** Brightening applied to the resting background while an element is hovered. */
export const HOVER_FACTOR = 1.25;
/** Darkening applied to the resting background while an element is pressed. */
export const PRESS_FACTOR = 0.75;

/** Scale each 8-bit channel, clamped, so a colour brightens or darkens. */
export function scaleChannels(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/**
 * Build a hover or press background from the resting one so a textured
 * or recoloured element keeps its look through every state. A colour
 * background has its colour scaled; a texture background keeps its texture
 * and has its tint scaled, which leaves the hover state a no-op at the
 * default white tint and darkens the press state. Channels clamp at 255, so a
 * colour already above roughly 0xCC brightens less than the factor asks for.
 */
export function deriveStateBg(
  base: BackgroundOptions,
  factor: number,
): BackgroundOptions {
  if (isTextureBackground(base)) {
    return { ...base, tint: scaleChannels(base.tint ?? 0xffffff, factor) };
  }
  return { ...base, color: scaleChannels(base.color ?? 0x000000, factor) };
}
