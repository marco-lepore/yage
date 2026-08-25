import { describe, expect, it } from "vitest";
import {
  defineFeelEffect,
  feelDelay,
  feelParallel,
  feelRepeat,
  feelSequence,
} from "./node.js";
import type { ScheduledFeelEffect } from "./types.js";

describe("feel cue nodes", () => {
  const leaf = (duration: number) => defineFeelEffect(duration, () => ({}));

  it("computes sequence and parallel durations", () => {
    expect(feelParallel(leaf(1), leaf(2)).duration).toBe(2);
    expect(feelSequence(leaf(1), leaf(2)).duration).toBe(3);
    expect(feelDelay(0.5, leaf(1)).duration).toBe(1.5);
    expect(feelRepeat(leaf(1), 3, 0.25).duration).toBe(3.5);
  });

  it("flattens nested schedules at the expected offsets", () => {
    const node = feelSequence(
      feelDelay(0.25, leaf(0.5)),
      feelParallel(leaf(1), feelDelay(0.2, leaf(0.1))),
    );
    const output: ScheduledFeelEffect[] = [];
    node._schedule(2, output);
    expect(output.map((entry) => entry.at)).toEqual([2.25, 2.75, 2.95]);
  });

  it("rejects invalid durations and repeat counts", () => {
    expect(() => leaf(-1)).toThrow(/duration/);
    expect(() => feelDelay(Number.NaN)).toThrow(/duration/);
    expect(() => feelRepeat(leaf(1), 1.5)).toThrow(/times/);
  });
});
