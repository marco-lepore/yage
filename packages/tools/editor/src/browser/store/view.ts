import { clampStep, DEFAULT_STEP } from "./snap.js";
import type { EditorPoint, EditorViewState } from "./types.js";

/**
 * Where the view sits with nothing stored: the world origin, unzoomed, with
 * the guides drawn and gestures landing on them.
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
 * The camera back where it started, with the guides, the snap, and the step
 * left as they are: a reset is about where the developer is looking, not about
 * what the viewport draws for reference or where an edit lands.
 */
export function resetView(view: EditorViewState): EditorViewState {
  return {
    ...DEFAULT_VIEW,
    guides: view.guides,
    snap: view.snap,
    step: view.step,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
