import { createContext } from "react";
import { FloatingOverlay } from "@yagejs/ui";

/**
 * The floating system moved to the framework-agnostic `@yagejs/ui` layer
 * (so it works with or without React). These re-exports keep existing
 * `@yagejs/ui-react` import sites working. New code should import these
 * from `@yagejs/ui` directly.
 */
export {
  FloatingOverlay,
  FloatingOverlayKey,
  computePosition,
} from "@yagejs/ui";
export type {
  FloatConfig,
  FloatingHandle,
  Placement,
  Side,
  Align,
  Rect,
  Dimensions,
  ComputePositionConfig,
  ComputePositionResult,
} from "@yagejs/ui";

/**
 * Provided by `UIRoot` (resolved scene-scoped). Absent → headless consumers
 * fall back to inline rendering (e.g. a bare reconciler tree in tests).
 * React-only — the overlay itself lives in `@yagejs/ui`.
 */
export const FloatingOverlayCtx = createContext<FloatingOverlay | null>(null);
