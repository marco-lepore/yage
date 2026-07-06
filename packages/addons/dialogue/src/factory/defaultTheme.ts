import type { DialogueTheme } from "./theme.js";
import { DIALOGUE_LAYER_FRAME, DIALOGUE_LAYER_TEXT } from "../render/layers.js";

/**
 * defaultDialogueTheme — a zero-config, zero-asset {@link DialogueTheme}.
 *
 * Renders entirely with Graphics chrome (rounded rectangles + strokes) and
 * canvas text (SplitText/Text). No bitmap fonts, no textures, no bundled
 * assets — so `createBoxDialogue()` / `createBubbleDialogue(undefined, opts)`
 * work with no caller-supplied theme.
 *
 * Returns a fresh object each call so callers can spread-and-tweak without
 * mutating a shared singleton:
 *
 * ```ts
 * const theme = { ...defaultDialogueTheme(), textColor: 0xff0000 };
 * ```
 *
 * The `box` is viewport-relative (margins + height), so it's a full-width bottom
 * bar at ANY virtual resolution with no override. Bitmap fonts (`bitmapFont`) and
 * textured nine-slice chrome (the `textured` field) are OPT-IN re-theming paths,
 * intentionally absent here.
 */
export function defaultDialogueTheme(): DialogueTheme {
  return {
    // Viewport-relative: a full-width bottom bar resolved against the renderer's
    // design size at mount, so this works at any resolution with no override.
    box: { marginX: 32, marginY: 24, height: 160 },
    padding: 16,

    frameColor: 0x1a1a2e,
    frameAlpha: 0.92,
    borderColor: 0x4a4a8a,
    cornerRadius: 8,

    nameColor: 0xffd866,
    nameSize: 16,
    indicatorColor: 0xffffff,

    textSize: 18,
    lineHeight: 24,
    textColor: 0xf0f0f0,
    charsPerSec: 45,

    choiceSize: 16,
    choiceColor: 0xaaaaaa,
    choiceSelectedColor: 0xffffff,
    highlightColor: 0x4a4a8a,

    // No bitmapFont → canvas SplitText/Text path (zero assets).
    fontFamily: "sans-serif",

    layerFrame: DIALOGUE_LAYER_FRAME,
    layerText: DIALOGUE_LAYER_TEXT,
  };
}
