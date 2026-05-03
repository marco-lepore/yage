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
 *
 * Marking a container also forces `eventMode = "static"` so Pixi's
 * `EventBoundary.hitTest` reports it as the hit at drain time. Without that,
 * a `passive`-mode container (the default for plain `Container`, including
 * UIPanel and the layout primitives) would be skipped by the hit-test and
 * the renderer's `hitTestUI` would never see the mark. Restores `eventMode`
 * to `"passive"` on opt-out so the container becomes transparent again.
 */
export function applyConsumeInput(
  container: Container,
  consumeInput: boolean | undefined,
): void {
  if (consumeInput === false) {
    // Don't flip `eventMode` back to "passive" on opt-out. UIButton /
    // UICheckbox set "static" themselves for hover handlers and call this
    // helper after; clobbering eventMode here would silently break their
    // listeners. A consume:false container with eventMode="static" is
    // harmless: the hit-test sees it but the unmarked walk returns false,
    // so input passes through.
    unmarkPointerConsumeContainer(container);
  } else {
    markPointerConsumeContainer(container);
    container.eventMode = "static";
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
