import type { ErrorBoundary } from "@yagejs/core";
import type { DisplayContainer } from "@yagejs/renderer";

const errorBoundaries = new WeakMap<DisplayContainer, ErrorBoundary>();

/** @internal Associate one mounted UI tree with its owning engine. */
export function bindUIErrorBoundary(
  root: DisplayContainer,
  boundary: ErrorBoundary,
): void {
  errorBoundaries.set(root, boundary);
}

export function runUICallback(
  owner: DisplayContainer,
  kind: string,
  callback: () => void,
): void {
  let current: DisplayContainer | null = owner;
  while (current) {
    const boundary = errorBoundaries.get(current);
    if (boundary) {
      boundary.wrapCallback(callback, { kind });
      return;
    }
    current = current.parent;
  }
  callback();
}
