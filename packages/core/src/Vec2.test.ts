import { describe, it, expect } from "vitest";
import { Vec2 } from "./Vec2.js";

describe("Vec2", () => {
  describe("constructor & statics", () => {
    it("stores x and y", () => {
      const v = new Vec2(3, 4);
      expect(v.x).toBe(3);
      expect(v.y).toBe(4);
    });

    it("has correct static constants", () => {
      expect(Vec2.ZERO).toEqual(new Vec2(0, 0));
      expect(Vec2.ONE).toEqual(new Vec2(1, 1));
      expect(Vec2.UP).toEqual(new Vec2(0, -1));
      expect(Vec2.DOWN).toEqual(new Vec2(0, 1));
      expect(Vec2.LEFT).toEqual(new Vec2(-1, 0));
      expect(Vec2.RIGHT).toEqual(new Vec2(1, 0));
    });
  });

  describe("arithmetic", () => {
    it("adds vectors", () => {
      const result = new Vec2(1, 2).add(new Vec2(3, 4));
      expect(result).toEqual(new Vec2(4, 6));
    });

    it("subtracts vectors", () => {
      const result = new Vec2(5, 7).sub(new Vec2(2, 3));
      expect(result).toEqual(new Vec2(3, 4));
    });

    it("scales a vector", () => {
      const result = new Vec2(2, 3).scale(3);
      expect(result).toEqual(new Vec2(6, 9));
    });

    it("computes dot product", () => {
      expect(new Vec2(1, 0).dot(new Vec2(0, 1))).toBe(0);
      expect(new Vec2(2, 3).dot(new Vec2(4, 5))).toBe(23);
    });

    it("computes cross product", () => {
      expect(new Vec2(1, 0).cross(new Vec2(0, 1))).toBe(1);
      expect(new Vec2(0, 1).cross(new Vec2(1, 0))).toBe(-1);
    });
  });

  describe("length", () => {
    it("computes length", () => {
      expect(new Vec2(3, 4).length()).toBe(5);
    });

    it("computes squared length", () => {
      expect(new Vec2(3, 4).lengthSq()).toBe(25);
    });
  });

  describe("normalize", () => {
    it("normalizes a non-zero vector", () => {
      const n = new Vec2(3, 4).normalize();
      expect(n.length()).toBeCloseTo(1);
      expect(n.x).toBeCloseTo(0.6);
      expect(n.y).toBeCloseTo(0.8);
    });

    it("returns ZERO for zero vector", () => {
      expect(Vec2.ZERO.normalize()).toBe(Vec2.ZERO);
    });

    it("returns ZERO for near-zero vector", () => {
      expect(new Vec2(1e-8, 1e-8).normalize()).toBe(Vec2.ZERO);
    });
  });

  describe("distance", () => {
    it("computes distance", () => {
      expect(new Vec2(0, 0).distance(new Vec2(3, 4))).toBe(5);
    });

    it("computes squared distance", () => {
      expect(new Vec2(0, 0).distanceSq(new Vec2(3, 4))).toBe(25);
    });

    it("static distance works", () => {
      expect(Vec2.distance(new Vec2(0, 0), new Vec2(3, 4))).toBe(5);
    });
  });

  describe("lerp", () => {
    it("interpolates between vectors", () => {
      const a = new Vec2(0, 0);
      const b = new Vec2(10, 20);
      const mid = a.lerp(b, 0.5);
      expect(mid).toEqual(new Vec2(5, 10));
    });

    it("t=0 returns start", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 0)).toEqual(a);
    });

    it("t=1 returns end", () => {
      const a = new Vec2(1, 2);
      const b = new Vec2(3, 4);
      expect(a.lerp(b, 1)).toEqual(b);
    });

    it("static lerp works", () => {
      const result = Vec2.lerp(new Vec2(0, 0), new Vec2(10, 10), 0.25);
      expect(result).toEqual(new Vec2(2.5, 2.5));
    });
  });

  describe("moveTowards", () => {
    it("moves toward the target by maxDelta", () => {
      const result = Vec2.moveTowards(new Vec2(0, 0), new Vec2(3, 4), 2);

      expect(result.x).toBeCloseTo(1.2);
      expect(result.y).toBeCloseTo(1.6);
    });

    it("does not overshoot when maxDelta exceeds the distance", () => {
      const result = Vec2.moveTowards(new Vec2(0, 0), new Vec2(3, 4), 10);

      expect(result).toEqual(new Vec2(3, 4));
    });

    it("returns the target when already at the target", () => {
      const result = Vec2.moveTowards(new Vec2(3, 4), new Vec2(3, 4), 1);

      expect(result).toEqual(new Vec2(3, 4));
    });

    it("does not move when maxDelta is zero or negative", () => {
      expect(Vec2.moveTowards(new Vec2(0, 0), new Vec2(3, 4), 0)).toEqual(
        new Vec2(0, 0),
      );
      expect(Vec2.moveTowards(new Vec2(0, 0), new Vec2(3, 4), -1)).toEqual(
        new Vec2(0, 0),
      );
    });
  });

  describe("angle & rotation", () => {
    it("computes angle", () => {
      expect(new Vec2(1, 0).angle()).toBe(0);
      expect(new Vec2(0, 1).angle()).toBeCloseTo(Math.PI / 2);
      expect(new Vec2(-1, 0).angle()).toBeCloseTo(Math.PI);
    });

    it("rotates a vector", () => {
      const v = new Vec2(1, 0).rotate(Math.PI / 2);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(1);
    });

    it("fromAngle creates correct vector", () => {
      const v = Vec2.fromAngle(0);
      expect(v.x).toBeCloseTo(1);
      expect(v.y).toBeCloseTo(0);
    });

    it("fromAngle with length", () => {
      const v = Vec2.fromAngle(Math.PI / 2, 5);
      expect(v.x).toBeCloseTo(0);
      expect(v.y).toBeCloseTo(5);
    });
  });

  describe("equals", () => {
    it("equals with default epsilon", () => {
      expect(new Vec2(1, 2).equals(new Vec2(1, 2))).toBe(true);
      expect(new Vec2(1, 2).equals(new Vec2(1.1, 2))).toBe(false);
    });

    it("equals with custom epsilon", () => {
      expect(new Vec2(1, 2).equals(new Vec2(1.05, 2.05), 0.1)).toBe(true);
    });
  });

  describe("toString", () => {
    it("formats correctly", () => {
      expect(new Vec2(1, 2).toString()).toBe("Vec2(1, 2)");
    });
  });

  describe("immutability", () => {
    it("operations return new instances", () => {
      const a = new Vec2(1, 2);
      const b = a.add(new Vec2(1, 1));
      expect(a.x).toBe(1);
      expect(a.y).toBe(2);
      expect(b.x).toBe(2);
      expect(b.y).toBe(3);
    });
  });
});
