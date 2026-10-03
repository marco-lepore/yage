import { localFilter, scaled } from "./localFilter.js";
import { validateFinite, validatePoint } from "./validate.js";
import { defineEffect } from "@yagejs/renderer";
import type { Effect } from "@yagejs/renderer";
import { MotionBlurFilter } from "pixi-filters";
import type { MotionBlurHandle } from "./handles.js";

/** Options for the {@link motionBlur} preset. */
export interface MotionBlurOptions {
  /** Blur velocity vector in host-local pixels. Default: { x: 30, y: 0 }. */
  velocity?: { x: number; y: number };
  /** Blur kernel size — must be odd, ≥5. Default: 5. */
  kernelSize?: number;
  /** Sample offset in host-local pixels. Default: 0. */
  offset?: number;
}

/**
 * Directional motion blur via pixi-filters' MotionBlurFilter — the streak
 * effect for fast-moving sprites or hit-stop polish. The blur direction is a
 * 2-D velocity vector in host-local pixels; magnitude controls strength.
 *
 * `setIntensity` scales the configured velocity from zero (no blur) to its
 * full magnitude, so `fadeIn` ramps the streak in cleanly. `setVelocity`
 * rebases the full vector while preserving the current intensity ratio so
 * an in-flight fade keeps animating against the new direction.
 */
export const motionBlur = defineEffect<MotionBlurHandle, MotionBlurOptions>({
  name: "yage:motionBlur",
  factory: (options) => {
    let baseVx = validateFinite(
      "motionBlur",
      "velocity.x",
      options.velocity?.x ?? 30,
    );
    let baseVy = validateFinite(
      "motionBlur",
      "velocity.y",
      options.velocity?.y ?? 0,
    );
    let intensity = 1;
    const offset = validateFinite("motionBlur", "offset", options.offset ?? 0);
    // MotionBlurFilter requires kernelSize to be odd and >= 5; coerce
    // user-provided values up to the nearest valid kernel rather than
    // letting an invalid input produce inconsistent blur output.
    const requestedKernel = Math.floor(
      validateFinite("motionBlur", "kernelSize", options.kernelSize ?? 5),
    );
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
      offset,
    });
    const local = localFilter(
      filter,
      ({ scaleX, scaleY, sizeScale }) => {
        const x = scaled(baseVx * intensity, scaleX);
        const y = scaled(baseVy * intensity, scaleY);
        filter.velocity = { x, y };
        filter.offset = scaled(offset, sizeScale);
      },
      ({ scaleX, scaleY, sizeScale }) => {
        const x = scaled(baseVx * intensity, scaleX);
        const y = scaled(baseVy * intensity, scaleY);
        if (x === 0 && y === 0) return 0;
        return (
          Math.max(Math.abs(x), Math.abs(y)) * 0.5 +
          Math.abs(scaled(offset, sizeScale)) +
          1
        );
      },
    );
    const effect: Effect<MotionBlurHandle> = {
      filter,
      onAttach: local.onAttach,
      onDetach: local.onDetach,
      getIntensity: () => intensity,
      setIntensity: (value) => {
        intensity = validateFinite("motionBlur", "intensity", value);
        local.update();
      },
      buildExtras: () => ({
        setVelocity: (x: number, y: number) => {
          validatePoint("motionBlur", "velocity", { x, y });
          baseVx = x;
          baseVy = y;
          local.update();
        },
      }),
    };
    return effect;
  },
});
