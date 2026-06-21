import { defineEvent } from "@yagejs/core";
import type { Command, RunMode } from "./core/types.js";

/**
 * Lifecycle + command events the {@link DialogueController} emits from its host
 * entity. A scene listens with `this.on(DialogueEndedEvent, …)` (events bubble
 * entity → scene). `DialogueCommandEvent` is the main game hook: every script
 * command that isn't a built-in (`set`) arrives here for the game to interpret.
 */
export const DialogueStartedEvent = defineEvent<{ scriptId: string }>("dialogue:started");

export const DialogueLineEvent = defineEvent<{
  speaker?: string | undefined;
  /** Plain (markup-stripped) text — handy for logs, a11y, history. */
  text: string;
}>("dialogue:line");

export const DialogueChoiceShownEvent = defineEvent<{ options: readonly string[] }>(
  "dialogue:choice-shown",
);

export const DialogueChoiceMadeEvent = defineEvent<{ index: number; text: string }>(
  "dialogue:choice-made",
);

export const DialogueCommandEvent = defineEvent<{ command: Command; mode: RunMode }>(
  "dialogue:command",
);

export const DialogueEndedEvent = defineEvent<{ scriptId: string }>("dialogue:ended");

/**
 * Lifecycle observation events. These are the moments games
 * actually hook — a "typing finished" blip, a choice-hover tick, skip-used
 * analytics, an auto-advance beat — emitted by the controller from the session's
 * observation callbacks (the one canonical observation path; there are no
 * matching controller callback options).
 */

/** A line finished its typewriter reveal — the "typing finished" hook. Plain
 *  (markup-stripped) text, mirroring {@link DialogueLineEvent}. */
export const DialogueRevealCompletedEvent = defineEvent<{
  speaker?: string | undefined;
  text: string;
}>("dialogue:reveal-completed");

/** The choice cursor moved (keyboard nav OR pointer hover) — `index` is the
 *  original option index, `text` its plain label. */
export const DialogueSelectionChangedEvent = defineEvent<{ index: number; text: string }>(
  "dialogue:selection-changed",
);

/** The player skipped the current section (skip-used analytics). */
export const DialogueSkipUsedEvent = defineEvent<{ scriptId: string }>(
  "dialogue:skip-used",
);

/** A line advanced on its own via the auto-advance clock (vs a manual advance). */
export const DialogueAutoAdvanceEvent = defineEvent<{ scriptId: string }>(
  "dialogue:auto-advance",
);
