/** Controller infrastructure used by DebugPlugin. Use Inspector.time to drive games. */
export interface IDebugClock {
  readonly isFrozen: boolean;
  step(dtMs?: number): void;
  stepFrames(count: number, dtMs?: number): void;
  freeze(): void;
  thaw(): void;
  setDelta(ms: number): void;
}

/**
 * Hooks the clock uses to drive the host. The host owns the synthetic-time
 * bookkeeping and the ticker plumbing — `DebugClock` stays a pure state
 * machine. Production wires this against Pixi's `app.ticker` so a manual
 * `step()` fires every ticker subscriber (GameLoop, AnimatedSprite,
 * pixi-filters, render) with the same synthetic dt.
 */
export interface DebugClockHost {
  readonly fixedTimestep: number;
  /** Advance one synthetic frame of `dtMs`. Fires every ticker subscriber. */
  advance(dtMs: number): void;
  /** Stop auto-advance. Capture state needed to make `advance` deterministic. */
  freeze(): void;
  /** Resume auto-advance. Restore captured state so the next rAF is sane. */
  thaw(): void;
}

/**
 * Controls engine time-stepping for deterministic E2E tests.
 *
 * While frozen the renderer ticker is paused and frames advance only via
 * explicit `step()` / `stepFrames()` calls.
 */
export class DebugClock implements IDebugClock {
  private _isFrozen = false;
  private deltaMs: number;

  constructor(private readonly host: DebugClockHost) {
    this.deltaMs = host.fixedTimestep;
  }

  get isFrozen(): boolean {
    return this._isFrozen;
  }

  thaw(): void {
    if (!this._isFrozen) return;
    this.host.thaw();
    this._isFrozen = false;
  }

  freeze(): void {
    if (this._isFrozen) return;
    this.host.freeze();
    this._isFrozen = true;
  }

  setDelta(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error("DebugClock.setDelta(ms) requires a positive number.");
    }
    this.deltaMs = ms;
  }

  step(dtMs?: number): void {
    if (!this._isFrozen) {
      throw new Error("DebugClock is not frozen. Call clock.freeze() first.");
    }
    const dt = dtMs ?? this.deltaMs;
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new Error("DebugClock.step(dtMs) requires a positive number.");
    }
    this.host.advance(dt);
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
}
