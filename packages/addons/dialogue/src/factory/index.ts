// Theme (flat visual config) + the opt-in textured nine-slice styles.
export type {
  DialogueTheme,
  BoxBounds,
  CaretTheme,
  ChromeStyle,
  NineSliceFrame,
  NineSliceInsets,
} from "./theme.js";
// Theme defaults + reserved chrome-style keys (for `meta.chrome` authoring).
export {
  CHROME_STYLE_DEFAULT,
  CHROME_STYLE_NONE,
  DEFAULT_CARET_BLINK_MS,
  DEFAULT_CARET_SIZE,
  DEFAULT_CHOICE_GAP,
  DEFAULT_TAIL_LEAN,
} from "./theme.js";

// Zero-config, zero-asset default theme.
export { defaultTheme } from "./defaultTheme.js";

// Bundle factories.
export { createBoxDialogue } from "./createBoxDialogue.js";
export type { BoxDialogueOptions } from "./createBoxDialogue.js";
export {
  createBubbleDialogue,
  DEFAULT_BUBBLE,
} from "./createBubbleDialogue.js";
export type {
  BubbleDialogueOptions,
  BubbleGeometry,
} from "./createBubbleDialogue.js";
export { createMixedDialogue } from "./createMixedDialogue.js";
export type { MixedDialogueOptions } from "./createMixedDialogue.js";
