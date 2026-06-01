// Theme (flat visual config) + opt-in texture/portrait sub-themes.
export type {
  DialogueTheme,
  BoxRect,
  PortraitTheme,
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

// Opt-in textured (nine-slice) chrome variants + their configs.
export { TexturedChrome } from "../chrome/TexturedChrome.js";
export type { TexturedChromeConfig } from "../chrome/TexturedChrome.js";
export { TexturedBubble } from "../chrome/TexturedBubble.js";
export type { TexturedBubbleConfig } from "../chrome/TexturedBubble.js";
