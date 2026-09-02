/** Callbacks invoked by the game loop each frame. */
export interface GameLoopCallbacks {
  earlyUpdate(dt: number): void;
  fixedUpdate(fixedDt: number): void;
  update(dt: number): void;
  lateUpdate(dt: number): void;
  render(dt: number): void;
  endOfFrame(dt: number): void;
}

/** Configuration for the game loop. */
export interface GameLoopConfig {
  /** Fixed timestep in seconds. Default: 1/60. */
  fixedTimestep?: number;
  /** Max fixed steps per frame to prevent spiral of death. Default: 5. */
  maxFixedStepsPerFrame?: number;
}

/**
 * Game loop with fixed timestep accumulator.
 *
 * Driven by an external ticker (e.g., PixiJS Ticker) or manual `tick()` calls
 * for testing. Implements deterministic fixed updates with variable rendering.
 *
 * The incoming per-frame delta is wall-clock milliseconds (PixiJS tickers
 * report `deltaMS`). `tick()` converts it to seconds once, so every callback
 * downstream receives seconds.
 */
export class GameLoop {
  /** Fixed timestep in seconds. */
  readonly fixedTimestep: number;
  /** Max fixed steps per frame. */
  readonly maxFixedStepsPerFrame: number;

  private accumulator = 0;
  private running = false;
  private callbacks: GameLoopCallbacks | null = null;
  private tickerUnsubscribe: (() => void) | null = null;
  private rafId: number | null = null;
  private lastTime = 0;
  private _frameCount = 0;
  private _lastTickAt = 0;

  constructor(config?: GameLoopConfig) {
    this.fixedTimestep = config?.fixedTimestep ?? 1 / 60;
    this.maxFixedStepsPerFrame = config?.maxFixedStepsPerFrame ?? 5;
  }

  /** Current frame count. */
  get frameCount(): number {
    return this._frameCount;
  }

  /** Whether the loop is running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Ratio of accumulated time to fixed timestep, for physics interpolation. */
  get interpolationAlpha(): number {
    return this.accumulator / this.fixedTimestep;
  }

  /**
   * Wall-clock timestamp (ms, `performance.now()` scale) of the
   * most recent `tick()` call, or 0 if `tick()` has never run. Lets a caller
   * tell "frozen on purpose" apart from "stalled" without depending on the
   * frame counter, which doesn't move either way.
   */
  get lastTickAt(): number {
    return this._lastTickAt;
  }

  /** Provide the callbacks that the loop invokes each frame. */
  setCallbacks(callbacks: GameLoopCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Attach an external ticker (e.g., PixiJS Ticker).
   * The ticker calls `tick(dtMs)` every frame with the wall-clock delta in
   * milliseconds. If no ticker is attached, the loop uses requestAnimationFrame.
   */
  attachTicker(
    subscribe: (callback: (dt: number) => void) => () => void,
  ): void {
    this.tickerUnsubscribe = subscribe((dt) => this.tick(dt));
  }

  /** Start the loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this._frameCount = 0;
    this.accumulator = 0;

    // If no external ticker, use rAF (only in browser environments)
    if (!this.tickerUnsubscribe && typeof requestAnimationFrame !== "undefined") {
      this.lastTime = performance.now();
      const loop = (now: number) => {
        if (!this.running) return;
        // The first rAF timestamp can precede the `performance.now()` sampled
        // at start(); a negative delta means "no time passed", not an error.
        const dt = Math.max(0, now - this.lastTime);
        this.lastTime = now;
        this.tick(dt);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /**
   * Stop the loop. Takes effect at the next phase boundary: a `stop()` made
   * from inside a phase — `Engine.destroy()` is one — lets the systems of
   * the running phase finish and skips the phases after it, the frame's
   * remaining fixed steps included.
   */
  stop(): void {
    this.running = false;
    if (this.rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.tickerUnsubscribe) {
      this.tickerUnsubscribe();
      this.tickerUnsubscribe = null;
    }
  }

  /**
   * Process one frame. `dtMs` is the wall-clock delta in milliseconds (the
   * unit PixiJS tickers report). It is converted to seconds here, so every
   * callback receives seconds. `dtMs` must be a finite number >= 0; `0` is a
   * frame with no fixed step. Anything else throws before the frame starts,
   * because a `NaN` accumulator never steps again and an `Infinity` one
   * steps `maxFixedStepsPerFrame` times on every later frame.
   *
   * A `stop()` made from inside a phase ends the frame at that phase's
   * boundary: the phases after it, and any remaining fixed steps, are skipped.
   *
   * A throw that escapes the whole frame — nothing downstream caught it —
   * stops the loop and rethrows, so it reaches the host (a caller's own
   * `try`/`catch`, `window.onerror`, or an unhandled-rejection handler). An
   * error handled inside the frame (a caller's `try`/`catch` around, say,
   * `entity.emit(...)`) never reaches here, so the loop keeps running.
   */
  tick(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new Error(
        `GameLoop.tick: dtMs must be a finite number >= 0, got ${dtMs}.`,
      );
    }
    if (!this.running || !this.callbacks) return;

    this._frameCount++;
    this._lastTickAt = performance.now();

    const dt = dtMs / 1000;

    try {
      // 1. Early Update
      this.callbacks.earlyUpdate(dt);

      // 2. Fixed Update (accumulator-based)
      this.accumulator += dt;
      let steps = 0;
      while (
        this.running &&
        this.accumulator >= this.fixedTimestep &&
        steps < this.maxFixedStepsPerFrame
      ) {
        this.callbacks.fixedUpdate(this.fixedTimestep);
        this.accumulator -= this.fixedTimestep;
        steps++;
      }

      // 3. Update
      if (!this.running) return;
      this.callbacks.update(dt);

      // 4. Late Update
      if (!this.running) return;
      this.callbacks.lateUpdate(dt);

      // 5. Render
      if (!this.running) return;
      this.callbacks.render(dt);

      // 6. End of Frame
      if (!this.running) return;
      this.callbacks.endOfFrame(dt);
    } catch (err) {
      this.stop();
      throw err;
    }
  }
}
