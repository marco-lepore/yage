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
}

/**
 * Internal: a process host owns the lifecycle of fade tweens for one
 * `EffectStack`. Different scopes wrap different process targets
 * (entity ProcessComponent, scene-level ProcessSystem, engine-level).
 *
 * @internal
 */
export interface EffectProcessHost {
  /** Enqueue a process; the host promises to tick it until completion. */
  run(p: Process): Process;
  /** Cancel every process this host enqueued. Called on stack teardown. */
  cancelAll(): void;
}
