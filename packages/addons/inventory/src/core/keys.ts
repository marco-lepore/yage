/**
 * Catalog keys for inventory text. Items and actions are authored with literal
 * strings; those literals stay the fallback, and the key a translation is
 * looked up under is derived from the id — so a game adds a catalog without
 * changing a single item definition.
 */

/**
 * Maps an inventory id to the catalog key its text is looked up under. Pass a
 * custom one as `keys` on {@link InventoryController} to match a catalog that
 * is already organised differently; the game then owns the final keys and
 * their collision-avoidance.
 *
 * Keys are part of a saved binding descriptor, so changing them after release
 * needs a catalog migration.
 */
export interface InventoryKeys {
  /** Key for an item's display name. */
  itemName(itemId: string): string;
  /** Key for an item's long description. */
  itemDescription(itemId: string): string;
  /** Key for an item action's menu label. */
  actionLabel(actionId: string): string;
}

/**
 * The default key scheme: `inventory.item.<id>.name`,
 * `inventory.item.<id>.description`, `inventory.action.<id>.label`. The
 * `inventory.` prefix keeps these disjoint from other addons' keys.
 */
export const defaultInventoryKeys: InventoryKeys = {
  itemName: (itemId) => `inventory.item.${itemId}.name`,
  itemDescription: (itemId) => `inventory.item.${itemId}.description`,
  actionLabel: (actionId) => `inventory.action.${actionId}.label`,
};
