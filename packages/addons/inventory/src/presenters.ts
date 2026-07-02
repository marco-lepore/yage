/**
 * @yagejs-addons/inventory/presenters — everything pixi.
 *
 * The default renderer-backed views (grid cells, name list, detail pane,
 * action menu, drawn chrome), the theme, the shared panel-geometry owner,
 * and the factories that assemble a wired {@link InventoryBundle} from one
 * theme object. Import from here only in code that renders; headless/game
 * logic imports the root entry.
 */

export { GridSlotsView, type GridSlotsConfig } from "./render/GridSlotsView.js";
export { ListSlotsView, type ListSlotsConfig } from "./render/ListSlotsView.js";
export { DetailView, type DetailConfig } from "./render/DetailView.js";
export { ActionMenuView, type ActionMenuConfig, type ActionMenuViewOptions } from "./render/ActionMenuView.js";
export { InventoryChrome, type InventoryChromeConfig } from "./render/InventoryChrome.js";
export { PanelLayout, type PanelLayoutConfig } from "./render/PanelLayout.js";
export {
  gridCellRect,
  gridNavigate,
  gridRows,
  gridScrollRow,
  gridSlotAtPoint,
  gridWindowSize,
  type GridSpec,
  type Rect,
} from "./render/gridGeometry.js";
export {
  listNavigate,
  listRowAtPoint,
  listRowRect,
  listScrollOffset,
  type ListSpec,
} from "./render/listGeometry.js";
export { makeTextOptions, type FontConfig } from "./render/textOptions.js";
export {
  INVENTORY_LAYERS,
  INVENTORY_LAYER_CONTENT,
  INVENTORY_LAYER_OVERLAY,
  INVENTORY_LAYER_PANEL,
} from "./render/layers.js";
export { createGridInventory, type GridInventoryOptions } from "./factory/createGridInventory.js";
export { createListInventory, type ListInventoryOptions } from "./factory/createListInventory.js";
export { defaultInventoryTheme } from "./factory/defaultTheme.js";
export { DEFAULT_TILE_COLORS, type InventoryTheme } from "./factory/theme.js";
