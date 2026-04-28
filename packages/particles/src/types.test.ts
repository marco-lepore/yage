import { describe, it, expect } from "vitest";
import { createRandomService } from "@yagejs/core";
import { resolveRange, isLerped } from "./types.js";

const random = createRandomService(42);

describe("resolveRange", () => {
  it("returns a number as-is", () => {
    expect(resolveRange(42, random)).toBe(42);
  });

  it("returns a value within [min, max] for a range", () => {
    for (let i = 0; i < 50; i++) {
      const v = resolveRange([10, 20], random);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it("returns min when min === max", () => {
    expect(resolveRange([5, 5], random)).toBe(5);
  });

  it("handles negative ranges", () => {
    for (let i = 0; i < 50; i++) {
      const v = resolveRange([-10, -5], random);
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThanOrEqual(-5);
    }
  });

  it("handles zero", () => {
    expect(resolveRange(0, random)).toBe(0);
  });
});

describe("isLerped", () => {
  it("returns true for a Lerped object", () => {
    expect(isLerped({ start: 0, end: 1 })).toBe(true);
  });

  it("returns true for a Lerped object with ranges", () => {
    expect(isLerped({ start: [0, 0.5], end: [0.8, 1] })).toBe(true);
  });

  it("returns false for a number", () => {
    expect(isLerped(5)).toBe(false);
  });

  it("returns false for a tuple range", () => {
    expect(isLerped([1, 2])).toBe(false);
  });
});
