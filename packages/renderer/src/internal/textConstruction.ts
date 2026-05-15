import type { TextOptions } from "pixi.js";
import type { BitmapTextOption, TextStyle } from "../public-types.js";

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
  let resolvedStyle = style;
  if (bitmap && typeof bitmap === "object") {
    resolvedStyle = {
      ...(style ?? {}),
      ...(bitmap.font !== undefined ? { fontFamily: bitmap.font } : {}),
      ...(bitmap.size !== undefined ? { fontSize: bitmap.size } : {}),
    };
  }
  return {
    bitmap: useBitmap,
    options: {
      text,
      ...(resolvedStyle ? { style: resolvedStyle } : {}),
      ...(!useBitmap && resolution !== undefined ? { resolution } : {}),
    },
  };
}
