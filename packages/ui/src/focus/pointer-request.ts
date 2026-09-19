/**
 * The one pointer-focus request a tick carries.
 *
 * An element records what the pointer did to it — passed over it, or pressed
 * it — and a focus scope decides from its own `pointerFocus` option which of
 * the two moves focus. The cell holds one request, ranked two ways. A press
 * outranks a hover, because a press is where the player aimed and a hover is
 * where the pointer passed. Between two requests of one kind the deeper
 * element wins: Pixi dispatches a pointer event along the whole composed
 * path, so a button inside a focusable row makes both elements ask from one
 * event and the outermost writes last.
 *
 * A focus scope takes the request once per tick and clears it, so a pointer
 * resting on one row does not pull focus back every frame while the arrow
 * keys walk the list. On a frame where no scope is driven nothing takes it,
 * so `UIFocusSystem` empties the cell at the end of every frame and an
 * element clears its own request as it is torn down. Between the two, the
 * cell never holds an element past the frame the pointer reached it.
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

/**
 * Ask for focus on `element` because the pointer moved over it. A scope set
 * to `"hover"` acts on this; every other setting leaves focus alone, and the
 * element's own hovered look is painted either way by the listener beside
 * this call.
 */
export function requestHoverFocus(element: UIElement): void {
  record(element, "hover");
}

/**
 * Ask for focus on `element` because the pointer pressed it. This is what
 * the default `pointerFocus: "press"` acts on: clicking a control is a
 * deliberate act, so the keyboard follows the player there.
 */
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

/**
 * Empty the cell at the end of a frame, whoever asked. A frame in which no
 * scope is driven has no consumer, and a request left behind would hold its
 * element until the next pointer move replaced it.
 */
export function clearPointerRequest(): void {
  requested = null;
}

/**
 * Drop a pending request for `element`, from the element's own teardown, so
 * a destroyed row is not what the next scope to tick reads.
 */
export function releasePointerRequest(element: UIElement): void {
  if (requested === element) requested = null;
}

/**
 * Rank a new request against the standing one.
 *
 * An element that takes no part in focus navigation asks for nothing, so a
 * `focusable: false` button inside a focusable row cannot mask the row with a
 * request a scope would then drop, and the parent-chain walk that ranks the
 * request is paid only by an element that can hold focus.
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
