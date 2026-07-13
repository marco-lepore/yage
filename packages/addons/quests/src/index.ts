/**
 * @yagejs-addons/quests — headless quest log with objectives, prerequisite
 * chains, and automatic or explicit completion.
 *
 * Pure `@yagejs/core`: no dialogue/inventory/renderer dependency. Objectives
 * bind to other addons' events (or the game's own) through game-authored
 * one-liners — `log.advance(quest, objective)` on any pickup/kill/dialogue
 * command; the log silently no-ops when the quest isn't currently active, so
 * no adapter needs an active-state guard. No presenters in v1 — a journal or
 * tracker HUD reads `log.active()`/`log.get()` directly.
 */

// --- Headless model (L1) ---
export {
  defineQuests,
  QuestCatalog,
  QuestLog,
  type ObjectiveDef,
  type ObjectiveDefInput,
  type ObjectiveIdOf,
  type QuestDef,
  type QuestDefInput,
  type QuestEvents,
  type QuestId,
  type QuestSnapshot,
  type QuestStartResult,
  type QuestState,
  type QuestStateSnapshot,
  type QuestStatus,
} from "./core/index.js";

// --- YAGE integration (L2a, optional) ---
export { QuestController, type QuestControllerOptions } from "./QuestController.js";
export {
  QuestChangedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  QuestObjectiveProgressChangedEvent,
  QuestObjectiveCompletedEvent,
  QuestStartedEvent,
} from "./events.js";
