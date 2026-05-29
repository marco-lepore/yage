import type { TextStyle } from "../public-types.js";

/**
 * The weight/style emphasis axes a baked bitmap-font variant can carry. A
 * variant is identified by the combination of these two — `bold`, `italic`,
 * `bold italic`, or the unemphasised base.
 *
 * @internal
 */
export interface BitmapFontEmphasis {
  /** `TextStyle.fontWeight` the variant atlas was baked at. */
  fontWeight?: TextStyle["fontWeight"];
  /** `TextStyle.fontStyle` the variant atlas was baked at. */
  fontStyle?: TextStyle["fontStyle"];
}

/**
 * Per-base-font map of emphasis → the registered bitmap-font name baked for
 * that emphasis. Keyed first by the base font `name` (the family a
 * `BitmapText` asks for), then by a normalized emphasis key.
 *
 * @internal
 */
const variantRegistry = new Map<string, Map<string, string>>();

/**
 * A `fontWeight` counts as bold when it's the keyword `"bold"`/`"bolder"` or a
 * numeric weight >= 600. Anything lighter (including the `"normal"` default and
 * unset) is treated as the regular axis so `BitmapText` without explicit
 * emphasis resolves the base atlas.
 */
function isBoldWeight(weight: TextStyle["fontWeight"] | undefined): boolean {
  if (weight === undefined) return false;
  if (weight === "bold" || weight === "bolder") return true;
  // Pixi types `fontWeight` as a string union (`"700"`, not `700`); parse the
  // numeric keywords so a `"600"`+ request lands on the bold axis.
  const numeric = Number(weight);
  return Number.isFinite(numeric) && numeric >= 600;
}

/** `fontStyle` counts as slanted for `italic` and `oblique`. */
function isItalicStyle(style: TextStyle["fontStyle"] | undefined): boolean {
  return style === "italic" || style === "oblique";
}

/**
 * Collapse an emphasis to a stable lookup key on the two boolean axes
 * (bold / italic). Variants only differ along those axes, so a request for
 * `fontWeight: 700` resolves the same atlas baked for `fontWeight: "bold"`.
 *
 * @internal
 */
export function emphasisKey(emphasis: BitmapFontEmphasis): string {
  const bold = isBoldWeight(emphasis.fontWeight);
  const italic = isItalicStyle(emphasis.fontStyle);
  return `${bold ? "b" : "r"}${italic ? "i" : "u"}`;
}

/** Whether an emphasis carries any bold/italic flag at all. */
export function hasEmphasis(emphasis: BitmapFontEmphasis): boolean {
  return isBoldWeight(emphasis.fontWeight) || isItalicStyle(emphasis.fontStyle);
}

/**
 * Record that `variantName` is the bitmap font baked for `baseName` at the
 * given emphasis. The base (unemphasised) atlas registers itself too so a
 * `BitmapText` with `fontWeight: "normal"` resolves back to it.
 *
 * @internal
 */
export function registerBitmapFontVariant(
  baseName: string,
  emphasis: BitmapFontEmphasis,
  variantName: string,
): void {
  let byEmphasis = variantRegistry.get(baseName);
  if (!byEmphasis) {
    byEmphasis = new Map();
    variantRegistry.set(baseName, byEmphasis);
  }
  byEmphasis.set(emphasisKey(emphasis), variantName);
}

/**
 * Resolve the bitmap-font name a `BitmapText` should use given the family it
 * asked for and the emphasis on its style. Returns the matching variant name
 * when one is registered, the base name when no specific variant exists, or
 * `undefined` when `baseName` hosts no variants at all (so the caller leaves
 * `fontFamily` untouched).
 *
 * @internal
 */
export function resolveBitmapFontVariant(
  baseName: string,
  emphasis: BitmapFontEmphasis,
): string | undefined {
  const byEmphasis = variantRegistry.get(baseName);
  if (!byEmphasis) return undefined;
  return byEmphasis.get(emphasisKey(emphasis)) ?? byEmphasis.get("ru");
}

/** Drop every registered variant — test isolation only. @internal */
export function clearBitmapFontVariants(): void {
  variantRegistry.clear();
}
