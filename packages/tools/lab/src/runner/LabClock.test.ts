import type { Inspector } from "@yagejs/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_SPEEDS,
  LabClock,
  nearestSpeedIndex,
  STEP_MS,
} from "./LabClock.js";

/** The slice of `Inspector.time` the clock uses, with the calls recorded. */
function fakeTime() {
  const state = {
    frozen: false,
    delta: 0,
    frame: 0,
    stepped: [] as number[],
    steppedAsync: [] as number[],
    throwOnStep: null as Error | null,
    freezeThrows: null as Error | null,
  };
  const time = {
    freeze: () => {
      if (state.freezeThrows) throw state.freezeThrows;
      state.frozen = true;
    },
    isFrozen: () => state.frozen,
    setDelta: (ms: number) => {
      state.delta = ms;
    },
    getFrame: () => state.frame,
    step: (frames: number) => {
      if (state.throwOnStep) throw state.throwOnStep;
      state.stepped.push(frames);
      state.frame += frames;
    },
    stepAsync: (frames: number) => {
      state.steppedAsync.push(frames);
      state.frame += frames;
      return Promise.resolve();
    },
  };
  return { state, time: time as unknown as Inspector["time"] };
}

let now = 0;
let queued: FrameRequestCallback | undefined;

/** Runs the animation frame the clock is waiting on, `wall` milliseconds later. */
function frame(wall: number): void {
  now += wall;
  const callback = queued;
  queued = undefined;
  callback?.(now);
}

beforeEach(() => {
  now = 0;
  queued = undefined;
  globalThis.requestAnimationFrame = (callback) => {
    queued = callback;
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {
    queued = undefined;
  };
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const errors: unknown[] = [];
const makeClock = () => {
  errors.length = 0;
  const { state, time } = fakeTime();
  const clock = new LabClock(time, {
    onError: (error) => {
      errors.push(error);
    },
  });
  return { state, clock };
};

describe("LabClock", () => {
  it("does not touch the clock until it is asked to", () => {
    const { state } = makeClock();
    expect(state.frozen).toBe(false);
  });

  it("takes the engine's clock on freeze, without running", () => {
    const { state, clock } = makeClock();
    clock.freeze();
    expect(state.frozen).toBe(true);
    expect(state.delta).toBe(STEP_MS);
    expect(clock.isRunning).toBe(false);
  });

  it("stays paused rather than half-running when freezing fails", () => {
    const { state, clock } = makeClock();
    state.freezeThrows = new Error("Inspector.time requires DebugPlugin");
    expect(() => clock.play()).toThrow("DebugPlugin");
    expect(clock.isRunning).toBe(false);
  });

  it("stands down while a step is draining", async () => {
    const { state, clock } = makeClock();
    const stepping = clock.step(3);
    clock.play();
    expect(clock.isRunning).toBe(false);
    await stepping;
    clock.play();
    expect(clock.isRunning).toBe(true);
    expect(state.steppedAsync).toEqual([3]);
  });

  it("freezes and pins the delta on play", () => {
    const { state, clock } = makeClock();
    clock.play();
    expect(state.frozen).toBe(true);
    expect(state.delta).toBe(STEP_MS);
    expect(clock.isRunning).toBe(true);
  });

  it("issues frames for the wall time that passed", () => {
    const { state, clock } = makeClock();
    clock.play();
    frame(100);
    expect(state.stepped).toEqual([5]);
  });

  it("scales how often a frame is issued, never the delta", () => {
    const { state, clock } = makeClock();
    clock.setSpeed(0.25);
    clock.play();
    frame(100);
    expect(state.stepped).toEqual([1]);
    expect(state.delta).toBe(STEP_MS);
  });

  it("caps a burst, so a backgrounded tab does not catch up at once", () => {
    const { state, clock } = makeClock();
    clock.setSpeed(4);
    clock.play();
    frame(10_000);
    expect(state.stepped).toEqual([8]);
  });

  it("drops the time the cap refused instead of owing it", () => {
    // A capped burst that banked the remainder would spend it a full burst at
    // a time on every frame afterwards, running faster than the chosen speed
    // long after the stall ended.
    const { state, clock } = makeClock();
    clock.setSpeed(4);
    clock.play();
    frame(10_000);
    state.stepped.length = 0;

    frame(16);
    // 16 ms at 4x is 64 ms of credit: three whole frames, not another burst.
    expect(state.stepped).toEqual([3]);
  });

  it("issues nothing more once paused", () => {
    const { state, clock } = makeClock();
    clock.play();
    frame(100);
    clock.pause();
    frame(100);
    expect(state.stepped).toEqual([5]);
    expect(clock.isRunning).toBe(false);
  });

  it("clamps the speed to what the panel offers", () => {
    const { clock } = makeClock();
    clock.setSpeed(99);
    expect(clock.speed).toBe(4);
    clock.setSpeed(0);
    expect(clock.speed).toBe(0.05);
  });

  it("keeps a speed between the offered ones", () => {
    const { clock } = makeClock();
    clock.setSpeed(0.33);
    expect(clock.speed).toBe(0.33);
  });

  it("rejects a speed that is not a number", () => {
    const { clock } = makeClock();
    expect(() => clock.setSpeed(NaN)).toThrow("finite number");
  });

  it("pauses before stepping, and steps asynchronously", async () => {
    const { state, clock } = makeClock();
    clock.play();
    await clock.step(10);
    expect(clock.isRunning).toBe(false);
    expect(state.steppedAsync).toEqual([10]);
    expect(state.frozen).toBe(true);
  });

  it("pauses and reports when a frame throws", () => {
    const { state, clock } = makeClock();
    clock.play();
    state.throwOnStep = new Error("component blew up");
    frame(100);
    expect(clock.isRunning).toBe(false);
    expect(errors).toEqual([state.throwOnStep]);
  });

  it("restores a running clock after whileStopped", async () => {
    const { clock } = makeClock();
    clock.play();
    clock.setSpeed(2);
    let ranWhilePaused = false;
    await clock.whileStopped(() => {
      ranWhilePaused = !clock.isRunning;
      return Promise.resolve();
    });
    expect(ranWhilePaused).toBe(true);
    expect(clock.isRunning).toBe(true);
    expect(clock.speed).toBe(2);
  });

  it("issues nothing of its own while whileStopped holds it", async () => {
    const { state, clock } = makeClock();
    clock.play();
    let ranWhileHeld: number[] = [];
    await clock.whileStopped(async () => {
      clock.play();
      await clock.step(10);
      frame(100);
      ranWhileHeld = [...state.stepped, ...state.steppedAsync];
    });
    // The work owns the clock, so neither play nor step may add a frame to it.
    expect(ranWhileHeld).toEqual([]);
    expect(clock.isRunning).toBe(true);
  });

  it("leaves a paused clock paused after whileStopped", async () => {
    const { clock } = makeClock();
    await clock.whileStopped(() => Promise.resolve());
    expect(clock.isRunning).toBe(false);
  });

  it("restores the clock even when the work throws", async () => {
    const { clock } = makeClock();
    clock.play();
    await expect(
      clock.whileStopped(() => Promise.reject(new Error("run failed"))),
    ).rejects.toThrow("run failed");
    expect(clock.isRunning).toBe(true);
  });

  it("reports the frame the engine is on", () => {
    const { clock } = makeClock();
    clock.play();
    frame(100);
    expect(clock.frame).toBe(5);
  });
});

describe("nearestSpeedIndex", () => {
  it("finds an offered speed exactly", () => {
    expect(nearestSpeedIndex(1)).toBe(CLOCK_SPEEDS.indexOf(1));
    expect(nearestSpeedIndex(0.05)).toBe(0);
    expect(nearestSpeedIndex(4)).toBe(CLOCK_SPEEDS.length - 1);
  });

  it("picks the closest for a speed in between", () => {
    expect(CLOCK_SPEEDS[nearestSpeedIndex(0.6)]).toBe(0.5);
    expect(CLOCK_SPEEDS[nearestSpeedIndex(3)]).toBe(2);
  });
});
