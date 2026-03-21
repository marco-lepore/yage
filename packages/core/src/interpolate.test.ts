import { describe, it, expect } from "vitest";
import { interpolate } from "./interpolate.js";
import { Vec2 } from "./Vec2.js";
import { easeInQuad } from "./Process.js";

describe("interpolate", () => {
  describe("number", () => {
    it("returns from at t=0", () => {
      expect(interpolate(10, 20, 0)).toBe(10);
    });

    it("returns to at t=1", () => {
      expect(interpolate(10, 20, 1)).toBe(20);
    });

    it("returns midpoint at t=0.5", () => {
      expect(interpolate(0, 100, 0.5)).toBeCloseTo(50);
    });

    it("applies easing function", () => {
      // easeInQuad(0.5) = 0.25
      expect(interpolate(0, 100, 0.5, easeInQuad)).toBeCloseTo(25);
    });
  });

  describe("Vec2Like", () => {
    it("returns from at t=0", () => {
      const result = interpolate(new Vec2(10, 20), new Vec2(30, 40), 0);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(20);
    });

    it("returns to at t=1", () => {
      const result = interpolate(new Vec2(10, 20), new Vec2(30, 40), 1);
      expect(result.x).toBeCloseTo(30);
      expect(result.y).toBeCloseTo(40);
    });

    it("returns midpoint at t=0.5", () => {
      const result = interpolate(new Vec2(0, 0), new Vec2(100, 200), 0.5);
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(100);
    });

    it("applies easing function", () => {
      const result = interpolate(
        new Vec2(0, 0),
        new Vec2(100, 100),
        0.5,
        easeInQuad,
      );
      expect(result.x).toBeCloseTo(25);
      expect(result.y).toBeCloseTo(25);
    });

    it("returns a Vec2 instance", () => {
      const result = interpolate(new Vec2(0, 0), new Vec2(10, 10), 0.5);
      expect(result).toBeInstanceOf(Vec2);
    });
  });
});
