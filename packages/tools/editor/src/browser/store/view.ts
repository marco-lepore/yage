import { clampStep, DEFAULT_STEP } from "./snap.js";
import type { EditorPoint, EditorViewState, ViewportSizes } from "./types.js";

/**
 * Where the view sits before the pane has been measured: the world origin, one
 * canvas pixel per world unit, with the guides drawn and gestures landing on
 * them. {@link openingView} refines the zoom once a measurement exists, which
 * is what a level actually opens at.
 */
export const DEFAULT_VIEW: EditorViewState = Object.freeze({
  center: Object.freeze({ x: 0, y: 0 }),
  zoom: 1,
  guides: true,
  snap: true,
  step: DEFAULT_STEP,
});

/**
 * How far the zoom can go. The bounds also keep `zoom` away from zero, which
 * every screen-to-world conversion divides by, and away from a value so large
 * that a pixel of pointer movement is below the precision a transform holds.
 */
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 20;

/** The key one level's view is stored under, unique to the project. */
export function viewStorageKey(projectId: string, path: string): string {
  return `yage-editor/view/${projectId}/${path}`;
}

/**
 * The part of `Storage` view persistence uses. `window.localStorage` satisfies
 * it, and naming it here keeps the store testable without a browser.
 */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function serializeView(view: EditorViewState): string {
  return JSON.stringify(view);
}

/**
 * A stored view, or `undefined` when there is none to read.
 *
 * Storage is outside the editor: the value can be absent, from an older build,
 * or hand-edited. Anything that is not a finite centre, a zoom, both switches,
 * and a step above zero is treated as nothing stored, so a bad entry costs the
 * remembered camera and nothing else.
 */
export function parseView(raw: string | null): EditorViewState | undefined {
  if (raw === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { center, zoom, guides, snap, step } =
    value as Partial<EditorViewState>;
  if (!isFiniteNumber(zoom) || zoom <= 0) return undefined;
  if (typeof guides !== "boolean") return undefined;
  if (typeof snap !== "boolean") return undefined;
  if (!isFiniteNumber(step) || step <= 0) return undefined;
  if (typeof center !== "object" || center === null) return undefined;
  if (!isFiniteNumber(center.x) || !isFiniteNumber(center.y)) return undefined;
  return normalizedView({
    center: { x: center.x, y: center.y },
    zoom,
    guides,
    snap,
    step,
  });
}

/** The same view with its zoom and its step brought inside their bounds. */
export function normalizedView(view: EditorViewState): EditorViewState {
  const zoom = clampZoom(view.zoom);
  const step = clampStep(view.step);
  return zoom === view.zoom && step === view.step
    ? view
    : { ...view, zoom, step };
}

/** The view moved by a world-space delta. */
export function pannedView(
  view: EditorViewState,
  by: EditorPoint,
): EditorViewState {
  return {
    ...view,
    center: { x: view.center.x + by.x, y: view.center.y + by.y },
  };
}

/**
 * The view zoomed by a factor around a world point, which stays where it is on
 * screen.
 *
 * The centre is re-derived from the zoom the clamp produced rather than the
 * factor that was asked for. Scaling by the requested factor at the limit
 * would slide the anchor across the screen while the picture stood still.
 */
export function zoomedViewAt(
  view: EditorViewState,
  factor: number,
  anchor: EditorPoint,
): EditorViewState {
  const zoom = clampZoom(view.zoom * factor);
  const ratio = view.zoom / zoom;
  return {
    ...view,
    center: {
      x: anchor.x + (view.center.x - anchor.x) * ratio,
      y: anchor.y + (view.center.y - anchor.y) * ratio,
    },
    zoom,
  };
}

/**
 * The view after the drawing surface changed size, with the world under its
 * top-left corner left where it is.
 *
 * A band opening under the picture takes world away from the bottom edge. It
 * is not a request to look somewhere else, and centring would slide the level
 * by half of whatever opened — which is the one thing a diagnostic arriving
 * mid-drag must not do.
 *
 * Returns `view` itself when nothing should move, so a caller can compare by
 * identity.
 */
export function viewAfterResize(
  view: EditorViewState,
  from: { readonly width: number; readonly height: number },
  to: { readonly width: number; readonly height: number },
): EditorViewState {
  if (!isMeasured(from) || !isMeasured(to)) return view;
  if (from.width === to.width && from.height === to.height) return view;
  return {
    ...view,
    center: {
      x: view.center.x + (to.width - from.width) / 2 / view.zoom,
      y: view.center.y + (to.height - from.height) / 2 / view.zoom,
    },
  };
}

/**
 * The camera back where it started, with the guides, the snap, and the step
 * left as they are: a reset is about where the developer is looking, not about
 * what the viewport draws for reference or where an edit lands.
 */
export function resetView(
  view: EditorViewState,
  viewport?: ViewportSizes | undefined,
): EditorViewState {
  return {
    ...openingView(viewport),
    guides: view.guides,
    snap: view.snap,
    step: view.step,
  };
}

/**
 * The view a level opens at when nothing is remembered for it: the world
 * origin, zoomed so the whole of the game's own picture fits the pane.
 *
 * The zoom counts canvas pixels per world unit, so fitting a picture
 * `design` units across into a pane `pane` pixels across is their ratio, and
 * the tighter of the two axes is the one that fits. That is the same rectangle
 * a game's `letterbox` fit draws, which is what makes a level open showing
 * what the game will show.
 *
 * With no measurement yet — before the preview has started — the zoom stays at
 * {@link DEFAULT_VIEW}'s, and the first measurement replaces it.
 */
export function openingView(
  viewport: ViewportSizes | undefined,
): EditorViewState {
  if (!viewport) return DEFAULT_VIEW;
  const { pane, design } = viewport;
  if (!isMeasured(pane) || !isMeasured(design)) return DEFAULT_VIEW;
  return {
    ...DEFAULT_VIEW,
    zoom: clampZoom(
      Math.min(pane.width / design.width, pane.height / design.height),
    ),
  };
}

/** The same view with its reference guides switched the other way. */
export function toggledGuides(view: EditorViewState): EditorViewState {
  return { ...view, guides: !view.guides };
}

/** The same view with snapping switched the other way. */
export function toggledSnap(view: EditorViewState): EditorViewState {
  return { ...view, snap: !view.snap };
}

/** The same view on a lattice of `step` world units, brought inside the bounds. */
export function withStep(view: EditorViewState, step: number): EditorViewState {
  return { ...view, step: clampStep(step) };
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function isMeasured(size: {
  readonly width: number;
  readonly height: number;
}): boolean {
  return (
    isFiniteNumber(size.width) &&
    isFiniteNumber(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
