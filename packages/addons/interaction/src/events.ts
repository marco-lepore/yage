import { defineEvent } from "@yagejs/core";
import type { Interactable } from "./Interactable.js";

/**
 * Events an `Interactor` emits on its host entity. A scene listens with
 * `entity.on(InteractionFocusChangedEvent, …)` (events bubble entity → scene).
 */

/** Fires only on a transition: the focused interactable changes, or its
 *  resolved prompt text changes. Leaving all ranges emits
 *  `{ interactable: null, prompt: null }`. The prompt-render hook. */
export const InteractionFocusChangedEvent = defineEvent<{
  interactable: Interactable | null;
  prompt: string | null;
}>("interaction:focus-changed");

/** Fires when the interactor interacts with its current focus (auto-input
 *  edge or a manual `interact()` call). */
export const InteractedEvent = defineEvent<{
  interactable: Interactable;
}>("interaction:interacted");
