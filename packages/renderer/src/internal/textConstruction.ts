import type { TextOptions } from "pixi.js";
import type { BitmapTextOption, TextStyle } from "../public-types.js";

/**
 * Fold a `bitmap` option's `font` / `size` into a `TextStyle`. The object
 * form of `bitmap` carries the installed font name (→ `fontFamily`) and an
 * optional glyph `size` (→ `fontSize`); Pixi `BitmapText` reads those off
 * `style`, so they must be merged in. Returns `style` untouched when `bitmap`
 * isn't the object form.
 *
 * Must run on every path that assigns `style` to the Pixi node — not just
 * construction. A re-render that re-applies the raw `style` (which has no
 * `fontFamily`) makes `BitmapText` fall back to the default canvas family, so
 * `setStyle` / update paths re-run this with their cached `bitmap` option.
 *
 * @internal
 */
export function foldBitmapStyle(
  style: TextStyle | undefined,
  bitmap: BitmapTextOption | undefined,
): TextStyle | undefined {
  if (!bitmap || typeof bitmap !== "object") return style;
  return {
    ...(style ?? {}),
    ...(bitmap.font !== undefined ? { fontFamily: bitmap.font } : {}),
    ...(bitmap.size !== undefined ? { fontSize: bitmap.size } : {}),
  };
}

/**
 * Build the shared `Text` / `BitmapText` constructor options and pick the
 * Pixi class for both `TextComponent` and `UIText`. `bitmap` selects
 * `BitmapText`; the object form folds the font name / size into the style.
 * `resolution` is forwarded only to canvas `Text` — `BitmapText` resolution
 * is fixed at font-bake time (Pixi v8 warns if you set it per-instance), so
 * use `installBitmapFont({ resolution })`.
 *
 * Centralised so the two text classes can't drift on the Pixi-v8
 * resolution-gating rule.
 *
 * @internal
 */
export function buildTextOptions(
  text: string,
  style: TextStyle | undefined,
  bitmap: BitmapTextOption | undefined,
  resolution: number | undefined,
): { options: TextOptions; bitmap: boolean } {
  const useBitmap = bitmap === true || (!!bitmap && typeof bitmap === "object");
  const resolvedStyle = foldBitmapStyle(style, bitmap);
  return {
    bitmap: useBitmap,
    options: {
      text,
      ...(resolvedStyle ? { style: resolvedStyle } : {}),
      ...(!useBitmap && resolution !== undefined ? { resolution } : {}),
    },
  };
}
