const TAU = Math.PI * 2;
const MIN_SMOOTH_TIME = 0.0001;

export interface SmoothDampResult {
  /** Smoothed value after this step. */
  readonly value: number;
  /** Velocity to pass into the next smoothDamp step. */
  readonly velocity: number;
}

function normalizeAngle(radians: number): number {
  const wrapped = ((((radians + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return wrapped === -Math.PI && radians > 0 ? Math.PI : wrapped;
}

/** Common math utility functions. */
export const MathUtils = {
  /** Linear interpolation between a and b. */
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  },

  /** Return the clamped interpolation factor that produces v between a and b. */
  inverseLerp(a: number, b: number, v: number): number {
    if (a === b) return 0;
    return MathUtils.clamp((v - a) / (b - a), 0, 1);
  },

  /** Interpolate between angles in radians along the shortest path. */
  lerpAngle(a: number, b: number, t: number): number {
    return normalizeAngle(a + MathUtils.shortestAngleBetween(a, b) * t);
  },

  /** Signed shortest angular delta from a to b, in radians. */
  shortestAngleBetween(a: number, b: number): number {
    return normalizeAngle(b - a);
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

  /** Bounce t between 0 and length. */
  pingPong(t: number, length: number): number {
    if (length <= 0) return 0;
    const wrapped = MathUtils.wrap(t, 0, length * 2);
    return length - Math.abs(wrapped - length);
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

  /**
   * Smoothly damp current toward target without overshooting.
   * Pass the returned velocity back into the next call.
   */
  smoothDamp(
    current: number,
    target: number,
    velocity: number,
    smoothTime: number,
    deltaTime: number,
    maxSpeed: number = Infinity,
  ): SmoothDampResult {
    if (deltaTime <= 0) {
      return { value: current, velocity };
    }

    const safeSmoothTime = Math.max(MIN_SMOOTH_TIME, smoothTime);
    const omega = 2 / safeSmoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const originalTarget = target;
    const maxChange = maxSpeed * safeSmoothTime;
    const change = MathUtils.clamp(current - target, -maxChange, maxChange);
    const adjustedTarget = current - change;
    const temp = (velocity + omega * change) * deltaTime;
    const nextVelocity = (velocity - omega * temp) * exp;
    let value = adjustedTarget + (change + temp) * exp;
    let resultVelocity = nextVelocity;
    const targetIsAboveCurrent = originalTarget - current > 0;
    const valuePassedTarget = targetIsAboveCurrent
      ? value > originalTarget
      : value < originalTarget;

    if (valuePassedTarget) {
      value = originalTarget;
      resultVelocity = 0;
    }

    return { value, velocity: resultVelocity };
  },

  /** Wrap value into the range [min, max). */
  wrap(value: number, min: number, max: number): number {
    const range = max - min;
    return ((((value - min) % range) + range) % range) + min;
  },
} as const;
