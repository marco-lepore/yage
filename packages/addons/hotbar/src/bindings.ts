import type { HotbarActionResult, HotbarBinding } from "./core/types.js";

/**
 * The ability owner an {@link hotbarAbility} reads. `Abilities` from
 * `@yagejs-addons/abilities` matches it; the hotbar does not depend on that
 * package.
 */
export interface HotbarAbilitySource {
  canSend(intent: string, options: { readonly interrupts: boolean }): boolean;
  send(intent: string): HotbarActionResult;
  release(intent: string): boolean;
  cooldownRemaining(id: string): number;
  cooldownRatio(id: string): number;
}

/**
 * The item owner an {@link hotbarItem} reads. `Inventory` from
 * `@yagejs-addons/inventory` matches it; the hotbar does not depend on that
 * package.
 */
export interface HotbarItemSource<TItem extends string = string> {
  readonly catalog: {
    get(id: TItem): { readonly name: string; readonly icon?: string };
  };
  count(itemId: TItem): number;
  firstSlot(itemId: TItem): number | undefined;
  getActions(slot: number): readonly { readonly id: string }[];
  invokeAction(
    actionId: string,
    slot: number,
  ): { readonly ok: boolean; readonly reason?: string };
}

export interface HotbarAbilityOptions {
  readonly label: string;
  /** Registered renderer texture key. */
  readonly icon?: string;
}

export interface HotbarItemOptions {
  /** Inventory action to invoke, for example `"use"`. */
  readonly action: string;
  /** Default: the item's catalog `name`. */
  readonly label?: string;
  /** Default: the item's catalog `icon`. */
  readonly icon?: string;
}

/**
 * Bind an ability by its def id. Availability, cooldown and activation come
 * from the ability owner: `canSend` with interrupts, `cooldownRemaining`,
 * `cooldownRatio` and `send`. The slot shows the cooldown only while the
 * ability cannot be sent, so a combo step or linger window stays usable
 * while the cooldown runs. Releasing the input calls `release`, which ends a
 * hold phase and does nothing for other abilities.
 */
export function hotbarAbility(
  abilities: HotbarAbilitySource,
  id: string,
  options: HotbarAbilityOptions,
): HotbarBinding {
  return {
    label: options.label,
    ...(options.icon !== undefined && { icon: options.icon }),
    read: () => {
      // `send` accepts a combo step or linger intent during the cooldown,
      // and a running cooldown would block the slot.
      if (abilities.canSend(id, { interrupts: true })) return {};
      const remaining = abilities.cooldownRemaining(id);
      if (remaining === 0) return { available: false, reason: "busy" };
      // No reason is set, so the slot reports "cooldown".
      return {
        available: false,
        cooldown: { remaining, ratio: abilities.cooldownRatio(id) },
      };
    },
    activate: () => abilities.send(id),
    release: () => {
      abilities.release(id);
    },
  };
}

/**
 * Bind an item kind to one of its inventory actions. The count covers every
 * stack of the item. Activation invokes the action on the item's first
 * stack, so `consumes` and the action's `available` apply as they do in the
 * inventory, and the game applies the effect from the inventory's action
 * event.
 */
export function hotbarItem<TItem extends string>(
  inventory: HotbarItemSource<TItem>,
  item: NoInfer<TItem>,
  options: HotbarItemOptions,
): HotbarBinding {
  const def = inventory.catalog.get(item);
  const icon = options.icon ?? def.icon;
  const offered = (slot: number): boolean =>
    inventory.getActions(slot).some((action) => action.id === options.action);
  return {
    label: options.label ?? def.name,
    ...(icon !== undefined && { icon }),
    read: () => {
      const count = inventory.count(item);
      const slot = inventory.firstSlot(item);
      if (slot === undefined)
        return { count, available: false, reason: "empty" };
      return offered(slot) ? { count } : { count, available: false };
    },
    activate: () => {
      const slot = inventory.firstSlot(item);
      if (slot === undefined) return { ok: false, reason: "empty" };
      const result = inventory.invokeAction(options.action, slot);
      if (result.ok) return { ok: true };
      return {
        ok: false,
        reason: result.reason === "empty" ? "empty" : "unavailable",
      };
    },
  };
}
