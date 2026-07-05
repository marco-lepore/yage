/**
 * `createListInventory(theme)` — the name-list bundle (classic JRPG item
 * menu): a centered panel of `Name ×qty` rows with a highlight bar, plus the
 * same chrome / detail / action-menu trio as the grid. The panel takes its
 * size from `theme.panel` and fits as many rows as the content window holds
 * (override with `visibleRows`). Pairs naturally with an `autoCompact`
 * inventory (no holes in the list).
 */

import type { InventoryBundle } from "../adapter.js";
import { ListSlotsView } from "../render/ListSlotsView.js";
import { DETAIL_GAP, HEADER_GAP, PanelLayout } from "../render/PanelLayout.js";
import type { Rect } from "../render/gridGeometry.js";
import type { InventoryTheme } from "./theme.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import { chromeFor, contentHeight, detailFor, fitRows, menuFor, themeFonts } from "./shared.js";

export interface ListInventoryOptions {
  /** Scroll-window height in rows. Default: as many as the panel fits. */
  readonly visibleRows?: number;
  /** Wrap cursor navigation at the ends. Default false (clamp). */
  readonly wrap?: boolean;
  /** Panel frame + header. Default true. */
  readonly chrome?: boolean;
  /** Selected-item pane. Default true. */
  readonly detail?: boolean;
  /** Per-item action popup. Default true. */
  readonly actionMenu?: boolean;
  /** Pin the panel to this rect instead of centering it (embedded). */
  readonly bounds?: Rect;
}

export function createListInventory(
  theme: InventoryTheme = defaultInventoryTheme(),
  opts: ListInventoryOptions = {},
): InventoryBundle {
  const withChrome = opts.chrome ?? true;
  const withDetail = opts.detail ?? true;
  const fonts = themeFonts(theme);
  const rowHeight = theme.textSize + 12;
  const headerHeight = withChrome ? theme.titleSize + 6 : 0;
  const detailHeight = withDetail ? theme.detailHeight : 0;
  const headerGap = theme.headerGap ?? HEADER_GAP;
  const detailGap = theme.detailGap ?? DETAIL_GAP;

  const panelW = opts.bounds?.width ?? theme.panel.width;
  const panelH = opts.bounds?.height ?? theme.panel.height;
  const contentH = contentHeight(panelH, theme.padding, headerHeight, detailHeight, headerGap, detailGap);
  const visibleRows = opts.visibleRows ?? fitRows(contentH, rowHeight, 0);

  const layout = new PanelLayout({
    width: panelW,
    height: panelH,
    padding: theme.padding,
    headerHeight,
    detailHeight,
    headerGap,
    detailGap,
    bounds: opts.bounds,
  });

  const slots = new ListSlotsView(
    {
      rowHeight,
      visibleRows,
      wrap: opts.wrap,
      textSize: theme.textSize,
      textColor: theme.textColor,
      quantitySize: theme.quantitySize,
      quantityColor: theme.quantityColor,
      highlightColor: theme.highlightColor,
      layerContent: theme.layerContent,
      ...fonts,
    },
    layout,
  );

  return {
    slots,
    ...(withChrome ? { chrome: chromeFor(theme, layout, fonts) } : {}),
    ...(withDetail ? { detail: detailFor(theme, layout, fonts) } : {}),
    ...((opts.actionMenu ?? true)
      ? { actionMenu: menuFor(theme, layout, fonts, () => slots.selectionAnchor()) }
      : {}),
  };
}
