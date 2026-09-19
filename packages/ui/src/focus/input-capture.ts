/**
 * Which element holds a focus scope's input.
 *
 * An element that answers the player on its own while focused (a text field
 * holding the caret, a dropdown showing its list) takes the scope's input. The
 * scope hands that element every press it polls and navigates nothing, so
 * typing `w` into a name field moves no menu. The record is per element, so
 * it affects no other scope.
 */

import type { FocusDirection, UIElement } from "../types.js";

/**
 * An element a focus scope hands its input to. Confirm keeps what the element
 * produced, cancel puts back what it replaced, and release is the scope
 * taking its input back: focus moved away, or the scope stopped reading input.
 */
export interface UIInputCaptureElement extends UIElement {
  /** Stop, keeping what was typed or picked. */
  confirmCapture(): void;
  /** Stop, putting back the value held when the element took the input. */
  cancelCapture(): void;
  /** Hand the input back, ending where the element stands. */
  releaseCapture(): void;
  /**
   * Take a direction press. One the element has no use for is still consumed
   * and never reaches the scope's navigation.
   */
  moveCapture?(direction: FocusDirection): void;
}

const holders = new WeakSet<UIElement>();

/** Record that `element` took its scope's input, or gave it back. */
export function captureFocusInput(
  element: UIInputCaptureElement,
  capturing: boolean,
): void {
  if (capturing) holders.add(element);
  else holders.delete(element);
}

/** Whether this element holds the input of the scope around it. */
export function isCapturingInput(element: UIElement): boolean {
  return holders.has(element);
}

/**
 * The element as one a scope hands presses to, or `undefined` when it holds
 * no input.
 * @internal
 */
export function capturedInput(
  element: UIElement,
): UIInputCaptureElement | undefined {
  // Only a `UIInputCaptureElement` enters the set, so membership proves the
  // cast.
  return holders.has(element) ? (element as UIInputCaptureElement) : undefined;
}
