/**
 * `themeFonts(theme)` lifts a theme's font triplet into the shared
 * {@link FontConfig} shape every presenter config extends — one block instead
 * of the same literal cloned into each factory (which had already started to
 * drift before this was extracted).
 */

import type { FontConfig } from "../chrome/textOptions.js";
import type { DialogueTheme } from "./theme.js";

/** The theme's font triplet, shaped for the presenter configs. */
export function themeFonts(theme: DialogueTheme): FontConfig {
  return {
    bitmapFont: theme.bitmapFont,
    fontFamily: theme.fontFamily,
    resolution: theme.resolution,
  };
}
