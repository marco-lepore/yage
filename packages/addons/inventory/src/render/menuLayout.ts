/**
 * Pure layout math for the action menu: menu size from measured label widths,
 * anchored placement beside the selected cell (flipping left on overflow,
 * clamped into the panel), and the per-row rects. {@link ActionMenuView} feeds
 * it measured widths and hands the result to a {@link MenuSkinPresenter}; a
 * wholesale menu replacement reuses it the way `cellRect` serves the grid.
 * Renderer-free, so it unit-tests without a scene.
 */

import type { MenuSkinRow, Rect } from "../adapter.js";

export interface MenuLayoutInput {
  readonly labels: readonly string[];
  /** Rendered width of each label in px — the view measures these. */
  readonly labelWidths: readonly number[];
  /** The selected cell's rect to anchor beside, or undefined to center. */
  readonly anchor: Rect | undefined;
  /** The panel rect the menu is clamped into. */
  readonly panel: Rect;
  /** Inner margin between the menu frame and its rows. */
  readonly padding: number;
  /** Vertical gap between menu rows. */
  readonly rowGap: number;
  readonly textSize: number;
}

export interface MenuLayout {
  readonly menu: Rect;
  readonly rows: readonly MenuSkinRow[];
}

/** Menu frame rect + one rect per row, from measured label widths. */
export function layoutActionMenu(input: MenuLayoutInput): MenuLayout {
  const { labels, labelWidths, anchor, panel, padding, rowGap, textSize } = input;
  const rowHeight = textSize + rowGap;
  const widest = labelWidths.length > 0 ? Math.max(...labelWidths) : 0;
  const menuW = Math.ceil(widest) + 2 * padding + 8;
  const menuH = labels.length * rowHeight + 2 * padding - rowGap + 4;
  const { x, y } = placeMenu(menuW, menuH, anchor, panel);
  const rows = labels.map((label, i) => ({
    label,
    rect: {
      x: x + padding - 4,
      y: y + padding - 2 + i * rowHeight,
      width: menuW - 2 * (padding - 4),
      height: rowHeight,
    },
  }));
  return { menu: { x, y, width: menuW, height: menuH }, rows };
}

/** Beside the anchored cell (flipping left when it would overflow), clamped
 *  into the panel; no anchor → panel-centered. */
function placeMenu(
  menuW: number,
  menuH: number,
  anchor: Rect | undefined,
  panel: Rect,
): { x: number; y: number } {
  if (!anchor) {
    return {
      x: panel.x + (panel.width - menuW) / 2,
      y: panel.y + (panel.height - menuH) / 2,
    };
  }
  let x = anchor.x + anchor.width + 6;
  if (x + menuW > panel.x + panel.width) x = anchor.x - menuW - 6;
  let y = anchor.y;
  y = Math.min(y, panel.y + panel.height - menuH - 4);
  x = Math.max(x, panel.x + 4);
  y = Math.max(y, panel.y + 4);
  return { x, y };
}
