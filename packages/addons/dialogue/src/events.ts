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
