import { describe, it, expect } from "vitest";
import {
  assertDuration,
  durationProgress,
  durationReached,
  loopRemainder,
} from "./duration.js";

const STEP = 1 / 60;

/** Sum `n` steps the way a process accumulates them, in float. */
function accumulate(n: number, step = STEP): number {
  let elapsed = 0;
  for (let i = 0; i < n; i++) elapsed += step;
  return elapsed;
}

describe("durationReached", () => {
  it("counts a sum that lands a float hair under the duration", () => {
    const elapsed = accumulate(6);
    expect(elapsed).toBeLessThan(0.1);
    expect(durationReached(elapsed, 0.1)).toBe(true);
  });

  it("does not count the step before", () => {
    expect(durationReached(accumulate(5), 0.1)).toBe(false);
  });

  it("holds at magnitudes far apart", () => {
    // A hit window and a round timer accumulate very different amounts of
    // float error, so the tolerance scales with the duration.
    expect(durationReached(accumulate(3), 0.05)).toBe(true);
    expect(durationReached(accumulate(2), 0.05)).toBe(false);
    expect(durationReached(accumulate(36000), 600)).toBe(true);
    expect(durationReached(accumulate(35999), 600)).toBe(false);
  });

  it("rejects an elapsed short by more than the tolerance", () => {
    expect(durationReached(0.0999, 0.1)).toBe(false);
  });
});

describe("durationProgress", () => {
  it("reads exactly 1 on the tick that reaches the duration", () => {
    expect(durationProgress(accumulate(30), 0.5)).toBe(1);
  });

  it("reads the plain ratio before then", () => {
    expect(durationProgress(0.25, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("loopRemainder", () => {
  it("starts the next pass at 0 when the tick landed a hair under", () => {
    expect(loopRemainder(accumulate(6), 0.1)).toBe(0);
  });

  it("carries overshoot forward", () => {
    expect(loopRemainder(0.13, 0.1)).toBeCloseTo(0.03, 12);
  });

  it("folds an overshoot spanning several periods into one", () => {
    expect(loopRemainder(0.35, 0.1)).toBeCloseTo(0.05, 12);
  });
});

describe("assertDuration", () => {
  it("accepts a finite positive duration", () => {
    expect(() => assertDuration("Tween.to", 0.5)).not.toThrow();
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("rejects %p", (value) => {
    expect(() => assertDuration("Tween.to", value)).toThrow(
      `Tween.to: duration must be a finite number > 0 in seconds, got ${value}.`,
    );
  });
});
