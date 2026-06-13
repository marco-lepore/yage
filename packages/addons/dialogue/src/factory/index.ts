// Theme (flat visual config) + the opt-in texture sub-theme.
export type {
  DialogueTheme,
  BoxRect,
  TexturedTheme,
  NineSliceInsets,
} from "./theme.js";

// Zero-config, zero-asset default theme.
export { defaultTheme } from "./defaultTheme.js";

// Bundle factories.
export { createBoxDialogue } from "./createBoxDialogue.js";
export {
  createBubbleDialogue,
  DEFAULT_BUBBLE,
} from "./createBubbleDialogue.js";
export type {
  BubbleDialogueOptions,
  BubbleGeometry,
} from "./createBubbleDialogue.js";
export { createMixedDialogue } from "./createMixedDialogue.js";
