/**
 * `createGridInventory(theme)` is the easy on-ramp: hand it one
 * {@link InventoryTheme} and get back the wired presenter bundle for a
 * centered grid panel (frame + header, icon cells with quantity badges, a
 * detail pane, and the action-menu popup). Spread it into a controller and
 * override any one piece:
 *
 *   host.add(new InventoryController({
 *     ...createGridInventory(theme),
 *     inventory,
 *   }));
 *
 * It only assembles configs + presenters from the theme — no scene, no input
 * — so the host stays in charge of lifecycle. All presenters share ONE
 * {@link PanelLayout}, and the panel SIZES ITSELF from the grid (columns ×
 * cell size + bands): size a grid panel via `columns`/`visibleRows`, not the
 * theme's `panel` field (that one is the list panel's).
 *
 * The embedded story is subtraction, not a different API: `chrome: false`
 * drops the frame, `bounds` pins the panel inside a host menu's own layout
 * (and derives `visibleRows` from the given height, so the host doesn't
 * hand-compute grid math), and the controller's `input: null` hands driving
 * over to the host.
 */

import type { InventoryBundle } from "../adapter.js";
import { GridSlotsView } from "../render/GridSlotsView.js";
import { DETAIL_GAP, HEADER_GAP, PanelLayout } from "../render/PanelLayout.js";
import { gridWindowSize, type Rect } from "../render/gridGeometry.js";
import type { InventoryTheme } from "./theme.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import { chromeFor, contentHeight, detailFor, fitRows, menuFor, themeFonts } from "./shared.js";

export interface GridInventoryOptions {
  /** Grid width in cells. Default 5. */
  readonly columns?: number;
  /** Scroll-window height in rows (total rows beyond it scroll). Default 4 —
   *  or, when `bounds` is given, as many rows as the bounds hold. Make
   *  `columns × visibleRows ≥ capacity` for a scroll-free grid. */
  readonly visibleRows?: number;
  /** Wrap cursor navigation at grid edges. Default false (clamp). */
  readonly wrap?: boolean;
  /** Panel frame + header. `false` for embedded panels whose host menu
   *  already draws chrome. Default true. */
  readonly chrome?: boolean;
  /** Selected-item pane at the panel bottom. Default true. */
  readonly detail?: boolean;
  /** Per-item action popup. `false` when the game handles confirm itself
   *  (picker flows). Default true. */
  readonly actionMenu?: boolean;
  /** Pin the panel to this rect instead of centering it in the viewport —
   *  the embedded-placement option. `visibleRows` defaults to what fits. */
  readonly bounds?: Rect;
}

export function createGridInventory(
  theme: InventoryTheme = defaultInventoryTheme(),
  opts: GridInventoryOptions = {},
): InventoryBundle {
  const columns = opts.columns ?? 5;
  const withChrome = opts.chrome ?? true;
  const withDetail = opts.detail ?? true;
  const fonts = themeFonts(theme);
  const headerHeight = withChrome ? theme.titleSize + 6 : 0;
  const detailHeight = withDetail ? theme.detailHeight : 0;
  const headerGap = theme.headerGap ?? HEADER_GAP;
  const detailGap = theme.detailGap ?? DETAIL_GAP;
  // Explicit bounds size the window; otherwise the window sizes the panel.
  const visibleRows =
    opts.visibleRows ??
    (opts.bounds
      ? fitRows(
          contentHeight(opts.bounds.height, theme.padding, headerHeight, detailHeight, headerGap, detailGap),
          theme.cellSize + theme.cellGap,
          theme.cellGap,
        )
      : 4);

  const grid = gridWindowSize({
    columns,
    cellSize: theme.cellSize,
    cellGap: theme.cellGap,
    visibleRows,
  });

  // The single geometry owner: panel sized around the grid window + bands.
  const layout = new PanelLayout({
    width: grid.width + 2 * theme.padding,
    height:
      grid.height +
      2 * theme.padding +
      (headerHeight > 0 ? headerHeight + headerGap : 0) +
      (detailHeight > 0 ? detailHeight + detailGap : 0),
    padding: theme.padding,
    headerHeight,
    detailHeight,
    headerGap,
    detailGap,
    bounds: opts.bounds,
  });

  const slots = new GridSlotsView(
    {
      columns,
      cellSize: theme.cellSize,
      cellGap: theme.cellGap,
      visibleRows,
      wrap: opts.wrap,
      cellColor: theme.cellColor,
      cellBorderColor: theme.cellBorderColor,
      highlightColor: theme.highlightColor,
      quantitySize: theme.quantitySize,
      quantityColor: theme.quantityColor,
      tileColors: theme.tileColors,
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
