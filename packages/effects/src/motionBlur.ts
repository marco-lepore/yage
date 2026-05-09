import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { MotionBlurFilter } from "pixi-filters";
import type { MotionBlurHandle } from "./handles.js";

/** Options for the {@link motionBlur} preset. */
export interface MotionBlurOptions {
  /** Blur velocity vector in pixels. Default: { x: 30, y: 0 }. */
  velocity?: { x: number; y: number };
  /** Blur kernel size — must be odd, ≥5. Default: 5. */
  kernelSize?: number;
  /** Sample offset. Default: 0. */
  offset?: number;
}

/**
 * Directional motion blur via pixi-filters' MotionBlurFilter — the streak
 * effect for fast-moving sprites or hit-stop polish. The blur direction is a
 * 2-D velocity vector in pixels; magnitude controls strength.
 *
 * `setIntensity` scales the configured velocity from zero (no blur) to its
 * full magnitude, so `fadeIn` ramps the streak in cleanly. `setVelocity`
 * rebases the full vector while preserving the current intensity ratio so
 * an in-flight fade keeps animating against the new direction.
 */
export const motionBlur = defineEffect<MotionBlurHandle, MotionBlurOptions>({
  name: "yage:motionBlur",
  factory: (options) => {
    let baseVx = options.velocity?.x ?? 30;
    let baseVy = options.velocity?.y ?? 0;
    // MotionBlurFilter requires kernelSize to be odd and >= 5; coerce
    // user-provided values up to the nearest valid kernel rather than
    // letting an invalid input produce inconsistent blur output.
    const requestedKernel = Math.floor(options.kernelSize ?? 5);
    const kernelSize =
      requestedKernel < 5
        ? 5
        : requestedKernel % 2 === 0
          ? requestedKernel + 1
          : requestedKernel;
    if (
      options.kernelSize !== undefined &&
      (requestedKernel < 5 || requestedKernel % 2 === 0)
    ) {
      console.warn(
        `[yage:motionBlur] kernelSize must be odd and ≥ 5; coerced ${options.kernelSize} → ${kernelSize}.`,
      );
    }
    const filter = new MotionBlurFilter({
      velocity: { x: baseVx, y: baseVy },
      kernelSize,
      offset: options.offset ?? 0,
    });
    const baseMag = (): number => Math.hypot(baseVx, baseVy);
    const liveMag = (): number => Math.hypot(filter.velocityX, filter.velocityY);
    const effect: Effect<MotionBlurHandle> = {
      filter,
      getIntensity: () => liveMag() / Math.max(baseMag(), 1e-6),
      setIntensity: (v) => {
        filter.velocity = { x: baseVx * v, y: baseVy * v };
      },
      buildExtras: () => ({
        setVelocity: (x: number, y: number) => {
          // Preserve the current intensity ratio so a fade keeps animating
          // against the new direction/magnitude instead of snapping to 1.
          const ratio = liveMag() / Math.max(baseMag(), 1e-6);
          baseVx = x;
          baseVy = y;
          filter.velocity = { x: x * ratio, y: y * ratio };
        },
      }),
    };
    return effect;
  },
});
