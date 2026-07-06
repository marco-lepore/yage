/**
 * InventoryTheme — the single flat visual-config object the inventory
 * factories consume. A theme is a plain data object (no behaviour) so it can
 * be authored inline, imported from a preset module, or serialized.
 *
 * The factory ({@link createInventoryPanel}) maps every field onto the
 * chrome / slots / detail / menu presenter configs; a presenter-config field
 * has the SAME name as the theme field it comes from, so drift is visible.
 * Cell geometry (columns, cell size, gaps) is NOT here — it is per-instance
 * layout, set on the factory options.
 *
 * {@link defaultInventoryTheme} returns a zero-asset instance (Graphics
 * chrome + canvas text, colored-tile icons), so the factories work with no
 * caller-supplied theme. Bitmap fonts (`bitmapFont`) are an OPT-IN
 * crisp-pixel path; item icons are opt-in per item via `ItemDef.icon`.
 *
 * **Theme = data, presets = code.** Any pure data a built-in renderer consumes
 * (colors, sizes, alphas, radii, texture keys/insets) is a theme field.
 * Drawing code goes in swappable cell presets; behavior stays in views.
 * Optional fields derive a sensible default when omitted so the built-in look
 * is reproduced with zero configuration.
 */

export interface InventoryTheme {
  /** Inner padding between the frame and its contents. */
  readonly padding: number;

  // --- Frame ---
  readonly frameColor: number;
  readonly frameAlpha: number;
  readonly borderColor: number;
  readonly cornerRadius: number;
  /** Panel-frame stroke width. Omit to derive `1.5`. Menu-frame, cell-border,
   *  and cursor stroke widths are presenter-internal. */
  readonly borderWidth?: number;

  // --- Header (title + slot counter) ---
  readonly titleSize: number;
  readonly titleColor: number;

  // --- Slot cells ---
  readonly cellColor: number;
  readonly cellBorderColor: number;
  /** Corner radius for the cell background and fallback tile. Omit to derive
   *  `cornerRadius / 2`. The selection cursor radius is `cellRadius + 1`
   *  (presenter-internal). */
  readonly cellRadius?: number;

  // --- Selection / highlights ---
  /** Selection cursor color (cell outline / row bar / menu highlight bar). */
  readonly highlightColor: number;
  /** Corner radius for the row-bar and menu-bar highlights. Omit to derive
   *  `max(cellRadius − 1, 0)`. */
  readonly highlightRadius?: number;
  /** Fill alpha for the row-bar selection highlight. Omit to derive `0.22`. */
  readonly rowHighlightAlpha?: number;
  /** Fill alpha for the scroll-hint triangles (▲/▼). Omit to derive `0.6`. */
  readonly hintAlpha?: number;

  // --- Content text ---
  readonly textSize: number;
  readonly textColor: number;
  readonly quantitySize: number;
  readonly quantityColor: number;
  /** Detail-pane description (dimmer than the body text). */
  readonly descriptionColor: number;
  /** Detail-pane description font size. Omit to derive `textSize - 2`. */
  readonly descriptionSize?: number;

  // --- Action menu ---
  readonly actionColor: number;
  readonly actionSelectedColor: number;
  readonly actionHighlightColor: number;
  /** Action-menu inner spacing and overlay style. Omit fields to derive:
   *  `padding` 10, `rowGap` 6, `highlightAlpha` 0.45. */
  readonly menu?: {
    readonly padding?: number;
    readonly rowGap?: number;
    /** Fill alpha for the action-menu highlight bar. Omit to derive `0.45`. */
    readonly highlightAlpha?: number;
  };

  // --- Detail band ---
  /** Height of the selected-item pane at the panel bottom. */
  readonly detailHeight: number;
  /** Gap between the header band and the content window. Omit to derive 10. */
  readonly headerGap?: number;
  /** Gap between the content window and the detail band. Omit to derive 10. */
  readonly detailGap?: number;

  // --- Tile fallback ---
  /** Fallback tile palette for icon-less items — a stable color is picked per
   *  item id. An item pins its own via `ItemDef.color`. */
  readonly tileColors?: readonly number[];
  /** Letter drawn on an icon-less tile (the item's initial), dark so it reads
   *  on the tinted tile. Omit to derive the default `0x1a1a2e`. */
  readonly tileLetterColor?: number;

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
