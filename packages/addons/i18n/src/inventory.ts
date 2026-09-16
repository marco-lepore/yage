/**
 * @yagejs-addons/i18n/inventory — localized presenters for
 * `@yagejs-addons/inventory`. Wrap the bundle from `createInventoryPanel`
 * with {@link localizeInventoryPanel}, or wrap one presenter at a time.
 */
export { localizeInventoryPanel } from "./inventory/localizeInventoryPanel.js";
export {
  localizedSlots,
  localizeSlotView,
} from "./inventory/localizedSlots.js";
export { localizedDetail } from "./inventory/localizedDetail.js";
export { localizedActionMenu } from "./inventory/localizedActionMenu.js";
export { localizedChrome } from "./inventory/localizedChrome.js";
export {
  itemNameMessage,
  type InventoryMessageKeys,
} from "./inventory/keys.js";
