/**
 * Relative tolerance for "has this duration elapsed?" comparisons: one part in
 * a billion of the duration.
 *
 * Elapsed time accumulates by adding dt in binary floating point, so a sum that
 * should land exactly on the duration usually lands a fraction under it — six
 * ticks of `1/60` sum to `0.09999999999999999`, which is less than `0.1`.
 * Without a tolerance a 0.1 s window needs a seventh tick. The tolerance scales
 * with the duration so it stays meaningful for a 0.05 s hit window and a 600 s
 * round timer alike.
 * @internal
 */
const DURATION_TOLERANCE = 1e-9;

/**
 * Whether `elapsed` has reached `duration`, within the float tolerance.
 * `duration` must be > 0.
 * @internal
 */
export function durationReached(elapsed: number, duration: number): boolean {
  return elapsed >= duration - duration * DURATION_TOLERANCE;
}

/**
 * Progress through `duration`, 0..1. Reads exactly 1 on the tick that reaches
 * the duration, so a tween lands on its target value instead of a fraction
 * short of it. `duration` must be > 0.
 * @internal
 */
export function durationProgress(elapsed: number, duration: number): number {
  return durationReached(elapsed, duration) ? 1 : elapsed / duration;
}

/**
 * Elapsed time folded into the next pass of a looping process. Overshoot
 * carries forward; a tick that lands a hair under `duration` and counts as
 * reaching it starts the next pass at 0 rather than at a nearly full period.
 * @internal
 */
export function loopRemainder(elapsed: number, duration: number): number {
  return Math.max(0, elapsed - duration) % duration;
}

/**
 * Throw unless `value` is a duration a process can run: finite and > 0.
 * `context` names the API the caller used, e.g. `"Tween.to"`.
 * @internal
 */
export function assertDuration(context: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${context}: duration must be a finite number > 0 in seconds, got ${value}.`,
    );
  }
}
