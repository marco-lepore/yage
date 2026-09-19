/**
 * The one pointer-focus request a tick carries.
 *
 * An element records that the pointer passed over it or pressed it, and a
 * focus scope decides from its `pointerFocus` option which of the two moves
 * focus. A press outranks a hover. Between two requests of one kind the
 * deeper element wins: Pixi dispatches a pointer event along the whole
 * path, so a button inside a focusable row makes both ask, and the outer
 * one asks last.
 *
 * A scope takes the request once per tick, so a pointer resting on a row does
 * not pull focus back every frame. `UIFocusSystem` empties the cell at the
 * end of every frame, and an element clears its own request on teardown.
 */

import type { DisplayContainer } from "@yagejs/renderer";
import type { UIElement } from "../types.js";
import { getFocusState } from "./FocusState.js";

/** What the pointer did on the element asking for focus. */
export type PointerFocusTrigger = "hover" | "press";

/** The element the pointer reached this tick, and how it reached it. */
export interface PointerFocusRequest {
  readonly element: UIElement;
  readonly trigger: PointerFocusTrigger;
}

let requested: UIElement | null = null;
let requestedTrigger: PointerFocusTrigger = "hover";

/** Ask for focus on `element` because the pointer moved over it. */
export function requestHoverFocus(element: UIElement): void {
  record(element, "hover");
}

/** Ask for focus on `element` because the pointer pressed it. */
export function requestPressFocus(element: UIElement): void {
  record(element, "press");
}

/** Take this tick's request, leaving the cell empty. */
export function takePointerRequest(): PointerFocusRequest | null {
  const element = requested;
  if (element === null) return null;
  const trigger = requestedTrigger;
  requested = null;
  return { element, trigger };
}

/** Empty the cell at the end of a frame; no scope may have taken it. */
export function clearPointerRequest(): void {
  requested = null;
}

/** Drop a pending request for `element`, from the element's teardown. */
export function releasePointerRequest(element: UIElement): void {
  if (requested === element) requested = null;
}

/**
 * Rank a new request against the standing one. An element that is not
 * focusable asks for nothing, so a `focusable: false` button inside a
 * focusable row cannot mask the row.
 */
function record(element: UIElement, trigger: PointerFocusTrigger): void {
  if (getFocusState(element)?.focusable !== true) return;
  if (requested !== null) {
    if (requestedTrigger === "press" && trigger === "hover") return;
    if (requestedTrigger === trigger && contains(element, requested)) return;
  }
  requested = element;
  requestedTrigger = trigger;
}

/** Whether `inner` hangs under `outer` in the display tree. */
function contains(outer: UIElement, inner: UIElement): boolean {
  const root = outer.displayObject;
  let current: DisplayContainer | null = inner.displayObject.parent;
  while (current !== null) {
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}
