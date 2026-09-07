import type { EasingFunction } from "./types.js";

// ---- Built-in easing functions ----
//
// Every function here takes `t` in [0,1] and returns the eased value, `0` at
// `t = 0` and `1` at `t = 1`. The `back` and `elastic` families deliberately
// leave [0,1] in between — the overshoot is the effect. The result for `t`
// outside [0,1] is not specified.

/** Robert Penner's overshoot constants for the `back` family. */
const BACK_C1 = 1.70158;
const BACK_C2 = BACK_C1 * 1.525;
const BACK_C3 = BACK_C1 + 1;

/** Oscillation frequencies for the `elastic` family. */
const ELASTIC_C4 = (2 * Math.PI) / 3;
const ELASTIC_C5 = (2 * Math.PI) / 4.5;

/** Linear easing (no easing). */
export const easeLinear: EasingFunction = (t) => t;

/** Ease in sine — the gentlest acceleration. */
export const easeInSine: EasingFunction = (t) =>
  1 - Math.cos((t * Math.PI) / 2);

/** Ease out sine — the gentlest deceleration. */
export const easeOutSine: EasingFunction = (t) => Math.sin((t * Math.PI) / 2);

/** Ease in-out sine — gentle at both ends. */
export const easeInOutSine: EasingFunction = (t) =>
  -(Math.cos(Math.PI * t) - 1) / 2;

/** Ease in quadratic. */
export const easeInQuad: EasingFunction = (t) => t * t;

/** Ease out quadratic. */
export const easeOutQuad: EasingFunction = (t) => t * (2 - t);

/** Ease in-out quadratic. */
export const easeInOutQuad: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/** Ease in cubic — a noticeably slow start. */
export const easeInCubic: EasingFunction = (t) => t * t * t;

/** Ease out cubic — the everyday snappy settle. */
export const easeOutCubic: EasingFunction = (t) => 1 - Math.pow(1 - t, 3);

/** Ease in-out cubic — slow start and finish, fast middle. */
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Ease in quartic — steeper than cubic. */
export const easeInQuart: EasingFunction = (t) => t * t * t * t;

/** Ease out quartic — steeper than cubic. */
export const easeOutQuart: EasingFunction = (t) => 1 - Math.pow(1 - t, 4);

/** Ease in-out quartic. */
export const easeInOutQuart: EasingFunction = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

/** Ease in quintic — steeper than quartic. */
export const easeInQuint: EasingFunction = (t) => t * t * t * t * t;

/** Ease out quintic — steeper than quartic. */
export const easeOutQuint: EasingFunction = (t) => 1 - Math.pow(1 - t, 5);

/** Ease in-out quintic. */
export const easeInOutQuint: EasingFunction = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;

/** Ease in exponential — almost flat, then a sudden rush. */
export const easeInExpo: EasingFunction = (t) =>
  t === 0 ? 0 : Math.pow(2, 10 * t - 10);

/** Ease out exponential — an immediate rush, then a long tail. */
export const easeOutExpo: EasingFunction = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

/** Ease in-out exponential — near-flat at both ends, steep through the middle. */
export const easeInOutExpo: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;

/** Ease in circular — a quarter-circle arc, flat then near-vertical. */
export const easeInCirc: EasingFunction = (t) => 1 - Math.sqrt(1 - t * t);

/** Ease out circular — near-vertical then flat. */
export const easeOutCirc: EasingFunction = (t) =>
  Math.sqrt(1 - Math.pow(t - 1, 2));

/** Ease in-out circular. */
export const easeInOutCirc: EasingFunction = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

/** Ease in back — anticipates by dipping below `0` before moving. */
export const easeInBack: EasingFunction = (t) =>
  BACK_C3 * t * t * t - BACK_C1 * t * t;

/** Ease out back — overshoots past `1` and settles back. The UI pop. */
export const easeOutBack: EasingFunction = (t) =>
  1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2);

/** Ease in-out back — dips below `0`, then overshoots past `1`. */
export const easeInOutBack: EasingFunction = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((BACK_C2 + 1) * 2 * t - BACK_C2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((BACK_C2 + 1) * (2 * t - 2) + BACK_C2) + 2) /
      2;

/** Ease in elastic — a growing wobble below `0` before the snap to `1`. */
export const easeInElastic: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ELASTIC_C4);

/** Ease out elastic — springs past `1` and wobbles down. */
export const easeOutElastic: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ELASTIC_C4) + 1;

/** Ease in-out elastic — wobbles below `0` and above `1`. */
export const easeInOutElastic: EasingFunction = (t) =>
  t === 0
    ? 0
    : t === 1
      ? 1
      : t < 0.5
        ? -(
            Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * ELASTIC_C5)
          ) / 2
        : (Math.pow(2, -20 * t + 10) *
            Math.sin((20 * t - 11.125) * ELASTIC_C5)) /
            2 +
          1;

/** Ease out bounce. */
export const easeOutBounce: EasingFunction = (t) => {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  } else if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  } else if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  } else {
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  }
};

/** Ease in bounce — `easeOutBounce` reflected, so the bounces lead. */
export const easeInBounce: EasingFunction = (t) => 1 - easeOutBounce(1 - t);

/** Ease in-out bounce — bounces at both ends. */
export const easeInOutBounce: EasingFunction = (t) =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;
