/**
 * @yagejs-addons/interaction — headless entry (the only entry; no presenters).
 *
 * Pure `@yagejs/core`, with `@yagejs/input` as an optional peer: present, an
 * `Interactor` handles the interact key automatically; absent, the game
 * drives `interactor.interact()` itself. Nothing here imports pixi or
 * `@yagejs/renderer` — the game renders the prompt from
 * `InteractionFocusChangedEvent`.
 */

// --- Headless model (L1) ---
export { rankInteractables, selectInteractionFocus } from "./core/focus.js";
export { interactablesIn } from "./core/registry.js";
export type {
  FocusQuery,
  InteractableOptions,
  InteractCandidate,
  InteractorOptions,
} from "./core/types.js";

// --- Components (L2a) ---
export { Interactable } from "./Interactable.js";
export { Interactor } from "./Interactor.js";

// --- Events ---
export {
  InteractionFocusChangedEvent,
  InteractionInRangeChangedEvent,
  InteractionPerformedEvent,
} from "./events.js";
