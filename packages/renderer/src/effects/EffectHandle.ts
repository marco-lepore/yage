import type { Process } from "@yagejs/core";

/**
 * The runtime handle returned by `addEffect`. Lets the caller toggle, remove,
 * or fade an effect without tracking its slot in the underlying pixi
 * `filters` array.
 *
 * Effect factories may return a richer handle that extends this — see each
 * factory's typed return for extras like `setIntensity` or `trigger`.
 */
export interface EffectHandle {
  /** Remove the effect immediately. Idempotent. */
  remove(): void;
  /** Toggle the effect without removing it. Flips the underlying filter's `.enabled`. */
  setEnabled(on: boolean): void;
  /** Whether the effect is currently enabled. */
  readonly enabled: boolean;
  /** Tween the effect's primary intensity 0 → 1 over `duration` ms. */
  fadeIn(duration: number): Process;
  /** Tween the effect's primary intensity → 0 over `duration` ms. */
  fadeOut(duration: number): Process;
  /**
   * Schedule a `Process` scoped to this effect's lifetime. The process is
   * routed through the same `ScopedProcessQueue` the effect's fades use —
   * pauses with the owning scene, time-scales with it, and is cancelled
   * automatically when the effect is removed.
   *
   * Useful for factories that need timed work (e.g. a one-shot trigger ramp,
   * a uniform animator) without asking the caller to wire `step(dt)`. The
   * returned `Process` can be cancelled early; otherwise it tears down with
   * the effect.
   */
  run(p: Process): Process;
}
