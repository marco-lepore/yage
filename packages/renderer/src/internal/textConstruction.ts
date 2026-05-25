import { devWarn } from "@yagejs/core";
import type { TextOptions } from "pixi.js";
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
  const resolvedStyle = resolveTextStyle(style, extraDefault);
  return {
    bitmap: useBitmap,
    options: {
      text,
      ...(resolvedStyle ? { style: resolvedStyle } : {}),
      ...(!useBitmap && resolution !== undefined ? { resolution } : {}),
    },
  };
}
