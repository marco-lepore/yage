/**
 * Which element holds a focus scope's input.
 *
 * An element that answers the player on its own while it is focused — a text
 * field holding the caret, a dropdown showing its list — takes the scope's
 * input for as long as it does. The scope hands that element every press it
 * polls instead of navigating, so typing `w` into a name field walks no menu
 * and an arrow key over an open list moves the row the list will commit
 * rather than the row behind it. The record is per element, so an element
 * holding one scope's input freezes navigation in no other.
 */

import type { FocusDirection, UIElement } from "../types.js";

/**
 * An element a focus scope hands its input to.
 *
 * Three end points are the scope's whole vocabulary for it: confirm keeps
 * what the element produced, cancel puts back what it replaced, and a release
 * is the scope taking its input back rather than the player ending anything —
 * focus moved away, or the scope stopped reading a device.
 */
export interface UIInputCaptureElement extends UIElement {
  /** Stop, keeping what was typed or picked. */
  confirmCapture(): void;
  /** Stop, putting back the value held when the element took the input. */
  cancelCapture(): void;
  /** Hand the input back, ending where the element stands. */
  releaseCapture(): void;
  /**
   * Take a direction press. One the element has no use for is kept rather
   * than passed on: navigation belongs to the scope only while nothing holds
   * its input.
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
  // The set only ever takes a `UIInputCaptureElement`, so membership is the
  // proof the four methods are there.
  return holders.has(element) ? (element as UIInputCaptureElement) : undefined;
}
