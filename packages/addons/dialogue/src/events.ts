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
  speaker?: string;
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
 * A `[term=…]` glossary span was activated (pointer hover/tap routed through the
 * text presenter's `termAtPoint` seam). The system only emits the opaque term
 * `id` plus the activating pointer's screen position — the game maps the id to a
 * definition and renders any tooltip. `kind` distinguishes a hover from a commit
 * tap so a host can show-on-hover / pin-on-tap.
 */
export const DialogueTermActivatedEvent = defineEvent<{
  /** Opaque glossary id from `[term=<id>]…[/term]`. */
  id: string;
  /** Pointer position (screen px) when the term was activated. */
  screen: { x: number; y: number };
  /** "hover" while the pointer rests over the span; "tap" on a primary click. */
  kind: "hover" | "tap";
}>("dialogue:term-activated");
