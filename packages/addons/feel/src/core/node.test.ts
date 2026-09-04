import { describe, expect, it } from "vitest";
import {
  defineFeelEffect,
  defineFeelState,
  feelDelay,
  feelLoop,
  feelParallel,
  feelRepeat,
  feelSequence,
} from "./node.js";

describe("feel cue nodes", () => {
  const leaf = (duration: number) => defineFeelEffect(duration, () => ({}));

  it("computes sequence and parallel durations", () => {
    expect(feelParallel(leaf(1), leaf(2)).duration).toBe(2);
    expect(feelSequence(leaf(1), leaf(2)).duration).toBe(3);
    expect(feelDelay(0.5, leaf(1)).duration).toBe(1.5);
    expect(feelRepeat(leaf(1), 3, 0.25).duration).toBe(3.5);
  });

  it("marks stateful compositions and loops as dynamic", () => {
    const state = defineFeelState({}, () => ({ update: () => {} }));

    expect(state.duration).toBeNull();
    expect(feelParallel(leaf(1), state).duration).toBeNull();
    expect(feelSequence(leaf(1), state).duration).toBeNull();
    expect(feelDelay(0.5, state).duration).toBeNull();
    expect(feelLoop(leaf(1)).duration).toBeNull();
  });

  it("rejects invalid durations and repeat counts", () => {
    expect(() => leaf(-1)).toThrow(/duration/);
    expect(() => feelDelay(Number.NaN)).toThrow(/duration/);
    expect(() => feelRepeat(leaf(1), 1.5)).toThrow(/times/);
    expect(() =>
      feelRepeat(
        defineFeelState({}, () => ({ update: () => {} })),
        2,
      ),
    ).toThrow(/finite duration/);
    expect(() => feelLoop(leaf(0))).toThrow(/positive gap/);
    expect(() =>
      defineFeelState({ attack: -1 }, () => ({ update: () => {} })),
    ).toThrow(/attack/);
  });
});
