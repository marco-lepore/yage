/**
 * @yagejs-addons/dialogue — root entry (headless + non-pixi).
 *
 * This barrel MUST NOT transitively import `pixi.js` or `@yagejs/renderer`.
 * It re-exports the headless dialogue model (runner, session, types, markup,
 * i18n, canonical format), engine-scoped events, the `DialogueController`
 * (a `@yagejs/core` Component), public types, and the `@yagejs/input`
 * keyboard/pointer bindings.
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

// Engine-scoped lifecycle / command / glossary-term events.
export {
  DialogueStartedEvent,
  DialogueLineEvent,
  DialogueChoiceShownEvent,
  DialogueChoiceMadeEvent,
  DialogueCommandEvent,
  DialogueEndedEvent,
  DialogueTermActivatedEvent,
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
  TermTarget,
  TermActivation,
} from "./input/index.js";
