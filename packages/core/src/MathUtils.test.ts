import { describe, it, expect, vi } from "vitest";
import { MathUtils } from "./MathUtils.js";

describe("MathUtils", () => {
  describe("lerp", () => {
    it("interpolates at t=0", () => {
      expect(MathUtils.lerp(0, 10, 0)).toBe(0);
    });

    it("interpolates at t=1", () => {
      expect(MathUtils.lerp(0, 10, 1)).toBe(10);
    });

    it("interpolates at t=0.5", () => {
      expect(MathUtils.lerp(0, 10, 0.5)).toBe(5);
    });

    it("works with negative values", () => {
      expect(MathUtils.lerp(-10, 10, 0.5)).toBe(0);
    });
  });

  describe("clamp", () => {
    it("clamps below min", () => {
      expect(MathUtils.clamp(-5, 0, 10)).toBe(0);
    });

    it("clamps above max", () => {
      expect(MathUtils.clamp(15, 0, 10)).toBe(10);
    });

    it("passes through values in range", () => {
      expect(MathUtils.clamp(5, 0, 10)).toBe(5);
    });
  });

  describe("remap", () => {
    it("remaps value from one range to another", () => {
      expect(MathUtils.remap(5, 0, 10, 0, 100)).toBe(50);
    });

    it("remaps to inverted range", () => {
      expect(MathUtils.remap(0, 0, 10, 100, 0)).toBe(100);
    });

    it("handles edge values", () => {
      expect(MathUtils.remap(0, 0, 10, 20, 40)).toBe(20);
      expect(MathUtils.remap(10, 0, 10, 20, 40)).toBe(40);
    });
  });

  describe("randomRange", () => {
    it("returns values within range", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      expect(MathUtils.randomRange(0, 10)).toBe(5);
      vi.restoreAllMocks();
    });

    it("returns min at random=0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(MathUtils.randomRange(5, 10)).toBe(5);
      vi.restoreAllMocks();
    });
  });

  describe("randomInt", () => {
    it("returns integer within range", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const result = MathUtils.randomInt(0, 10);
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(10);
      vi.restoreAllMocks();
    });

    it("returns min at random=0", () => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect(MathUtils.randomInt(5, 10)).toBe(5);
      vi.restoreAllMocks();
    });
  });

  describe("degToRad / radToDeg", () => {
    it("converts degrees to radians", () => {
      expect(MathUtils.degToRad(180)).toBeCloseTo(Math.PI);
      expect(MathUtils.degToRad(90)).toBeCloseTo(Math.PI / 2);
      expect(MathUtils.degToRad(0)).toBe(0);
    });

    it("converts radians to degrees", () => {
      expect(MathUtils.radToDeg(Math.PI)).toBeCloseTo(180);
      expect(MathUtils.radToDeg(Math.PI / 2)).toBeCloseTo(90);
      expect(MathUtils.radToDeg(0)).toBe(0);
    });

    it("round-trips correctly", () => {
      expect(MathUtils.radToDeg(MathUtils.degToRad(45))).toBeCloseTo(45);
    });
  });

  describe("approach", () => {
    it("approaches target from below", () => {
      expect(MathUtils.approach(0, 10, 3)).toBe(3);
    });

    it("approaches target from above", () => {
      expect(MathUtils.approach(10, 0, 3)).toBe(7);
    });

    it("does not overshoot from below", () => {
      expect(MathUtils.approach(8, 10, 5)).toBe(10);
    });

    it("does not overshoot from above", () => {
      expect(MathUtils.approach(2, 0, 5)).toBe(0);
    });

    it("stays at target", () => {
      expect(MathUtils.approach(5, 5, 1)).toBe(5);
    });
  });

  describe("wrap", () => {
    it("wraps values above max", () => {
      expect(MathUtils.wrap(11, 0, 10)).toBe(1);
    });

    it("wraps values below min", () => {
      expect(MathUtils.wrap(-1, 0, 10)).toBe(9);
    });

    it("passes through values in range", () => {
      expect(MathUtils.wrap(5, 0, 10)).toBe(5);
    });

    it("wraps min to min", () => {
      expect(MathUtils.wrap(0, 0, 10)).toBe(0);
    });

    it("wraps max to min", () => {
      expect(MathUtils.wrap(10, 0, 10)).toBe(0);
    });

    it("handles negative ranges", () => {
      expect(MathUtils.wrap(190, -180, 180)).toBeCloseTo(-170);
    });
  });
});
