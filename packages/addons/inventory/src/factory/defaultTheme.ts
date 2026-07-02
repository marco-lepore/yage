import type { InventoryTheme } from "./theme.js";
import {
  INVENTORY_LAYER_CONTENT,
  INVENTORY_LAYER_OVERLAY,
  INVENTORY_LAYER_PANEL,
} from "../render/layers.js";

/**
 * defaultInventoryTheme — a zero-config, zero-asset {@link InventoryTheme}.
 *
 * Renders entirely with Graphics (rounded rectangles + strokes) and canvas
 * text; icon-less items get a colored tile with the item's initial. The
 * palette matches the dialogue addon's default theme, so the two panels read
 * as one UI out of the box.
 *
 * Returns a fresh object each call so callers can spread-and-tweak without
 * mutating a shared singleton:
 *
 * ```ts
 * const theme = { ...defaultInventoryTheme(), highlightColor: 0xff5555 };
 * ```
 */
export function defaultInventoryTheme(): InventoryTheme {
  return {
    // The LIST panel size; the grid derives its own from columns × cells.
    panel: { width: 420, height: 380 },
    padding: 16,

    frameColor: 0x1a1a2e,
    // Near-opaque: a menu panel covers world content it sits on (unlike the
    // dialogue bar at the screen edge), so bleed-through reads as noise.
    frameAlpha: 0.97,
    borderColor: 0x4a4a8a,
    cornerRadius: 8,

    titleSize: 16,
    titleColor: 0xffd866,

    cellSize: 56,
    cellGap: 6,
    cellColor: 0x262643,
    cellBorderColor: 0x42426b,
    highlightColor: 0xffd866,

    textSize: 15,
    textColor: 0xf0f0f0,
    quantitySize: 12,
    quantityColor: 0xffd866,
    descriptionColor: 0xa8a8c8,

    actionColor: 0xaaaaaa,
    actionSelectedColor: 0xffffff,
    actionHighlightColor: 0x4a4a8a,

    detailHeight: 64,

    // No bitmapFont → canvas text path (zero assets).
    fontFamily: "sans-serif",

    layerPanel: INVENTORY_LAYER_PANEL,
    layerContent: INVENTORY_LAYER_CONTENT,
    layerOverlay: INVENTORY_LAYER_OVERLAY,
  };
}
