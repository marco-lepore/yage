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

function boundaryAbove(
  start: DisplayContainer | null,
): ErrorBoundary | undefined {
  for (let current = start; current; current = current.parent) {
    const boundary = errorBoundaries.get(current);
    if (boundary) return boundary;
  }
  return undefined;
}

/**
 * Run `callback` through the error boundary of the UI tree `owner` belongs
 * to. `detachedFrom` is the parent `owner` was last removed from; the lookup
 * continues there when `owner`'s own chain has no boundary.
 */
export function runUICallback(
  owner: DisplayContainer,
  kind: string,
  callback: () => void,
  detachedFrom?: DisplayContainer,
): void {
  const boundary =
    boundaryAbove(owner) ??
    (detachedFrom ? boundaryAbove(detachedFrom) : undefined);
  if (boundary) {
    boundary.wrapCallback(callback, { kind });
    return;
  }
  callback();
}
