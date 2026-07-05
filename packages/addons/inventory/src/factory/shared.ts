/**
 * Pieces shared by the bundle factories: theme → presenter-config mapping for
 * the chrome / detail / action-menu trio (identical across grid and list) and
 * the bounds-fitting math. Internal — the factories are the public surface.
 */

import { ActionMenuView } from "../render/ActionMenuView.js";
import { DetailView } from "../render/DetailView.js";
import { InventoryChrome } from "../render/InventoryChrome.js";
import type { PanelLayout } from "../render/PanelLayout.js";
import type { Rect } from "../render/gridGeometry.js";
import type { FontConfig } from "../render/textOptions.js";
import type { InventoryTheme } from "./theme.js";

/** Action-menu spacing used when the theme omits `menu.*`. */
const DEFAULT_MENU_PADDING = 10;
const DEFAULT_MENU_ROW_GAP = 6;

/** The font triplet shared by every presenter config. */
export function themeFonts(theme: InventoryTheme): FontConfig {
  return {
    bitmapFont: theme.bitmapFont,
    fontFamily: theme.fontFamily,
    resolution: theme.resolution,
  };
}

export function chromeFor(
  theme: InventoryTheme,
  layout: PanelLayout,
  fonts: FontConfig,
): InventoryChrome {
  return new InventoryChrome(
    {
      frameColor: theme.frameColor,
      frameAlpha: theme.frameAlpha,
      borderColor: theme.borderColor,
      cornerRadius: theme.cornerRadius,
      titleSize: theme.titleSize,
      titleColor: theme.titleColor,
      quantitySize: theme.quantitySize,
      quantityColor: theme.quantityColor,
      layerPanel: theme.layerPanel,
      layerContent: theme.layerContent,
      ...fonts,
    },
    layout,
  );
}

export function detailFor(theme: InventoryTheme, layout: PanelLayout, fonts: FontConfig): DetailView {
  return new DetailView(
    {
      textSize: theme.textSize,
      textColor: theme.textColor,
      descriptionColor: theme.descriptionColor,
      descriptionSize: theme.descriptionSize ?? theme.textSize - 2,
      layerContent: theme.layerContent,
      ...fonts,
    },
    layout,
  );
}

export function menuFor(
  theme: InventoryTheme,
  layout: PanelLayout,
  fonts: FontConfig,
  anchor: () => Rect | undefined,
): ActionMenuView {
  return new ActionMenuView(
    {
      textSize: theme.textSize,
      actionColor: theme.actionColor,
      actionSelectedColor: theme.actionSelectedColor,
      actionHighlightColor: theme.actionHighlightColor,
      frameColor: theme.frameColor,
      frameAlpha: theme.frameAlpha,
      borderColor: theme.borderColor,
      cornerRadius: theme.cornerRadius,
      padding: theme.menu?.padding ?? DEFAULT_MENU_PADDING,
      rowGap: theme.menu?.rowGap ?? DEFAULT_MENU_ROW_GAP,
      layerOverlay: theme.layerOverlay,
      ...fonts,
    },
    layout,
    { anchor },
  );
}

/**
 * Rows of `step`-sized cells (last one gapless) that fit in `available`
 * vertical px — how a `bounds`-pinned panel derives its scroll window instead
 * of making the caller hand-compute grid math. Never below 1.
 */
export function fitRows(available: number, step: number, gap: number): number {
  return Math.max(1, Math.floor((available + gap) / step));
}

/** The vertical px left for slot content inside a panel of `height`. */
export function contentHeight(
  height: number,
  padding: number,
  headerHeight: number,
  detailHeight: number,
  headerGap: number,
  detailGap: number,
): number {
  return (
    height -
    2 * padding -
    (headerHeight > 0 ? headerHeight + headerGap : 0) -
    (detailHeight > 0 ? detailHeight + detailGap : 0)
  );
}
