import { Container } from "pixi.js";
import {
  markPointerConsumeContainer,
  unmarkPointerConsumeContainer,
} from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";

/**
 * Register a UI element's setting. Omitted values inherit the nearest explicit
 * ancestor setting; a standalone UI element defaults to consuming input.
 * Pointer handlers and hit testing work independently of consumption.
 */
export function applyConsumeInput(
  container: DisplayContainer,
  consumeInput: boolean | undefined,
): void {
  markPointerConsumeContainer(container, consumeInput ?? "inherit");
  // Preserve explicit modes such as a disabled button's "none".
  if (container.eventMode === "passive" || container.eventMode === undefined) {
    container.eventMode = "static";
  }
}

/** Remove the element's policy when it is destroyed. */
export function clearConsumeInput(container: DisplayContainer): void {
  unmarkPointerConsumeContainer(container);
}

/** A hit area that answers to every point. Shared: it carries no state. */
const EVERYWHERE = { contains: (): boolean => true };

/**
 * A childless, transparent container that answers the hit test at every point
 * and claims the pointer for the UI.
 *
 * Pixi hit-tests a container's children from the top of the z-order down and
 * stops at the first one that answers. A blocker placed under one subtree
 * leaves that subtree hittable and swallows every point around it, so nothing
 * drawn below hovers, presses or clicks.
 *
 * The consume mark is the blocker's own, so a press on the swallowed area is
 * claimed for the UI even inside a container that opted out of consuming
 * input.
 */
export function createPointerBlocker(): DisplayContainer {
  const blocker = new Container();
  blocker.hitArea = EVERYWHERE;
  applyConsumeInput(blocker, true);
  return blocker;
}
