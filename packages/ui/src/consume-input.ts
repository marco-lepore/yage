import {
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
} from "@yagejs/core";
import type { Container } from "pixi.js";

/**
 * Apply the UI auto-consume marking to a container. Used internally by the
 * UI primitives (UIButton, UIPanel, UICheckbox, UIImage, UINineSlice,
 * UIProgressBar, UIText) and their Pixi-wrapped variants.
 *
 * `consumeInput` defaults to `true` — UI is the swallow-input surface by
 * default, matching the "tap on a menu doesn't fire gameplay actions" intent.
 * Pass `false` to opt out, leaving the container transparent to the action
 * map (the element's own pointer handlers, if any, still fire).
 */
export function applyConsumeInput(
  container: Container,
  consumeInput: boolean | undefined,
): void {
  if (consumeInput === false) {
    unmarkPointerConsumeContainer(container);
  } else {
    markPointerConsumeContainer(container);
  }
}

/**
 * Unmark a container — call from the component's `destroy()` so the WeakSet
 * entry doesn't outlive the container's other references. The WeakSet would
 * GC eventually, but explicit cleanup avoids brief windows where a hit-test
 * misfires on a half-torn-down element.
 */
export function clearConsumeInput(container: Container): void {
  unmarkPointerConsumeContainer(container);
}
