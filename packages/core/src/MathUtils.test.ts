import { describe, it, expect } from "vitest";
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

  describe("inverseLerp", () => {
    it("returns the interpolation factor for a value in range", () => {
      expect(MathUtils.inverseLerp(0, 10, 2.5)).toBe(0.25);
    });

    it("clamps below the range", () => {
      expect(MathUtils.inverseLerp(0, 10, -5)).toBe(0);
    });

    it("clamps above the range", () => {
      expect(MathUtils.inverseLerp(0, 10, 15)).toBe(1);
    });

    it("works with an inverted range", () => {
      expect(MathUtils.inverseLerp(10, 0, 2.5)).toBe(0.75);
    });

    it("returns 0 for a zero-width range", () => {
      expect(MathUtils.inverseLerp(5, 5, 10)).toBe(0);
    });
  });

  describe("lerpAngle / shortestAngleBetween", () => {
    it("computes the signed shortest angular delta", () => {
      expect(MathUtils.shortestAngleBetween(0, Math.PI / 2)).toBeCloseTo(
        Math.PI / 2,
      );
      expect(MathUtils.shortestAngleBetween(0, -Math.PI / 2)).toBeCloseTo(
        -Math.PI / 2,
      );
    });

    it("wraps shortest angular deltas around +/-pi", () => {
      const delta = MathUtils.shortestAngleBetween(
        (3 * Math.PI) / 4,
        (-3 * Math.PI) / 4,
      );

      expect(delta).toBeCloseTo(Math.PI / 2);
    });

    it("preserves half-turn direction when the shortest path is ambiguous", () => {
      expect(MathUtils.shortestAngleBetween(0, Math.PI)).toBeCloseTo(Math.PI);
      expect(MathUtils.shortestAngleBetween(0, -Math.PI)).toBeCloseTo(
        -Math.PI,
      );
    });

    it("interpolates angles along the shortest path through pi", () => {
      const halfway = MathUtils.lerpAngle(
        (3 * Math.PI) / 4,
        (-3 * Math.PI) / 4,
        0.5,
      );

      expect(halfway).toBeCloseTo(Math.PI);
    });

    it("returns a normalized target angle at t=1", () => {
      const result = MathUtils.lerpAngle(
        (3 * Math.PI) / 4,
        (-3 * Math.PI) / 4,
        1,
      );

      expect(result).toBeCloseTo((-3 * Math.PI) / 4);
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

  describe("pingPong", () => {
    it("returns 0 at t=0", () => {
      expect(MathUtils.pingPong(0, 10)).toBe(0);
    });

    it("returns length at t=length", () => {
      expect(MathUtils.pingPong(10, 10)).toBe(10);
    });

    it("returns 0 at t=2*length", () => {
      expect(MathUtils.pingPong(20, 10)).toBe(0);
    });

    it("bounces back after length", () => {
      expect(MathUtils.pingPong(15, 10)).toBe(5);
    });

    it("handles negative t", () => {
      expect(MathUtils.pingPong(-3, 10)).toBe(3);
    });

    it("returns 0 for non-positive lengths", () => {
      expect(MathUtils.pingPong(5, 0)).toBe(0);
      expect(MathUtils.pingPong(5, -1)).toBe(0);
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

  describe("smoothDamp", () => {
    it("moves toward the target and returns velocity for the next step", () => {
      const result = MathUtils.smoothDamp(0, 10, 0, 1, 0.5);

      expect(result.value).toBeGreaterThan(0);
      expect(result.value).toBeLessThan(10);
      expect(result.velocity).toBeGreaterThan(0);
    });

    it("threads returned velocity through subsequent calls", () => {
      const first = MathUtils.smoothDamp(0, 10, 0, 1, 0.5);
      const second = MathUtils.smoothDamp(
        first.value,
        10,
        first.velocity,
        1,
        0.5,
      );

      expect(second.value).toBeGreaterThan(first.value);
      expect(second.value).toBeLessThan(10);
    });

    it("does not overshoot the target", () => {
      const result = MathUtils.smoothDamp(9, 10, 100, 1, 1);

      expect(result.value).toBe(10);
      expect(result.velocity).toBe(0);
    });

    it("limits movement by maxSpeed", () => {
      const uncapped = MathUtils.smoothDamp(0, 100, 0, 1, 0.5);
      const capped = MathUtils.smoothDamp(0, 100, 0, 1, 0.5, 10);

      expect(capped.value).toBeLessThan(uncapped.value);
    });

    it("returns the current value and velocity when deltaTime is zero", () => {
      expect(MathUtils.smoothDamp(1, 10, 5, 1, 0)).toEqual({
        value: 1,
        velocity: 5,
      });
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
