/** Common math utility functions. */
export const MathUtils = {
  /** Linear interpolation between a and b. */
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  },

  /** Clamp a value between min and max. */
  clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  },

  /** Remap a value from one range to another. */
  remap(
    value: number,
    inMin: number,
    inMax: number,
    outMin: number,
    outMax: number,
  ): number {
    const t = (value - inMin) / (inMax - inMin);
    return outMin + (outMax - outMin) * t;
  },

  /** Random float in [min, max). */
  randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  },

  /** Random integer in [min, max] (inclusive). */
  randomInt(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
  },

  /** Convert degrees to radians. */
  degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  },

  /** Convert radians to degrees. */
  radToDeg(radians: number): number {
    return (radians * 180) / Math.PI;
  },

  /** Move current toward target by at most step. */
  approach(current: number, target: number, step: number): number {
    if (current < target) {
      return Math.min(current + step, target);
    }
    return Math.max(current - step, target);
  },

  /** Wrap value into the range [min, max). */
  wrap(value: number, min: number, max: number): number {
    const range = max - min;
    return ((((value - min) % range) + range) % range) + min;
  },
} as const;
