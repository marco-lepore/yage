import {
  assertDuration,
  durationProgress,
  durationReached,
  loopRemainder,
} from "./internal/duration.js";
import type { ProcessClock } from "./Process.js";

/** Configuration for a ProcessSlot. */
export interface ProcessSlotConfig {
  /**
   * Which clock ticks the slot: `"frame"` (default) or `"fixed"`. Read once
   * when the slot is created via `ProcessComponent.slot()`; `start()`/
   * `restart()` overrides cannot change it. A standalone `ProcessSlot` has
   * no clock — whoever calls `_tick` decides.
   */
  clock?: ProcessClock;
  /** Auto-complete after this duration in seconds. Must be finite and > 0. */
  duration?: number;
  /** Called each frame with dt (seconds) and elapsed (seconds). Return true to complete early. */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  update?: (dt: number, elapsed: number) => boolean | void;
  /** Called on natural completion only. */
  onComplete?: () => void;
  /** Called on complete, cancel, OR restart — like `finally`. */
  cleanup?: () => void;
  /** Tags for filtering. */
  tags?: string[];
  /** Loop the slot's process. */
  loop?: boolean;
}

/**
 * A reusable, restartable process handle owned by a ProcessComponent.
 *
 * Starts in `completed` state (ready to use). Call `start()` to activate.
 * Use for cooldowns, invincibility windows, flash effects, shakes, etc.
 */
export class ProcessSlot {
  private config: ProcessSlotConfig;
  /**
   * Config in force for the current run: the stored config, or a copy of it
   * merged with the overrides `start()` was given. Every `start()` reassigns
   * it, so overrides never reach a later run.
   */
  private runConfig: ProcessSlotConfig;
  private _elapsed = 0;
  private _completed = true;
  private _paused = false;
  /**
   * Runs slot callbacks the engine invokes outside a tick — `cleanup` from
   * `cancel()` and `restart()` — through the owning component's error
   * boundary, so a throw is attributed to the slot rather than to whichever
   * game code called `cancel()`.
   * @internal — set by `ProcessComponent.slot()`
   */
  _guardCallback: ((run: () => void) => void) | undefined;

  constructor(config: ProcessSlotConfig = {}) {
    if (config.duration !== undefined) {
      assertDuration("ProcessSlot", config.duration);
    }
    this.config = config;
    this.runConfig = config;
  }

  /** Whether the slot has completed (starts true). */
  get completed(): boolean {
    return this._completed;
  }

  /** Whether the slot is actively running (not completed and not paused). */
  get running(): boolean {
    return !this._completed && !this._paused;
  }

  /** Seconds elapsed since start. */
  get elapsed(): number {
    return this._elapsed;
  }

  /**
   * Tags for filtering/grouping — the running slot's tags, which `start()`
   * overrides can replace for one run, and the configured tags once it has
   * completed.
   */
  get tags(): readonly string[] {
    const config = this._completed ? this.config : this.runConfig;
    return config.tags ?? [];
  }

  /** Progress ratio 0..1 (elapsed / duration). 0 if no duration set. */
  get ratio(): number {
    const d = this.runConfig.duration;
    if (d === undefined) return 0;
    return durationProgress(this._elapsed, d);
  }

  /**
   * Start the slot. No-op if already running (use restart() to force), which
   * also means overrides passed to a running slot are discarded.
   *
   * Overrides apply to this run only: the next bare `start()` uses the config
   * the slot was created with.
   */
  start(overrides?: Partial<Omit<ProcessSlotConfig, "clock">>): this {
    if (!this._completed) return this;
    if (overrides?.duration !== undefined) {
      assertDuration("ProcessSlot.start", overrides.duration);
    }
    this._elapsed = 0;
    this._completed = false;
    this._paused = false;
    this.runConfig = overrides ? { ...this.config, ...overrides } : this.config;
    return this;
  }

  /** Cancel if running, then start fresh. Always restarts. */
  restart(overrides?: Partial<Omit<ProcessSlotConfig, "clock">>): this {
    this.cancel();
    return this.start(overrides);
  }

  /** Cancel the slot. Calls cleanup if running. */
  cancel(): void {
    if (this._completed) return;
    // Flag first: a `cleanup` that cancels or restarts its own slot then sees
    // a completed slot instead of recursing, and a throwing one leaves the
    // slot cancelled rather than still ticking.
    this._completed = true;
    const cleanup = this.runConfig.cleanup;
    if (cleanup) this._runOutsideTick(cleanup);
  }

  /** Pause the slot. */
  pause(): void {
    if (!this._completed) this._paused = true;
  }

  /** Resume the slot. */
  resume(): void {
    this._paused = false;
  }

  /**
   * Set/override the onComplete callback. Chainable. Applies to the current
   * run as well as to later ones.
   */
  onComplete(fn: () => void): this {
    const runUsesStoredConfig = this.runConfig === this.config;
    this.config = { ...this.config, onComplete: fn };
    this.runConfig = runUsesStoredConfig
      ? this.config
      : { ...this.runConfig, onComplete: fn };
    return this;
  }

  /**
   * Advance the slot by dt seconds. Returns whatever `config.update` returned
   * — `boolean | void` per its declared type, but nothing stops a caller from
   * passing an `async` function anyway, so the caller-observed return can
   * also be a thenable. Returning it lets `tickProcessGuarded` attach a
   * rejection handler, mirroring `Process._update`.
   * @internal — called by ProcessComponent
   */
  _tick(dt: number): unknown {
    if (this._completed || this._paused) return;

    this._elapsed += dt;

    // Run per-frame update
    const result = this.runConfig.update?.(dt, this._elapsed);
    if (this._completed) return result;

    // Check duration-based completion
    const duration = this.runConfig.duration;
    if (duration !== undefined && durationReached(this._elapsed, duration)) {
      if (this.runConfig.loop && result !== true) {
        this._elapsed = loopRemainder(this._elapsed, duration);
        return result;
      }
      this._complete();
      return result;
    }

    // Check callback-based completion
    if (result === true) {
      if (this.runConfig.loop) {
        this._elapsed = 0;
        return result;
      }
      this._complete();
    }
    return result;
  }

  private _complete(): void {
    this._completed = true;
    try {
      this.runConfig.onComplete?.();
    } finally {
      this.runConfig.cleanup?.();
    }
  }

  private _runOutsideTick(fn: () => void): void {
    if (this._guardCallback) {
      this._guardCallback(fn);
      return;
    }
    fn();
  }
}
