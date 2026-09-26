// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const WIDTH = 900;
export const HEIGHT = 560;
export const PAGE_COUNT = 4;

/** Seconds from entering a page to its first autoplay cue. */
export const AUTOPLAY_FIRST_DELAY = 0.6;
/** Seconds between autoplay cues, and from a key press to the next one. */
export const AUTOPLAY_INTERVAL = 1.7;

/** A backdrop panel. Its heading is centred at `titleY`. */
export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
  titleY: number;
}

export const ESSENTIAL_PANELS: readonly PanelRect[] = [
  { x: 40, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 325, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 610, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 40, y: 320, width: 820, height: 190, titleY: 342 },
];

export const MORE_PANELS: readonly PanelRect[] = [
  { x: 40, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 325, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 610, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 40, y: 320, width: 250, height: 190, titleY: 346 },
  { x: 325, y: 320, width: 250, height: 190, titleY: 346 },
  { x: 610, y: 320, width: 250, height: 190, titleY: 346 },
];

export const COMPACT_RECIPE_PANELS: readonly PanelRect[] = [
  { x: 40, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 325, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 610, y: 100, width: 250, height: 190, titleY: 126 },
  { x: 40, y: 320, width: 392, height: 190, titleY: 342 },
  { x: 468, y: 320, width: 392, height: 190, titleY: 342 },
];
