/**
 * Which elements are scroll views, so a focus scope can find the viewports
 * enclosing a candidate.
 *
 * A registry rather than `instanceof UIScrollView`: `UIScrollView` and
 * `UIPanel` already import each other, and reaching the class from the focus
 * walk would pull that pair into every module that navigates.
 */

import type { UIElement, UIScrollIntoViewOptions } from "../types.js";

/** The slice of a scroll view a focus scope drives. */
export interface FocusScrollView extends UIElement {
  scrollIntoView(element: UIElement, opts?: UIScrollIntoViewOptions): void;
}

const scrollViews = new WeakSet<UIElement>();

/** Take part in the focus scroll follow. Called from a view's constructor. */
export function markScrollView(view: FocusScrollView): void {
  scrollViews.add(view);
}

/**
 * The element as a scroll view, or `undefined` for anything else.
 * @internal
 */
export function asScrollView(element: UIElement): FocusScrollView | undefined {
  // Only a `FocusScrollView` enters the set, so membership proves the cast.
  return scrollViews.has(element) ? (element as FocusScrollView) : undefined;
}
