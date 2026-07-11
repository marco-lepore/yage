import { describe, expect, it } from "vitest";
import { heuristics, resolveHeuristic } from "./heuristics.js";

describe("heuristics", () => {
  it("manhattan sums the deltas", () => {
    expect(heuristics.manhattan(3, 4)).toBe(7);
  });

  it("chebyshev takes the larger delta", () => {
    expect(heuristics.chebyshev(3, 4)).toBe(4);
  });

  it("octile combines the deltas with sqrt2 on the shared diagonal", () => {
    expect(heuristics.octile(3, 3)).toBeCloseTo(3 * Math.SQRT2);
    expect(heuristics.octile(5, 2)).toBeCloseTo(3 + 2 * Math.SQRT2);
  });

  it("euclidean is the straight-line distance", () => {
    expect(heuristics.euclidean(3, 4)).toBe(5);
  });

  it("is zero at the same cell for every heuristic", () => {
    for (const fn of Object.values(heuristics)) {
      expect(fn(0, 0)).toBe(0);
    }
  });

  it("is symmetric in dx/dy", () => {
    for (const fn of Object.values(heuristics)) {
      expect(fn(3, 5)).toBeCloseTo(fn(5, 3));
    }
  });

  describe("resolveHeuristic", () => {
    it("defaults to octile when diagonals are allowed", () => {
      expect(resolveHeuristic(undefined, "always")).toBe(heuristics.octile);
      expect(resolveHeuristic(undefined, "no-corner-cutting")).toBe(heuristics.octile);
    });

    it("defaults to manhattan when diagonals are disabled", () => {
      expect(resolveHeuristic(undefined, "never")).toBe(heuristics.manhattan);
    });

    it("honors an explicit heuristic name over the default", () => {
      expect(resolveHeuristic("euclidean", "never")).toBe(heuristics.euclidean);
    });
  });
});
