import type {
  Inspector,
  InspectorTimeControl,
  InspectorTimeLease,
} from "@yagejs/core";

/** What every frame simulates, at every speed. */
export const STEP_MS = 1000 / 60;

const MIN_SPEED = 0.05;
const MAX_SPEED = 4;

/** The speeds the panel's slider offers, slowest first. */
export const CLOCK_SPEEDS: readonly number[] = [
  MIN_SPEED,
  0.15,
  0.25,
  0.5,
  1,
  2,
  MAX_SPEED,
];

/** Frames one animation frame may issue, so a backgrounded tab cannot catch up in one burst. */
const MAX_BURST = 8;

/** Wall-clock milliseconds one animation frame may contribute. */
const MAX_WALL_MS = 250;

type TimeApi = Inspector["time"];

export interface LabClockOptions {
  /**
   * Called when issuing a frame throws. The clock has already paused itself.
   * A throw that escapes a whole frame stops the engine's game loop and
   * detaches its ticker, so the page has to be reloaded to run again.
   */
  onError(error: unknown): void;
}

/** The index in {@link CLOCK_SPEEDS} closest to `speed`. */
export function nearestSpeedIndex(speed: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (const [index, candidate] of CLOCK_SPEEDS.entries()) {
    const distance = Math.abs(candidate - speed);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Owns the frozen engine clock and issues frames from `requestAnimationFrame`.
 *
 * Speed changes how often a frame is issued, never how long the game thinks a
 * frame lasted — the delta stays pinned at {@link STEP_MS}. Scaling scene time
 * instead would multiply into the same product a game's own hitstop and
 * `timeScale` effects use, so slow motion would change the thing being watched.
 */
export class LabClock {
  private handle = 0;
  private carry = 0;
  private last = 0;
  private running = false;
  private playLease: InspectorTimeLease | undefined;
  private rate = 1;

  constructor(
    private readonly time: TimeApi,
    private readonly options: LabClockOptions,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  get speed(): number {
    return this.rate;
  }

  /** The current engine frame number. */
  get frame(): number {
    return this.time.getFrame();
  }

  /**
   * Sets the rate frames are issued at, clamped to 0.05x..4x. Any value in
   * that range is kept as given — the slider's own steps are only what the
   * panel offers.
   */
  setSpeed(value: number): void {
    if (!Number.isFinite(value)) {
      throw new Error(`LabClock.setSpeed(): ${value} is not a finite number.`);
    }
    this.rate = Math.min(MAX_SPEED, Math.max(MIN_SPEED, value));
    this.carry = 0;
  }

  /**
   * Takes the engine's clock, which advances on its own until something
   * freezes it. Call once the engine has started — `Inspector.time` throws
   * before `DebugPlugin` is installed — and before anything reads the frame
   * count, because a clock nobody froze keeps simulating while the panel
   * reports it as paused.
   */
  freeze(): void {
    this.ensureFrozen();
  }

  /** Starts issuing frames. Repeated calls while playing do nothing. */
  play(): void {
    if (this.running) return;
    const lease = this.time.acquire();
    try {
      this.ensureFrozen(lease);
    } catch (error) {
      lease.release();
      throw error;
    }
    this.playLease = lease;
    this.running = true;
    this.last = performance.now();
    this.carry = 0;
    this.tick();
  }

  pause(): void {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
    this.playLease?.release();
    this.playLease = undefined;
  }

  /**
   * Advances `frames` while paused, yielding between frames for asynchronous
   * game work. Other clock commands reject until stepping finishes.
   */
  async step(frames = 1): Promise<void> {
    this.pause();
    const lease = this.time.acquire();
    try {
      this.ensureFrozen(lease);
      await lease.stepAsync(frames);
    } finally {
      lease.release();
    }
  }

  /**
   * Runs `work` with exclusive clock control, then restores the previous play
   * state. The callback uses its lease to advance frames.
   */
  async whileStopped<T>(
    work: (time: InspectorTimeLease) => Promise<T>,
  ): Promise<T> {
    const wasRunning = this.running;
    this.pause();
    const lease = this.time.acquire();
    try {
      this.ensureFrozen(lease);
      return await work(lease);
    } finally {
      lease.release();
      if (wasRunning) this.play();
    }
  }

  /**
   * The engine boots with its own ticker advancing time. Freezing is what makes
   * pause, step and speed mean anything, and `stepAsync` throws unless the
   * clock is already frozen.
   */
  private ensureFrozen(time: InspectorTimeControl = this.time): void {
    if (!time.isFrozen()) time.freeze();
    time.setDelta(STEP_MS);
  }

  private readonly tick = (): void => {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);
    const now = performance.now();
    const wall = Math.min(now - this.last, MAX_WALL_MS);
    this.last = now;
    this.carry += wall * this.rate;
    let frames = 0;
    while (this.carry >= STEP_MS && frames < MAX_BURST) {
      this.carry -= STEP_MS;
      frames++;
    }
    // Time the cap refused is dropped rather than owed. Keeping it would spend
    // the backlog a full burst at a time on every frame after a stall, which
    // runs the scene faster than the chosen speed long after the stall ended.
    if (frames === MAX_BURST) this.carry = 0;
    if (frames === 0) return;
    try {
      this.playLease!.step(frames);
    } catch (error) {
      this.pause();
      this.options.onError(error);
    }
  };
}
