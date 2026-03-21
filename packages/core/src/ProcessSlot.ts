/** Configuration for a ProcessSlot. */
export interface ProcessSlotConfig {
  /** Auto-complete after this duration in ms. */
  duration?: number;
  /** Called each frame with dt (ms) and elapsed (ms). Return true to complete early. */
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
  private _elapsed = 0;
  private _completed = true;
  private _paused = false;

  /** Tags for filtering/grouping. */
  readonly tags: readonly string[];

  constructor(config: ProcessSlotConfig = {}) {
    this.config = config;
    this.tags = config.tags ?? [];
  }

  /** Whether the slot has completed (starts true). */
  get completed(): boolean {
    return this._completed;
  }

  /** Whether the slot is actively running (not completed and not paused). */
  get running(): boolean {
    return !this._completed && !this._paused;
  }

  /** Milliseconds elapsed since start. */
  get elapsed(): number {
    return this._elapsed;
  }

  /** Progress ratio 0..1 (elapsed / duration). 0 if no duration set. */
  get ratio(): number {
    const d = this.config.duration;
    if (d === undefined || d <= 0) return 0;
    return Math.min(this._elapsed / d, 1);
  }

  /** Start the slot. No-op if already running (use restart() to force). */
  start(overrides?: Partial<ProcessSlotConfig>): this {
    if (!this._completed) return this;
    this._elapsed = 0;
    this._completed = false;
    this._paused = false;
    if (overrides) {
      this.config = { ...this.config, ...overrides };
      if (overrides.tags) {
        (this as { tags: readonly string[] }).tags = overrides.tags;
      }
    }
    return this;
  }

  /** Cancel if running, then start fresh. Always restarts. */
  restart(overrides?: Partial<ProcessSlotConfig>): this {
    if (!this._completed) {
      this.config.cleanup?.();
      this._completed = true;
    }
    // Force start by ensuring completed is true
    this._completed = true;
    return this.start(overrides);
  }

  /** Cancel the slot. Calls cleanup if running. */
  cancel(): void {
    if (this._completed) return;
    this.config.cleanup?.();
    this._completed = true;
  }

  /** Pause the slot. */
  pause(): void {
    if (!this._completed) this._paused = true;
  }

  /** Resume the slot. */
  resume(): void {
    this._paused = false;
  }

  /** Set/override the onComplete callback. Chainable. */
  onComplete(fn: () => void): this {
    this.config = { ...this.config, onComplete: fn };
    return this;
  }

  /**
   * Advance the slot by dt milliseconds.
   * @internal — called by ProcessComponent
   */
  _tick(dt: number): void {
    if (this._completed || this._paused) return;

    this._elapsed += dt;

    // Run per-frame update
    const result = this.config.update?.(dt, this._elapsed);

    // Check duration-based completion
    const duration = this.config.duration;
    if (duration !== undefined && this._elapsed >= duration) {
      if (this.config.loop && result !== true) {
        this._elapsed = this._elapsed % duration;
        return;
      }
      this._complete();
      return;
    }

    // Check callback-based completion
    if (result === true) {
      if (this.config.loop) {
        this._elapsed = 0;
        return;
      }
      this._complete();
    }
  }

  private _complete(): void {
    this._completed = true;
    try {
      this.config.onComplete?.();
    } finally {
      this.config.cleanup?.();
    }
  }
}
