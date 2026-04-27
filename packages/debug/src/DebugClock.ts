/** Public interface for the manual debug clock, accessible via `window.__yage__.clock`. */
export interface IDebugClock {
  readonly isManual: boolean;
  startAuto(): void;
  stopAuto(): void;
  step(dtMs?: number): void;
  stepFrames(count: number, dtMs?: number): void;
  freeze(): void;
  thaw(): void;
  setDelta(ms: number): void;
  getFrame(): number;
}

/** Minimal view of a game loop needed by the debug clock. */
interface GameLoopLike {
  tick(dtMs: number): void;
  readonly fixedTimestep: number;
}

/**
 * Controls engine time-stepping for deterministic E2E tests.
 *
 * When manual mode is active the renderer ticker is paused and frames
 * advance only via explicit `step()` / `stepFrames()` calls.
 */
export class DebugClock implements IDebugClock {
  private _isManual = false;
  private deltaMs: number;
  private frame = 0;

  constructor(
    private readonly gameLoop: GameLoopLike,
    private readonly stopTicker: () => void,
    private readonly startTicker: () => void,
    private readonly render: () => void,
  ) {
    this.deltaMs = gameLoop.fixedTimestep;
  }

  get isManual(): boolean {
    return this._isManual;
  }

  startAuto(): void {
    if (!this._isManual) return;
    this.startTicker();
    this._isManual = false;
  }

  stopAuto(): void {
    if (this._isManual) return;
    this.stopTicker();
    this._isManual = true;
  }

  freeze(): void {
    this.stopAuto();
  }

  thaw(): void {
    this.startAuto();
  }

  setDelta(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error("DebugClock.setDelta(ms) requires a positive number.");
    }
    this.deltaMs = ms;
  }

  getFrame(): number {
    return this.frame;
  }

  step(dtMs?: number): void {
    if (!this._isManual) {
      throw new Error(
        "Manual clock is not active. Call clock.stopAuto() first.",
      );
    }
    const dt = dtMs ?? this.deltaMs;
    // Increment after a successful tick — if tick throws (system exception,
    // render failure) the frame counter shouldn't advance ahead of state.
    this.gameLoop.tick(dt);
    this.frame++;
    this.render();
  }

  stepFrames(count: number, dtMs?: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        "stepFrames(count) requires a non-negative integer count.",
      );
    }
    for (let i = 0; i < count; i++) {
      this.step(dtMs);
    }
  }

  /** Enter or exit manual mode. Used by DebugPlugin for config-driven init. */
  setManual(enabled: boolean): void {
    if (enabled === this._isManual) return;
    if (enabled) {
      this.stopTicker();
    } else {
      this.startTicker();
    }
    this._isManual = enabled;
  }
}
