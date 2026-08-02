import type { Inspector } from "@yagejs/core";

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
  /**
   * Set while a step is draining or a driven run is using the clock. Whoever
   * holds it issues the only frames until it resolves.
   */
  private busy = false;
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

  /** The frame the engine is on, counted by the debug clock. */
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

  /** Does nothing while a step or a driven run owns the clock. */
  play(): void {
    if (this.running || this.busy) return;
    this.ensureFrozen();
    this.running = true;
    this.last = performance.now();
    this.carry = 0;
    this.tick();
  }

  pause(): void {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  /**
   * Advances `frames` with the clock paused. `stepAsync` rather than `step`:
   * `step` is synchronous, so awaiting it drains nothing and anything a frame
   * starts asynchronously lands after the result is read. It yields a real
   * macrotask between frames, which is why `play` waits for it: both writing
   * the clock at once would issue two sets of frames.
   *
   * Does nothing while something else owns the clock, for the same reason.
   */
  async step(frames = 1): Promise<void> {
    if (this.busy) return;
    this.pause();
    this.ensureFrozen();
    this.busy = true;
    try {
      await this.time.stepAsync(frames);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Runs `work` with the clock stopped and held, then restores the play state
   * it had. A driven run issues its own frames, so `play` and `step` stand
   * down for the duration rather than issuing a second set.
   */
  async whileStopped<T>(work: () => Promise<T>): Promise<T> {
    const wasRunning = this.running;
    this.pause();
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
      if (wasRunning) this.play();
    }
  }

  /**
   * The engine boots with its own ticker advancing time. Freezing is what makes
   * pause, step and speed mean anything, and `stepAsync` throws unless the
   * clock is already frozen.
   */
  private ensureFrozen(): void {
    if (!this.time.isFrozen()) this.time.freeze();
    this.time.setDelta(STEP_MS);
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
      this.time.step(frames);
    } catch (error) {
      this.pause();
      this.options.onError(error);
    }
  };
}
