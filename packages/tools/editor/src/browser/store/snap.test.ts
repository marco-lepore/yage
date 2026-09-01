import { describe, expect, it } from "vitest";
import {
  clampStep,
  DEFAULT_STEP,
  latticeMultiple,
  MAX_STEP,
  MIN_STEP,
  snappedAngle,
  snappedPoint,
  snappedValue,
} from "./snap.js";

describe("snappedValue", () => {
  it("rounds to the nearest multiple, in both directions", () => {
    expect(snappedValue(14, 10)).toBe(10);
    expect(snappedValue(16, 10)).toBe(20);
    expect(snappedValue(-14, 10)).toBe(-10);
    expect(snappedValue(-16, 10)).toBe(-20);
    expect(snappedValue(96, 32)).toBe(96);
  });

  it("produces a negative zero just below the origin, which writes as 0", () => {
    const value = snappedValue(-4, 10);

    expect(Object.is(value, -0)).toBe(true);
    // What reaches a level file is the JSON, and the canonical writer emits
    // the same text for both zeros.
    expect(JSON.stringify(value)).toBe("0");
  });
});

describe("snappedPoint", () => {
  it("rounds each coordinate on its own", () => {
    expect(snappedPoint({ x: 14, y: 26 }, 10)).toEqual({ x: 10, y: 30 });
  });
});

describe("snappedAngle", () => {
  it("rounds to a whole number of steps", () => {
    const step = Math.PI / 12;

    expect(snappedAngle(step * 2.4, step)).toBeCloseTo(step * 2, 12);
    expect(snappedAngle(-step * 2.6, step)).toBeCloseTo(-step * 3, 12);
  });
});

describe("latticeMultiple", () => {
  it("draws the lattice itself when it is already wide enough", () => {
    expect(latticeMultiple(1)).toEqual({ times: 1, span: 5 });
    expect(latticeMultiple(0.2)).toEqual({ times: 1, span: 5 });
    expect(latticeMultiple(0)).toEqual({ times: 1, span: 5 });
  });

  it("walks the 1-2-5 ladder above it", () => {
    expect(latticeMultiple(1.5).times).toBe(2);
    expect(latticeMultiple(2).times).toBe(2);
    expect(latticeMultiple(4).times).toBe(5);
    expect(latticeMultiple(6).times).toBe(10);
    expect(latticeMultiple(11).times).toBe(20);
    expect(latticeMultiple(30).times).toBe(50);
  });

  it("puts four fine lines to a major one at 5, five everywhere else", () => {
    expect(latticeMultiple(4).span).toBe(4);
    expect(latticeMultiple(1.5).span).toBe(5);
    expect(latticeMultiple(6).span).toBe(5);
  });
});

describe("clampStep", () => {
  it("holds the step inside its bounds", () => {
    expect(clampStep(64)).toBe(64);
    expect(clampStep(0.1)).toBe(MIN_STEP);
    expect(clampStep(-5)).toBe(MIN_STEP);
    expect(clampStep(1e9)).toBe(MAX_STEP);
  });

  it("falls back to the default only for a value that is not a number", () => {
    expect(clampStep(Number.NaN)).toBe(DEFAULT_STEP);
    // A typed `1e999` reaches this as Infinity, and the ceiling is what the
    // developer asked for; resetting to the default would read as the field
    // refusing the number rather than bounding it.
    expect(clampStep(Number.POSITIVE_INFINITY)).toBe(MAX_STEP);
    expect(clampStep(Number.NEGATIVE_INFINITY)).toBe(MIN_STEP);
  });
});
