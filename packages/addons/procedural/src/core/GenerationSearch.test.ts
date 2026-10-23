import { expect, it } from "vitest";
import { GenerationSearch } from "./GenerationSearch.js";

/** Each attempt runs `lengths[attempt]` operations, then finishes with `outcome`. */
class Attempts extends GenerationSearch<number> {
  attempts = 0;
  constructor(
    private readonly lengths: readonly number[],
    private readonly outcome: number | null,
    maxSteps: number,
    restartLimit?: number,
  ) {
    super({ seed: 0, maxSteps }, restartLimit);
  }
  protected *run(): Generator<void, number | null> {
    const length = this.lengths[this.attempts++]!;
    for (let i = 0; i < length; i++) yield;
    return this.outcome;
  }
}

it("restarts an attempt that reaches the limit and doubles the limit", () => {
  const job = new Attempts([100, 100, 15], 7, 1000, 10);
  expect(job.generate()).toBe(7);
  // 10 operations, then 20, then the third attempt's 16.
  expect(job.attempts).toBe(3);
  expect(job.steps).toBe(46);
});

it("reports exhausted only from an attempt that finished", () => {
  const job = new Attempts([30, 30], null, 1000, 20);
  expect(job.generate()).toBeNull();
  expect(job.status).toBe("exhausted");
  expect(job.attempts).toBe(2);
});

it("counts restarts in the budget diagnostic", () => {
  const job = new Attempts([100, 100, 100], 7, 40, 10);
  job.generate();
  expect(job.status).toBe("budget-exceeded");
  expect(job.inspect().diagnostics.at(-1)?.message).toBe(
    "The 40-step budget ran out after 2 restarts. This does not prove the inputs impossible.",
  );
});

it("never restarts a job without a limit", () => {
  const job = new Attempts([100], 7, 1000);
  expect(job.generate()).toBe(7);
  expect(job.attempts).toBe(1);
});
