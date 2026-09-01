import {
  assertDuration,
  durationReached,
  loopRemainder,
} from "./internal/duration.js";
import type { EasingFunction } from "./types.js";
import type { ErrorBoundary, CallbackErrorInfo } from "./ErrorBoundary.js";

/**
 * Runs one process, slot, or animation callback through the error boundary —
 * a throw, synchronous or from a rejected thenable returned by an `async`
 * callback, is attributed and rethrown. Shared by `ProcessSystem` (pool
 * processes), `ProcessComponent` (entity-owned processes and slots, plus the
 * `cleanup` a slot runs outside any tick) and `KeyframeAnimator`, so there is
 * one guarded code path regardless of where the callback lives.
 */
export function tickProcessGuarded(
  boundary: ErrorBoundary | undefined,
  run: () => unknown,
  info: CallbackErrorInfo,
): void {
  if (!boundary) {
    run();
    return;
  }
  boundary.wrapCallback(run, info);
}

/**
 * Which engine clock advances a process.
 *
 * - `"frame"` — rendered-frame time, via `ProcessSystem` at `Phase.Update`.
 *   Right for visuals: tweens, fades, shakes.
 * - `"fixed"` — the fixed timestep, via `ProcessFixedUpdateSystem` at
 *   `Phase.FixedUpdate`. Right for gameplay timing that must stay in step
 *   with a fixed-step simulation: ability windows, cooldowns, timers that
 *   gate physics-driven mechanics.
 *
 * The clock is chosen where the process is scheduled, not on the process
 * itself, so the same `Process`/`Tween`/`Sequence` types work on either clock.
 * The scheduling sites are `ProcessComponent.run`/`slot`,
 * `ProcessSystem.add`/`addForScene`, and the scoped queue factories.
 */
export type ProcessClock = "frame" | "fixed";

/** Options for creating a Process. */
export interface ProcessOptions {
  /** Called each frame with dt (seconds) and elapsed (seconds). Return true to complete early. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  update?: (dt: number, elapsed: number) => boolean | void;
  /** Called when the process completes. */
  onComplete?: () => void;
  /**
   * Called when `cancel()` stops the process before it completed. A process
   * that owns other processes cancels them here, so cancelling the owner
   * reaches everything it started.
   */
  onCancel?: () => void;
  /**
   * Called when the process is reset for a re-run — what a `Sequence` does to
   * a step instance on each loop or repeat iteration. Elapsed time and
   * completion are reset for you; clear any state the process keeps of its
   * own here.
   */
  onReset?: () => void;
  /** Auto-complete after this duration in seconds. Finite and > 0. */
  duration?: number;
  /** Loop the process. */
  loop?: boolean;
  /** Tags for process filtering. */
  tags?: string[];
}

/**
 * A Process represents an ongoing action updated each frame.
 * Used internally by Tween and Sequence, and directly for custom coroutines.
 */
export class Process {
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  private readonly updateFn: (dt: number, elapsed: number) => boolean | void;
  private readonly onCompleteFn: (() => void) | undefined;
  private readonly onCancelFn: (() => void) | undefined;
  private readonly onResetFn: (() => void) | undefined;
  private readonly duration: number | undefined;
  private readonly loop: boolean;
  /** Tags for filtering/grouping. */
  readonly tags: readonly string[];

  private _elapsed = 0;
  private _completed = false;
  private _paused = false;
  private _cancelled = false;
  private resolvePromise?: () => void;

  /** Create a timer that fires `onComplete` after `duration` seconds, finite and > 0. */
  static delay(duration: number, onComplete?: () => void, tags?: string[]): Process {
    const opts: ProcessOptions = { duration };
    if (onComplete !== undefined) opts.onComplete = onComplete;
    if (tags !== undefined) opts.tags = tags;
    return new Process(opts);
  }

  constructor(options: ProcessOptions) {
    if (options.duration !== undefined) {
      assertDuration("Process", options.duration);
    }
    this.updateFn = options.update ?? (() => {});
    this.onCompleteFn = options.onComplete;
    this.onCancelFn = options.onCancel;
    this.onResetFn = options.onReset;
    this.duration = options.duration;
    this.loop = options.loop ?? false;
    this.tags = options.tags ?? [];
  }

  /** Whether the process has completed. */
  get completed(): boolean {
    return this._completed;
  }

  /** Whether the process is paused. */
  get paused(): boolean {
    return this._paused;
  }

  /**
   * Seconds accumulated from the dt passed to `_update`, so it reflects any
   * time scaling the caller applies (e.g. ProcessSystem's global, per-scene,
   * and per-entity timeScale stacking). Does not advance while paused.
   *
   * On loop, resets to the remainder past `duration` for duration-based
   * completion, or to 0 when the `update` callback returns `true`;
   * otherwise holds its final value once the process completes.
   *
   * This is process time only — unaffected by a keyframe track's `speed`
   * multiplier.
   */
  get elapsed(): number {
    return this._elapsed;
  }

  /** Pause the process. */
  pause(): void {
    this._paused = true;
  }

  /** Resume the process. */
  resume(): void {
    this._paused = false;
  }

  /** Cancel the process. No-op once it has completed. */
  cancel(): void {
    if (this._completed) return;
    this._cancelled = true;
    this._completed = true;
    try {
      this.onCancelFn?.();
    } finally {
      this.resolvePromise?.();
    }
  }

  /**
   * Returns a promise that resolves when the current run ends: completion,
   * cancellation, or a reset for a re-run.
   */
  toPromise(): Promise<void> {
    if (this._completed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  /**
   * Advance the process by dt seconds. Returns whatever `updateFn` returned —
   * `boolean | void` per its declared type, but nothing stops a caller from
   * passing an `async` function anyway, so the caller-observed return can
   * also be a thenable. Returning it lets `tickProcessGuarded` attach a
   * rejection handler; the `boolean | void` typing means every existing
   * caller that ignores the return value keeps compiling.
   * @internal
   */
  _update(dt: number): unknown {
    if (this._completed || this._paused || this._cancelled) return;

    this._elapsed += dt;

    // Check duration-based completion
    if (
      this.duration !== undefined &&
      durationReached(this._elapsed, this.duration)
    ) {
      const result = this.updateFn(dt, this._elapsed);
      // The update callback may have cancelled the process itself.
      if (this._completed) return result;
      if (this.loop && result !== true) {
        this._elapsed = loopRemainder(this._elapsed, this.duration);
        return result;
      }
      this.complete();
      return result;
    }

    // Check callback-based completion
    const result = this.updateFn(dt, this._elapsed);
    // The update callback may have cancelled the process itself.
    if (this._completed) return result;
    if (result === true) {
      if (this.loop) {
        this._elapsed = 0;
        return result;
      }
      this.complete();
    }
    return result;
  }

  /**
   * Reset the process to its initial state so it can be re-run.
   * @internal Used by Sequence for loop/repeat with direct instances.
   */
  _reset(): void {
    this._elapsed = 0;
    this._completed = false;
    this._paused = false;
    this._cancelled = false;
    // A reset ends the current run, which is what `toPromise()` waits for.
    this.resolvePromise?.();
    delete this.resolvePromise;
    this.onResetFn?.();
  }

  private complete(): void {
    this._completed = true;
    try {
      this.onCompleteFn?.();
    } finally {
      this.resolvePromise?.();
    }
  }
}

// ---- Built-in easing functions ----

/** Linear easing (no easing). */
export const easeLinear: EasingFunction = (t) => t;

/** Ease in quadratic. */
export const easeInQuad: EasingFunction = (t) => t * t;

/** Ease out quadratic. */
export const easeOutQuad: EasingFunction = (t) => t * (2 - t);

/** Ease in-out quadratic. */
export const easeInOutQuad: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

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
