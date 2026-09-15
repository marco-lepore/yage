import type { InventoryBundle } from "@yagejs-addons/inventory";
import type { InventoryMessageKeys } from "./keys.js";
import { localizedActionMenu } from "./localizedActionMenu.js";
import { localizedChrome } from "./localizedChrome.js";
import { localizedDetail } from "./localizedDetail.js";
import { localizedSlots } from "./localizedSlots.js";

/**
 * Wrap every presenter in an inventory bundle so item names, descriptions,
 * action labels, and the header title follow the current locale. The
 * definitions keep their authored strings; `keys` maps ids to catalog keys.
 *
 * ```ts
 * const bundle = localizeInventoryPanel(createInventoryPanel(), {
 *   item: (id) => `item.${id}.name`,
 *   description: (id) => `item.${id}.description`,
 *   action: (id) => `action.${id}`,
 *   title: "inventory.title",
 * });
 * entity.add(new InventoryController({ ...bundle, inventory, title: "Backpack" }));
 * ```
 */
export function localizeInventoryPanel(
  bundle: InventoryBundle,
  keys: InventoryMessageKeys,
): InventoryBundle {
  return {
    slots: localizedSlots(bundle.slots, keys),
    ...(bundle.chrome ? { chrome: localizedChrome(bundle.chrome, keys) } : {}),
    ...(bundle.detail ? { detail: localizedDetail(bundle.detail, keys) } : {}),
    ...(bundle.actionMenu
      ? { actionMenu: localizedActionMenu(bundle.actionMenu, keys) }
      : {}),
  };
}
