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

/** Fires when the ranked in-range set changes — a target enters or leaves, or
 *  two of them swap rank. Carries the whole ranked set (`inRange[0]` is the
 *  focus). The hook for a selection UI, which must also react to a *non-focused*
 *  target appearing or disappearing — something
 *  {@link InteractionFocusChangedEvent} does not report. */
export const InteractionInRangeChangedEvent = defineEvent<{
  inRange: readonly Interactable[];
}>("interaction:in-range-changed");

/** Fires when the interactor interacts with a target (auto-input edge, or a
 *  manual `interact()` / `interact(target)` call). */
export const InteractionPerformedEvent = defineEvent<{
  interactable: Interactable;
}>("interaction:performed");
