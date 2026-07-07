/**
 * @yagejs-addons/inventory — headless entry.
 *
 * Everything here is pixi-free: the model (catalog, Inventory, actions,
 * constraints, snapshot), the UI session + channel contracts, the YAGE
 * controller, engine events, and the device input bindings. The renderer
 * presenters (grid/list views, themes, factories) live behind the
 * `@yagejs-addons/inventory/presenters` subpath so this path never pulls
 * pixi / @yagejs/renderer.
 */

// --- Headless model (L1) ---
export { defineItems, instanceData, ItemCatalog, type DataMapOf } from "./core/catalog.js";
export { Inventory, type InventoryOptions } from "./core/Inventory.js";
export {
  byCatalogOrder,
  byCategory,
  byName,
  byQuantity,
  type SortEntry,
  type StackComparator,
} from "./core/comparators.js";
export type {
  ActionResult,
  AddResult,
  InstanceDataMap,
  InstanceToken,
  InventoryConstraint,
  InventoryEvents,
  InventoryReader,
  InventorySnapshot,
  ItemActionContext,
  ItemActionDef,
  ItemDef,
  ItemDefInput,
  ItemStack,
  ItemStackSnapshot,
  MoveEffect,
  MoveResult,
  Outcome,
  RejectReason,
  RemoveResult,
  SplitResult,
  StackPredicate,
  StackingMode,
  TransferResult,
} from "./core/types.js";

// --- UI session + channel contracts ---
export {
  InventorySession,
  type ActionMenuChannel,
  type DetailChannel,
  type InventoryChannels,
  type InventoryChromeChannel,
  type InventoryChromeInfo,
  type InventorySessionDriver,
  type InventorySessionOptions,
  type NavDirection,
  type PresentedAction,
  type SlotView,
  type SlotsChannel,
} from "./core/session.js";

// --- Presenter contracts (pixi-free adapter) ---
export type {
  ActionMenuPresenter,
  CellDefaults,
  CellHandle,
  CellPresenter,
  ChromePresenter,
  DetailPresenter,
  DiagnosticSink,
  HintsHandle,
  HintsPresenter,
  HintsState,
  InventoryBundle,
  MenuSkinHandle,
  MenuSkinPresenter,
  MenuSkinRow,
  Mountable,
  Rect,
  SlotsPresenter,
} from "./adapter.js";

// --- YAGE integration (L2) ---
export { InventoryController, type InventoryControllerOptions } from "./InventoryController.js";
export {
  InventoryActionEvent,
  InventoryChangedEvent,
  InventoryClosedEvent,
  InventoryItemAddedEvent,
  InventoryItemRemovedEvent,
  InventoryOpenedEvent,
  InventoryRejectedEvent,
  InventorySelectionChangedEvent,
} from "./events.js";

// --- Input bindings (over @yagejs/input — pixi-free, root entry on purpose) ---
export {
  CompositeInputBinding,
  INVENTORY_ACTIONS,
  inventoryControls,
  KeyboardInputBinding,
  PointerInputBinding,
  type InputBinding,
  type InventoryActions,
  type PointerActionTarget,
  type PointerSlotTarget,
  type PointerTargets,
} from "./input/index.js";
