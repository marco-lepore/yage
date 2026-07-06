/**
 * @yagejs-addons/inventory/presenters — everything pixi.
 *
 * The one renderer-backed slot view and its swappable cell presets, the detail
 * pane, action menu, drawn chrome, the theme, the shared panel-geometry owner,
 * and the factory that assembles a wired {@link InventoryBundle} from one theme
 * object. Import from here only in code that renders; headless/game logic
 * imports the root entry.
 */

export { SlotsView, type SlotsViewConfig } from "./render/SlotsView.js";
export { iconCell } from "./render/iconCell.js";
export { rowCell } from "./render/rowCell.js";
export { DetailView, type DetailConfig } from "./render/DetailView.js";
export { ActionMenuView, type ActionMenuConfig, type ActionMenuViewOptions } from "./render/ActionMenuView.js";
export { InventoryChrome, type InventoryChromeConfig } from "./render/InventoryChrome.js";
export { PanelLayout, type PanelLayoutConfig } from "./render/PanelLayout.js";
export {
  cellAtPoint,
  cellNavigate,
  cellRect,
  cellRowCount,
  cellScrollRow,
  cellWindowSize,
  type CellGridSpec,
} from "./render/cellGeometry.js";
export { makeTextOptions, type FontConfig } from "./render/textOptions.js";
export {
  INVENTORY_LAYERS,
  INVENTORY_LAYER_CONTENT,
  INVENTORY_LAYER_OVERLAY,
  INVENTORY_LAYER_PANEL,
} from "./render/layers.js";
export {
  createInventoryPanel,
  type CellPresenterFactory,
  type InventoryPanelOptions,
} from "./factory/createInventoryPanel.js";
export { defaultInventoryTheme } from "./factory/defaultTheme.js";
export { DEFAULT_TILE_COLORS, type InventoryTheme } from "./factory/theme.js";
