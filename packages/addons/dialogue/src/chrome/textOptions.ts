/**
 * Shared font plumbing for the renderer-backed presenters. Every chrome /
 * choice presenter renders incidental text (nameplates, choice labels) the same
 * way: an optional baked bitmap font wins, else the canvas family + resolution.
 * One {@link FontConfig} triplet + one {@link makeTextOptions} builder keeps the
 * seven presenter configs and their `TextComponent` construction in lockstep.
 */

import type { TextComponentOptions, TextStyle } from "@yagejs/renderer";

/** The font triplet every presenter config carries (canvas by default). */
export interface FontConfig {
  /** Baked bitmap-font name (OPT-IN crisp-pixel path). Omit for canvas text. */
  readonly bitmapFont?: string | undefined;
  /** Canvas font family (used when {@link bitmapFont} is omitted). */
  readonly fontFamily?: string | undefined;
  /** Canvas render resolution (used when not bitmap). */
  readonly resolution?: number | undefined;
}

/**
 * Build the `TextComponent` options for a presenter text node. Colour rides
 * `style.fill`; the bitmap font name lives in `style.fontFamily` (that's where
 * `BitmapText` resolves its font from) and wins over the canvas family.
 */
export function makeTextOptions(
  fonts: FontConfig,
  text: string,
  size: number,
  color: number,
  layer: string,
  anchor: { readonly x: number; readonly y: number } = { x: 0, y: 0 },
): TextComponentOptions & { style: TextStyle } {
  const style: TextStyle = { fontSize: size, fill: color };
  if (fonts.bitmapFont) style.fontFamily = fonts.bitmapFont;
  else if (fonts.fontFamily) style.fontFamily = fonts.fontFamily;
  const base: TextComponentOptions & { style: TextStyle } = { text, style, layer, anchor };
  if (fonts.bitmapFont) base.bitmap = true;
  else if (fonts.resolution !== undefined) base.resolution = fonts.resolution;
  return base;
}
