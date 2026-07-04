/**
 * @yagejs-addons/dialogue/presenters — pixi presentation entry.
 *
 * Everything that imports `@yagejs/renderer` / `pixi.js` lives here: chrome
 * (box / bubble / choice list / choice bubble), text views, composites,
 * avatars, factories, the zero-asset `defaultDialogueTheme()`, and the opt-in
 * @experimental radial choice presenter.
 *
 * Consumers reach this via the `./presenters` subpath
 * (`import { defaultDialogueTheme } from "@yagejs-addons/dialogue/presenters"`), which
 * keeps the headless root entry pixi-free.
 */

// ── render: text views, layers, per-glyph effects ──────────────────────────
export { DialogueTextView } from "./render/DialogueTextView.js";
export type { DialogueTextConfig } from "./render/DialogueTextView.js";
export { BubbleTextView } from "./render/BubbleTextView.js";
export { BoxTextView } from "./render/BoxTextView.js";
export {
  DIALOGUE_LAYERS,
  DIALOGUE_LAYER_FRAME,
  DIALOGUE_LAYER_TEXT,
  DIALOGUE_LAYER_AVATAR,
} from "./render/layers.js";
export { evaluateEffect, effectDrivesTint } from "./render/textEffects.js";
export type { EffectOutput } from "./render/textEffects.js";
// The per-line geometry owners (the "layout owner"), one per coordinate model —
// the single source of bubble sizing/anchor/origin and box frame + text region
// + the avatar-reflow inset registry, shared across each model's presenters so
// they can't drift.
export { BubbleLayout } from "./render/BubbleLayout.js";
export type { BubbleLayoutConfig } from "./render/BubbleLayout.js";
export { BoxLayout, stackChoiceRows } from "./render/BoxLayout.js";
export type {
  BoxLayoutConfig,
  BoxPosition,
  TextInset,
  ChoiceRowRect,
  Rect,
} from "./render/BoxLayout.js";
// Shared missing-actor anchor resolver (the BubbleLayout owns one internally;
// exported for a custom bubble presenter that wants the same policy).
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
  CompositeAvatarPresenter,
  makeDefaultRoute,
  fixedRoute,
  routeWithActor,
} from "./composite/index.js";
export type { CompositeRoute, MountRoute } from "./composite/index.js";

// ── avatars: portrait / scene-figure presenters + actor registry ───────────
export * from "./avatar/index.js";
export * from "./actor/index.js";

// ── factories + themes ──────────────────────────────────────────────────────
// The factory barrel owns: the bundle factories (createBox/Bubble/Mixed), the
// zero-asset `defaultDialogueTheme()`, the flat `DialogueTheme` (+ `BoxBounds`,
// `CaretTheme`, the textured `ChromeStyle`/`NineSliceFrame`/`NineSliceInsets`
// tokens, reserved chrome-style keys + theme-default consts), and bubble
// geometry (`DEFAULT_BUBBLE`, `BubbleGeometry`, `BubbleDialogueOptions`).
export * from "./factory/index.js";
