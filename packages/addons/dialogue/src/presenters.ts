/**
 * @yagejs-addons/dialogue/presenters — pixi presentation entry.
 *
 * Everything that imports `@yagejs/renderer` / `pixi.js` lives here: chrome
 * (box / bubble / choice list / choice bubble), text views, composites,
 * avatars, factories, the zero-asset `defaultTheme()`, and the opt-in
 * @experimental radial choice presenter.
 *
 * Consumers reach this via the `./presenters` subpath
 * (`import { defaultTheme } from "@yagejs-addons/dialogue/presenters"`), which
 * keeps the headless root entry pixi-free.
 */

// ── render: text views, layers, per-glyph effects ──────────────────────────
export { DialogueTextView } from "./render/DialogueTextView.js";
export type { DialogueTextConfig } from "./render/DialogueTextView.js";
export { BubbleTextView } from "./render/BubbleTextView.js";
export type { BubbleTextLayout } from "./render/BubbleTextView.js";
export {
  DIALOGUE_LAYERS,
  DIALOGUE_LAYER_FRAME,
  DIALOGUE_LAYER_TEXT,
  DIALOGUE_LAYER_AVATAR,
} from "./render/layers.js";
export { evaluateEffect, effectDrivesTint } from "./render/textEffects.js";
export type { EffectOutput } from "./render/textEffects.js";
// Shared missing-actor anchor resolver (D3) — the single owner of bubble
// last-known/fallback positioning, reused by all three bubble presenters.
export { BubbleAnchorResolver } from "./render/bubbleAnchor.js";
export type { AnchorPoint } from "./render/bubbleAnchor.js";

// ── chrome: frames, nameplates, choice lists ───────────────────────────────
// Presenter adapter contracts (pixi-free; also reachable from the root entry
// via the controller, but re-exported here so presenter consumers find them
// alongside the concrete presenters).
export type {
  Mountable,
  ChromePresenter,
  ChoicePresenter,
  TextPresenter,
  DiagnosticSink,
} from "./chrome/DialogueUiAdapter.js";
// The font triplet shared by every presenter config ({bitmapFont, fontFamily,
// resolution}); themes map onto it via the factories.
export type { FontConfig } from "./chrome/textOptions.js";
export { DialogueChrome } from "./chrome/DialogueChrome.js";
export type { DialogueChromeConfig } from "./chrome/DialogueChrome.js";
export { ChoiceListPresenter } from "./chrome/ChoiceListPresenter.js";
export type { ChoiceListConfig } from "./chrome/ChoiceListPresenter.js";
export { BubbleChrome } from "./chrome/BubbleChrome.js";
export type { BubbleChromeConfig } from "./chrome/BubbleChrome.js";
export { BubbleChoicePresenter } from "./chrome/BubbleChoicePresenter.js";
export type { BubbleChoiceConfig } from "./chrome/BubbleChoicePresenter.js";

/**
 * Opt-in @experimental radial choice wheel. Not part of the default factory
 * bundles; an unpolished spike whose geometry/API may change.
 */
export { RadialChoicePresenter } from "./chrome/RadialChoicePresenter.js";
export type { RadialChoiceConfig } from "./chrome/RadialChoicePresenter.js";

// ── composites: route box vs bubble by per-line `view` + speaker ───────────
export {
  CompositeTextPresenter,
  CompositeChrome,
  CompositeChoicePresenter,
  defaultCompositeRoute,
} from "./composite/index.js";
export type { CompositeRoute } from "./composite/index.js";

// ── avatars: portrait / scene-figure presenters + actor registry ───────────
export * from "./avatar/index.js";
export * from "./actor/index.js";

// ── factories + themes ──────────────────────────────────────────────────────
// The factory barrel owns: the bundle factories (createBox/Bubble/Mixed), the
// zero-asset `defaultTheme()`, the flat `DialogueTheme` (+ `BoxRect`,
// `TexturedTheme`, `NineSliceInsets`) tokens, and bubble geometry
// (`DEFAULT_BUBBLE`, `BubbleGeometry`, `BubbleDialogueOptions`).
export * from "./factory/index.js";
