import { defineEvent } from "@yagejs/core";
import type { RejectReason } from "./core/types.js";

/**
 * Events the {@link InventoryController} emits from its host entity. A scene
 * listens with `this.on(InventoryActionEvent, …)` (events bubble entity →
 * scene). Two groups:
 *
 * - **Model events** mirror the {@link Inventory}'s own emitter onto the
 *   engine bus — they fire on EVERY mutation of the controller's current
 *   inventory, UI open or not (a pickup while the panel is closed still
 *   emits `InventoryItemAddedEvent`).
 * - **Session events** describe the UI (opened/closed/cursor).
 *
 * `InventoryActionEvent` is the main game hook: apply the consequence of
 * "Use" / "Drop" / your own verbs there.
 */

// --- Session (UI) events ---

export const InventoryOpenedEvent = defineEvent("inventory:opened");
export const InventoryClosedEvent = defineEvent("inventory:closed");

/** The cursor moved to another slot (keyboard nav or pointer hover).
 *  `itemId` is null on an empty cell. */
export const InventorySelectionChangedEvent = defineEvent<{
  slot: number;
  itemId: string | null;
}>("inventory:selection-changed");

// --- Model events (mirrored from the current Inventory) ---

/** An item action was invoked ("Use", "Drop", …) — apply its consequence
 *  here. `quantity` is the stack size at invocation (before any `consumes`
 *  removal); `consumes` is whether the model removed one unit after emitting. */
export const InventoryActionEvent = defineEvent<{
  actionId: string;
  slot: number;
  itemId: string;
  quantity: number;
  consumes: boolean;
}>("inventory:action");

/** Units entered the inventory (pickup feedback, quest counters). */
export const InventoryItemAddedEvent = defineEvent<{
  itemId: string;
  quantity: number;
  slots: readonly number[];
}>("inventory:item-added");

/** Units left the inventory. */
export const InventoryItemRemovedEvent = defineEvent<{
  itemId: string;
  quantity: number;
}>("inventory:item-removed");

/** An add was (partly) refused — the "inventory full!" toast hook.
 *  `constraintId` is set only when `reason` is `"constraint"`: the id of the
 *  most limiting {@link InventoryConstraint}, so a weight-limit toast and a
 *  quest-gate toast can differ. */
export const InventoryRejectedEvent = defineEvent<{
  itemId: string;
  quantity: number;
  reason: RejectReason;
  constraintId?: string;
}>("inventory:rejected");

/** Any mutation, with the affected slot indices — the coarse observation
 *  signal (HUD counters, autosave triggers). */
export const InventoryChangedEvent = defineEvent<{
  slots: readonly number[];
}>("inventory:changed");
