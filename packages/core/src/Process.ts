import type { EasingFunction } from "./types.js";

/** Options for creating a Process. */
export interface ProcessOptions {
  /** Called each frame with dt (ms) and elapsed (ms). Return true to complete early. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  update?: (dt: number, elapsed: number) => boolean | void;
  /** Called when the process completes. */
  onComplete?: () => void;
  /** Auto-complete after this duration in ms. */
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
  private readonly duration: number | undefined;
  private readonly loop: boolean;
  /** Tags for filtering/grouping. */
  readonly tags: readonly string[];

  private elapsed = 0;
  private _completed = false;
  private _paused = false;
  private _cancelled = false;
  private resolvePromise?: () => void;

  /** Create a timer that fires `onComplete` after `duration` ms. */
  static delay(duration: number, onComplete?: () => void, tags?: string[]): Process {
    const opts: ProcessOptions = { duration };
    if (onComplete !== undefined) opts.onComplete = onComplete;
    if (tags !== undefined) opts.tags = tags;
    return new Process(opts);
  }

  constructor(options: ProcessOptions) {
    this.updateFn = options.update ?? (() => {});
    this.onCompleteFn = options.onComplete;
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

  /** Pause the process. */
  pause(): void {
    this._paused = true;
  }

  /** Resume the process. */
  resume(): void {
    this._paused = false;
  }

  /** Cancel the process. */
  cancel(): void {
    this._cancelled = true;
    this._completed = true;
    this.resolvePromise?.();
  }

  /** Returns a promise that resolves when the process completes or is cancelled. */
  toPromise(): Promise<void> {
    if (this._completed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  /**
   * Advance the process by dt milliseconds.
   * @internal
   */
  _update(dt: number): void {
    if (this._completed || this._paused || this._cancelled) return;

    this.elapsed += dt;

    // Check duration-based completion
    if (this.duration !== undefined && this.elapsed >= this.duration) {
      const result = this.updateFn(dt, this.elapsed);
      if (this.loop && result !== true) {
        this.elapsed = this.elapsed % this.duration;
        return;
      }
      this.complete();
      return;
    }

    // Check callback-based completion
    const result = this.updateFn(dt, this.elapsed);
    if (result === true) {
      if (this.loop) {
        this.elapsed = 0;
        return;
      }
      this.complete();
    }
  }

  private complete(): void {
    this._completed = true;
    this.onCompleteFn?.();
    this.resolvePromise?.();
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
