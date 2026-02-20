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
  /** Fixed timestep in ms. Default: 1000/60. */
  fixedTimestep?: number;
  /** Max fixed steps per frame to prevent spiral of death. Default: 5. */
  maxFixedStepsPerFrame?: number;
}

/**
 * Game loop with fixed timestep accumulator.
 *
 * Driven by an external ticker (e.g., PixiJS Ticker) or manual `tick()` calls
 * for testing. Implements deterministic fixed updates with variable rendering.
 */
export class GameLoop {
  /** Fixed timestep in ms. */
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

  constructor(config?: GameLoopConfig) {
    this.fixedTimestep = config?.fixedTimestep ?? 1000 / 60;
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

  /** Provide the callbacks that the loop invokes each frame. */
  setCallbacks(callbacks: GameLoopCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Attach an external ticker (e.g., PixiJS Ticker).
   * The ticker calls `tick(dt)` every frame.
   * If no ticker is attached, the loop uses requestAnimationFrame.
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
        const dt = now - this.lastTime;
        this.lastTime = now;
        this.tick(dt);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /** Stop the loop. */
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

  /** Process one frame with the given dt in milliseconds. */
  tick(dtMs: number): void {
    if (!this.callbacks) return;

    this._frameCount++;

    // 1. Early Update
    this.callbacks.earlyUpdate(dtMs);

    // 2. Fixed Update (accumulator-based)
    this.accumulator += dtMs;
    let steps = 0;
    while (
      this.accumulator >= this.fixedTimestep &&
      steps < this.maxFixedStepsPerFrame
    ) {
      this.callbacks.fixedUpdate(this.fixedTimestep);
      this.accumulator -= this.fixedTimestep;
      steps++;
    }

    // 3. Update
    this.callbacks.update(dtMs);

    // 4. Late Update
    this.callbacks.lateUpdate(dtMs);

    // 5. Render
    this.callbacks.render(dtMs);

    // 6. End of Frame
    this.callbacks.endOfFrame(dtMs);
  }
}
