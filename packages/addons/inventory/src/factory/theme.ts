/**
 * InventoryTheme — the single flat visual-config object the inventory
 * factories consume. A theme is a plain data object (no behaviour) so it can
 * be authored inline, imported from a preset module, or serialized.
 *
 * The factories ({@link createGridInventory}, {@link createListInventory})
 * map every field onto the chrome / slots / detail / menu presenter configs;
 * a presenter-config field has the SAME name as the theme field it comes
 * from, so drift is visible.
 *
 * {@link defaultInventoryTheme} returns a zero-asset instance (Graphics
 * chrome + canvas text, colored-tile icons), so the factories work with no
 * caller-supplied theme. Bitmap fonts (`bitmapFont`) are an OPT-IN
 * crisp-pixel path; item icons are opt-in per item via `ItemDef.icon`.
 */

export interface InventoryTheme {
  /**
   * Panel size (virtual px), centered in the viewport. The LIST panel uses it
   * verbatim; the GRID panel derives its size from the grid instead
   * (columns × cell size + bands) so cells never stretch — grid callers size
   * via `columns`/`visibleRows` on the factory options.
   */
  readonly panel: { readonly width: number; readonly height: number };
  /** Inner padding between the frame and its contents. */
  readonly padding: number;

  // --- Frame ---
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;

  // --- Header (title + slot counter) ---
  readonly titleSize: number;
  readonly titleColor: number;

  // --- Slot cells (grid) / rows (list) ---
  readonly cellSize: number;
  readonly cellGap: number;
  readonly cellColor: number;
  readonly cellBorderColor: number;
  /** Selection cursor (cell outline / row bar). */
  readonly highlightColor: number;

  // --- Content text ---
  readonly textSize: number;
  readonly textColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  /** Detail-pane description (dimmer than the body text). */
  readonly descriptionColor: number;

  // --- Action menu ---
  readonly actionColor: number;
  readonly actionSelectedColor: number;
  readonly actionHighlightColor: number;

  // --- Detail band ---
  /** Height of the selected-item pane at the panel bottom. */
  readonly detailHeight: number;

  /** Fallback tile palette for icon-less items — a stable color is picked per
   *  item id. An item pins its own via `ItemDef.color`. */
  readonly tileColors?: readonly number[];

  // --- Fonts (omit the bitmap field for canvas text) ---
  /** Baked bitmap-font name (OPT-IN). Omit for canvas text. */
  readonly bitmapFont?: string;
  /** Canvas font family (used when {@link bitmapFont} is omitted). */
  readonly fontFamily?: string;
  /** Canvas render resolution (used when not bitmap). */
  readonly resolution?: number;

  // --- Render layers (screen-space) ---
  /** The chrome frame + its dividers (below everything else the panel draws). */
  readonly layerPanel: string;
  /** Cells, cursor, icons, labels, quantities, detail text. */
  readonly layerContent: string;
  /** The action-menu popup. */
  readonly layerOverlay: string;
}

/** Default fallback tile palette (icon-less items pick a stable entry by id). */
export const DEFAULT_TILE_COLORS: readonly number[] = [
  0x7ec8ff, 0xffa07a, 0x98e698, 0xd8a0ff, 0xffd866, 0xff8899, 0x88ddd0, 0xc9c9de,
];
