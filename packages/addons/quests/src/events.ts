import { defineEvent } from "@yagejs/core";

/**
 * Engine-bus events the {@link QuestController} mirrors from a {@link QuestLog}
 * onto its host entity (events bubble entity -> scene: `scene.on(QuestCompletedEvent,
 * …)`). Payload ids are `string` — the controller is generic over the catalog's
 * `TDefs` for a typed `.log`, but these bus events widen to plain strings so a
 * HUD/achievements listener doesn't need the game's literal quest-id union.
 */

export const QuestStartedEvent = defineEvent<{ questId: string }>("quest:started");

export const QuestObjectiveAdvancedEvent = defineEvent<{
  questId: string;
  objectiveId: string;
  progress: number;
  count: number;
  done: boolean;
}>("quest:objective-advanced");

export const QuestObjectiveCompletedEvent = defineEvent<{
  questId: string;
  objectiveId: string;
}>("quest:objective-completed");

export const QuestCompletedEvent = defineEvent<{ questId: string }>("quest:completed");

export const QuestFailedEvent = defineEvent<{ questId: string }>("quest:failed");

/** Coarse re-render signal — mirrors the model's `changed` event. */
export const QuestChangedEvent = defineEvent<{ questId: string }>("quest:changed");
