/**
 * @yagejs-addons/dialogue — root entry (headless + non-pixi).
 *
 * This barrel MUST NOT transitively import `pixi.js` or `@yagejs/renderer`.
 * It re-exports the headless dialogue model (runner, session, types, markup,
 * i18n, the canonical JSON loader plus the `parseExpr` and compact-DSL
 * front-ends), engine-scoped events, the `DialogueController` (a `@yagejs/core`
 * Component), public types, and the `@yagejs/input` keyboard/pointer bindings.
 *
 * Pixi-backed presenters (chrome, text views, composites, avatars, factories,
 * default/textured themes, radial) live behind the `./presenters` subpath so
 * the headless import path never pulls a renderer.
 */

// Headless dialogue model (engine-agnostic): runner, session, types, markup,
// i18n, canonical format.
export * from "./core/index.js";

// The thin YAGE host Component + its public option/bundle types.
export { DialogueController } from "./DialogueController.js";
export type {
  DialogueControllerOptions,
  DialogueBundle,
} from "./DialogueController.js";

// `Mountable` — the YAGE lifecycle (`mount(scene)` / `dispose()`) an extra
// channel implements when it needs the scene (e.g. a CameraEffects channel).
// Structurally pixi-free (`import type { Scene }` only), so re-exporting the
// type keeps the root dist-grep at 0. The presenter trio's adapter contracts
// (Chrome/Choice/Text presenters) stay behind `./presenters`.
export type { Mountable } from "./chrome/DialogueUiAdapter.js";

// Engine-scoped lifecycle / command events.
export {
  DialogueStartedEvent,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueCommandEvent,
  DialogueEndedEvent,
  DialogueRevealCompletedEvent,
  DialogueSelectionChangedEvent,
  DialogueSkipUsedEvent,
  DialogueAutoAdvanceEvent,
} from "./events.js";

// @yagejs/input device bindings (pixi-free).
export {
  KeyboardInputBinding,
  PointerInputBinding,
  CompositeInputBinding,
  fullControls,
  DEFAULT_ACTIONS,
  FULL_ACTIONS,
} from "./input/index.js";
export type {
  InputBinding,
  DialogueActions,
  PointerChoiceTarget,
} from "./input/index.js";
