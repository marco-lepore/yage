/**
 * `createInventoryPanel(theme, opts)` is the on-ramp: hand it one
 * {@link InventoryTheme} and get back the wired presenter bundle for a centered
 * panel (frame + header, a windowed slot surface, a detail pane, and the
 * action-menu popup). Spread it into a controller and override any one piece:
 *
 *   host.add(new InventoryController({
 *     ...createInventoryPanel(theme),
 *     inventory,
 *   }));
 *
 * One factory covers every layout. The `cell` preset decides what a cell looks
 * like ({@link iconCell} — the default icon grid; {@link rowCell} — a text
 * row); the flat geometry options (`columns`, `visibleRows`, `cellWidth`,
 * `cellHeight`, `gap`) decide how cells are laid out. A single-column panel of
 * `rowCell`s is a "list"; a two-column panel is a text menu; the default is a
 * five-column icon grid.
 *
 * Geometry is resolved per axis (see `solvePanelGeometry`): whatever you leave
 * unset the preset's defaults fill; an explicit `bounds` pins the panel and
 * derives the missing count or extent to fit. The embedded story is
 * subtraction: `chrome: false` drops the frame, `bounds` pins the panel inside
 * a host menu's layout, and the controller's `input: null` hands driving over.
 */

import type { CellPresenter, InventoryBundle, Rect } from "../adapter.js";
import { SlotsView } from "../render/SlotsView.js";
import { iconCell } from "../render/iconCell.js";
import { cellWindowSize } from "../render/cellGeometry.js";
import { DETAIL_GAP, HEADER_GAP, PanelLayout } from "../render/PanelLayout.js";
import type { InventoryTheme } from "./theme.js";
import { defaultInventoryTheme } from "./defaultTheme.js";
import { chromeFor, contentHeight, detailFor, menuFor, themeFonts } from "./shared.js";
import { normalizeGap, solveAxis } from "./solvePanelGeometry.js";

/** Builds a cell preset from a theme. Assign it uncalled (`{ cell: rowCell }`);
 *  the factory calls it with the resolved theme. */
export type CellPresenterFactory = (theme: InventoryTheme) => CellPresenter;

export interface InventoryPanelOptions {
  /** Cell look. Default {@link iconCell} (an icon grid). {@link rowCell} draws
   *  text rows (a list at `columns: 1`). */
  readonly cell?: CellPresenterFactory;
  /** Cells per row. Default: the preset's (5 for icons, 1 for rows). With
   *  `bounds` and no `cellWidth`, derived to fit. */
  readonly columns?: number;
  /** Scroll-window height in rows (rows beyond it scroll). Default: the
   *  preset's. With `bounds` and no `cellHeight`, derived to fit. */
  readonly visibleRows?: number;
  /** Cell width. Default: the preset's. With `bounds` and no `columns`,
   *  derived from the bounds width. */
  readonly cellWidth?: number;
  /** Cell height. Default: the preset's. With `bounds` and no `visibleRows`,
   *  derived from the bounds height. */
  readonly cellHeight?: number;
  /** Gap between cells: one value for both axes, or `{ x, y }`. Default: the
   *  preset's. */
  readonly gap?: number | { readonly x: number; readonly y: number };
  /** Wrap cursor navigation at edges. Default false (clamp). */
  readonly wrap?: boolean;
  /** Panel frame + header. `false` for embedded panels whose host menu already
   *  draws chrome. Default true. */
  readonly chrome?: boolean;
  /** Selected-item pane at the panel bottom. Default true. */
  readonly detail?: boolean;
  /** Per-item action popup. `false` when the game handles confirm itself
   *  (picker flows). Default true. */
  readonly actionMenu?: boolean;
  /** Pin the panel to this rect instead of centering it in the viewport — the
   *  embedded-placement option. Missing count/extent knobs derive from it. */
  readonly bounds?: Rect;
}

export function createInventoryPanel(
  theme: InventoryTheme = defaultInventoryTheme(),
  opts: InventoryPanelOptions = {},
): InventoryBundle {
  const withChrome = opts.chrome ?? true;
  const withDetail = opts.detail ?? true;
  const fonts = themeFonts(theme);
  const headerHeight = withChrome ? theme.titleSize + 6 : 0;
  const detailHeight = withDetail ? theme.detailHeight : 0;
  const headerGap = theme.headerGap ?? HEADER_GAP;
  const detailGap = theme.detailGap ?? DETAIL_GAP;

  const cell = (opts.cell ?? iconCell)(theme);
  const gap = normalizeGap(opts.gap, cell.defaults);

  // `bounds` pins the panel and adds a per-axis size constraint; the solver
  // fills whatever count/extent the caller left unset.
  const availX = opts.bounds ? opts.bounds.width - 2 * theme.padding : undefined;
  const availY = opts.bounds
    ? contentHeight(opts.bounds.height, theme.padding, headerHeight, detailHeight, headerGap, detailGap)
    : undefined;
  const x = solveAxis({
    count: opts.columns,
    extent: opts.cellWidth,
    gap: gap.x,
    defaultCount: cell.defaults.columns,
    defaultExtent: cell.defaults.cellWidth,
    available: availX,
  });
  const y = solveAxis({
    count: opts.visibleRows,
    extent: opts.cellHeight,
    gap: gap.y,
    defaultCount: cell.defaults.visibleRows,
    defaultExtent: cell.defaults.cellHeight,
    available: availY,
  });

  const spec = {
    columns: x.count,
    visibleRows: y.count,
    cellWidth: x.extent,
    cellHeight: y.extent,
    gapX: gap.x,
    gapY: gap.y,
  };
  const win = cellWindowSize(spec);

  // The single geometry owner: panel sized around the window + bands (ignored
  // when `bounds` pins the panel).
  const layout = new PanelLayout({
    width: win.width + 2 * theme.padding,
    height:
      win.height +
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

  // An overdetermined axis (count + extent + bounds all given) keeps the
  // declared values and centers; warn at mount, where the sink exists.
  const mountWarnings: string[] = [];
  if (x.overdetermined && availX !== undefined) {
    mountWarnings.push(
      `inventory panel geometry is overdetermined on the horizontal axis: columns (${x.count}) and ` +
        `cellWidth (${x.extent}) were both given alongside bounds (${Math.round(availX)}px of content ` +
        `width) — keeping the declared values (window ${win.width}px) and centering it; drop one of ` +
        `columns/cellWidth or resize the bounds`,
    );
  }
  if (y.overdetermined && availY !== undefined) {
    mountWarnings.push(
      `inventory panel geometry is overdetermined on the vertical axis: visibleRows (${y.count}) and ` +
        `cellHeight (${y.extent}) were both given alongside bounds (${Math.round(availY)}px of content ` +
        `height) — keeping the declared values (window ${win.height}px) and centering it; drop one of ` +
        `visibleRows/cellHeight or resize the bounds`,
    );
  }

  const slots = new SlotsView(
    {
      columns: x.count,
      visibleRows: y.count,
      cellWidth: x.extent,
      cellHeight: y.extent,
      gapX: gap.x,
      gapY: gap.y,
      wrap: opts.wrap,
      hintColor: theme.highlightColor,
      hintAlpha: theme.hintAlpha ?? 0.6,
      layerContent: theme.layerContent,
      mountWarnings,
    },
    cell,
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
