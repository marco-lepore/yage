import type { Vec2Like } from "@yagejs/core";

/**
 * Geometry the focus selection reads — the `Interactor` builds one of these
 * per live, enabled `Interactable` each frame. `order` is the candidate's
 * registration order in the scene registry, used only to break an exact
 * distance tie deterministically.
 */
export interface InteractCandidate {
  readonly position: Vec2Like;
  readonly radius: number;
  readonly priority: number;
  readonly order: number;
}

/** The interactor's own position and reach, read by `selectFocus`. */
export interface FocusQuery {
  readonly position: Vec2Like;
  readonly range: number;
}

/** Options accepted by {@link Interactable}. */
export interface InteractableOptions {
  /** Fires when the interactor interacts while this is the focus. */
  readonly onInteract: () => void;
  /** Static or live label text. `undefined` = focusable but no prompt. */
  readonly prompt?: string | (() => string) | undefined;
  /** This interactable's own reach bonus, added to the interactor's range. */
  readonly radius?: number | undefined;
  /** Focus tie-break: higher wins over a nearer, lower-priority candidate. */
  readonly priority?: number | undefined;
  /** Static or live enabled gate. A disabled interactable is invisible to focus. */
  readonly enabled?: boolean | (() => boolean) | undefined;
}

/** Options accepted by {@link Interactor}. */
export interface InteractorOptions {
  /** The interactor's reach in world px. Default 48. */
  readonly range?: number | undefined;
  /** Action name polled for the interact edge, or `null` to disable auto-input. */
  readonly action?: string | null | undefined;
  /** Whether focus tracking + input polling runs. Default true. */
  readonly enabled?: boolean | undefined;
}
