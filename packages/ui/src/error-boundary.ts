import type { ErrorBoundary } from "@yagejs/core";

// UI services are process-scoped. When two engines share a page, callbacks
// report through the boundary installed most recently.
let uiErrorBoundary: ErrorBoundary | undefined;

export function setUIErrorBoundary(boundary: ErrorBoundary | undefined): void {
  uiErrorBoundary = boundary;
}

export function getUIErrorBoundary(): ErrorBoundary | undefined {
  return uiErrorBoundary;
}

export function runUICallback(kind: string, callback: () => void): void {
  if (uiErrorBoundary) {
    uiErrorBoundary.wrapCallback(callback, { kind });
  } else {
    callback();
  }
}
