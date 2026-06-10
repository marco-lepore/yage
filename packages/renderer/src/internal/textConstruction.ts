import { devWarn } from "@yagejs/core";
import type { TextOptions } from "pixi.js";
import { resolveBitmapFontVariant } from "./bitmapFontVariants.js";
import type { TextStyle } from "../public-types.js";

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
 * per-text `style` on top. Used by both construction and the `setStyle`
 * update paths so a re-render keeps the resolved default.
 *
 * @internal
 */
export function resolveTextStyle(
  style: TextStyle | undefined,
  extraDefault?: TextStyle | undefined,
): TextStyle | undefined {
  if (style && "bitmap" in style) {
    devWarn(
      "Text: `bitmap` was found inside `style` — it's a sibling prop, not a " +
        "style key, and is ignored there. Move it out: " +
        "`{ style: { … }, bitmap: true }`.",
    );
  }
  const base = mergeStyles(_defaultTextStyle, extraDefault);
  return mergeStyles(base, style);
}

/**
 * Build the shared `Text` / `BitmapText` constructor options and pick the
 * Pixi class for both `TextComponent` and `UIText`. `bitmap` selects
 * `BitmapText`, which bakes / looks up its glyph atlas from `style.fontFamily`.
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
  bitmap: boolean | undefined,
  resolution: number | undefined,
  extraDefault?: TextStyle | undefined,
): { options: TextOptions; bitmap: boolean } {
  // `bitmap`-in-`style` warning lives in `resolveTextStyle` (the shared
  // chokepoint), so construction and the `setStyle` paths all surface it.
  const useBitmap = bitmap === true;
  const resolvedStyle = useBitmap
    ? selectBitmapVariant(resolveTextStyle(style, extraDefault))
    : resolveTextStyle(style, extraDefault);
  return {
    bitmap: useBitmap,
    options: {
      text,
      ...(resolvedStyle ? { style: resolvedStyle } : {}),
      ...(!useBitmap && resolution !== undefined ? { resolution } : {}),
    },
  };
}

/**
 * Honour `fontWeight` / `fontStyle` on bitmap text by swapping `fontFamily`
 * to the emphasis variant atlas baked under that family (issue #90 gap 3,
 * delivered via {@link installBitmapFont}'s `variants`). Plain `BitmapText`
 * ignores those props — but if `installBitmapFont` registered a matching bold/
 * italic atlas, redirect the family to it so the synthetic emphasis renders.
 *
 * The variant atlas already baked its weight/slant, and Pixi resolves a
 * `BitmapText` font by the `fontFamily` cache key alone, so the original
 * `fontWeight`/`fontStyle` are dropped from the redirected style to avoid a
 * second dynamic bake. When no variant is registered for the family the style
 * is returned untouched (regular text, an unbaked family, or a font without
 * variants all fall through unchanged).
 *
 * Exported for `measureWrappedText`, which must resolve the same atlas the
 * render path draws from (measure/render parity).
 *
 * @internal
 */
export function selectBitmapVariant(
  style: TextStyle | undefined,
): TextStyle | undefined {
  if (!style || typeof style.fontFamily !== "string") return style;
  const variantName = resolveBitmapFontVariant(style.fontFamily, {
    ...(style.fontWeight !== undefined ? { fontWeight: style.fontWeight } : {}),
    ...(style.fontStyle !== undefined ? { fontStyle: style.fontStyle } : {}),
  });
  if (variantName === undefined || variantName === style.fontFamily) {
    return style;
  }
  const redirected: TextStyle = { ...style, fontFamily: variantName };
  delete redirected.fontWeight;
  delete redirected.fontStyle;
  return redirected;
}
