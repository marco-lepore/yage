import { devWarn } from "@yagejs/core";
import type { TextOptions } from "pixi.js";
import type { BitmapTextOption, TextStyle } from "../public-types.js";

/**
 * Engine-level default text style, applied as the base under every per-text
 * `style`. Set by `RendererPlugin` from `RendererConfig.defaultTextStyle` so
 * consumers don't have to reach into pixi's `TextStyle.defaultTextStyle`.
 * `@yagejs/ui` layers its own override on top via `buildTextOptions`'s
 * `extraDefault`. `undefined` means "no default — use pixi's".
 *
 * @internal
 */
let _defaultTextStyle: TextStyle | undefined;

/** @internal Set the renderer-level default text style (RendererPlugin). */
export function setDefaultTextStyle(style: TextStyle | undefined): void {
  _defaultTextStyle = style ? { ...style } : undefined;
}

/** @internal Current renderer-level default text style, if any. */
export function getDefaultTextStyle(): TextStyle | undefined {
  return _defaultTextStyle;
}

/** Merge two partial styles, returning `undefined` when both are empty. */
function mergeStyles(
  base: TextStyle | undefined,
  over: TextStyle | undefined,
): TextStyle | undefined {
  if (!base) return over;
  if (!over) return base;
  return { ...base, ...over };
}

/**
 * Resolve the final style assigned to a Pixi text node: engine default (+ an
 * optional caller default, e.g. the UIPlugin override) as the base, then the
 * per-text `style`, then the `bitmap` font/size fold on top. Used by both
 * construction and the `setStyle` update paths so a re-render keeps the
 * resolved default + bitmap font.
 *
 * @internal
 */
export function resolveTextStyle(
  style: TextStyle | undefined,
  bitmap: BitmapTextOption | undefined,
  extraDefault?: TextStyle | undefined,
): TextStyle | undefined {
  const base = mergeStyles(_defaultTextStyle, extraDefault);
  return mergeStyles(base, foldBitmapStyle(style, bitmap));
}

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
 * resolution-gating rule. `extraDefault` layers a caller-owned default
 * (the UIPlugin override) between the engine default and the per-text style.
 *
 * @internal
 */
export function buildTextOptions(
  text: string,
  style: TextStyle | undefined,
  bitmap: BitmapTextOption | undefined,
  resolution: number | undefined,
  extraDefault?: TextStyle | undefined,
): { options: TextOptions; bitmap: boolean } {
  if (style && "bitmap" in style) {
    devWarn(
      "Text: `bitmap` was found inside `style` — it's a sibling prop, not a " +
        "style key, and is ignored there. Move it out: " +
        "`{ style: { … }, bitmap: { font } }`.",
    );
  }
  const useBitmap = bitmap === true || (!!bitmap && typeof bitmap === "object");
  const resolvedStyle = resolveTextStyle(style, bitmap, extraDefault);
  return {
    bitmap: useBitmap,
    options: {
      text,
      ...(resolvedStyle ? { style: resolvedStyle } : {}),
      ...(!useBitmap && resolution !== undefined ? { resolution } : {}),
    },
  };
}
