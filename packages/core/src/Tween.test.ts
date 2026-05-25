import { describe, it, expect } from "vitest";
import { Tween } from "./Tween.js";
import { Vec2 } from "./Vec2.js";
import { Process, easeInQuad } from "./Process.js";

describe("Tween", () => {
  describe("to()", () => {
    it("tweens a numeric property", () => {
      const obj: Record<string, number> = { x: 0 };
      const proc = Tween.to(obj, "x", 100, 100);
      proc._update(50);
      expect(obj["x"]).toBeCloseTo(50);
      proc._update(50);
      expect(obj["x"]).toBeCloseTo(100);
      expect(proc.completed).toBe(true);
    });

    it("supports custom easing", () => {
      const obj: Record<string, number> = { x: 0 };
      const proc = Tween.to(obj, "x", 100, 100, easeInQuad);
      proc._update(50); // t=0.5, easeInQuad(0.5) = 0.25
      expect(obj["x"]).toBeCloseTo(25);
    });

    it("handles missing initial property (defaults to 0)", () => {
      const obj: Record<string, number> = {};
      const proc = Tween.to(obj, "y", 50, 100);
      proc._update(100);
      expect(obj["y"]).toBeCloseTo(50);
    });
  });

  describe("custom()", () => {
    it("tweens with a custom setter", () => {
      const values: number[] = [];
      const proc = Tween.custom((v) => values.push(v), 0, 10, 100);
      proc._update(50);
      expect(values[values.length - 1]).toBeCloseTo(5);
      proc._update(50);
      expect(values[values.length - 1]).toBeCloseTo(10);
      expect(proc.completed).toBe(true);
    });

    it("supports easing", () => {
      let lastValue = 0;
      const proc = Tween.custom(
        (v) => {
          lastValue = v;
        },
        0,
        100,
        100,
        easeInQuad,
      );
      proc._update(50);
      expect(lastValue).toBeCloseTo(25);
    });
  });

  describe("vec2()", () => {
    it("tweens between two Vec2 values", () => {
      let result = Vec2.ZERO;
      const proc = Tween.vec2(
        (v) => {
          result = v;
        },
        new Vec2(0, 0),
        new Vec2(100, 200),
        100,
      );
      proc._update(50);
      expect(result.x).toBeCloseTo(50);
      expect(result.y).toBeCloseTo(100);
      proc._update(50);
      expect(result.x).toBeCloseTo(100);
      expect(result.y).toBeCloseTo(200);
      expect(proc.completed).toBe(true);
    });

    it("supports easing", () => {
      let result = Vec2.ZERO;
      const proc = Tween.vec2(
        (v) => {
          result = v;
        },
        Vec2.ZERO,
        new Vec2(100, 100),
        100,
        easeInQuad,
      );
      proc._update(50); // t=0.5, easeInQuad=0.25
      expect(result.x).toBeCloseTo(25);
      expect(result.y).toBeCloseTo(25);
    });
  });

  describe("stagger()", () => {
    it("returns one process per item and passes (item, index) to the factory", () => {
      const items = ["a", "b", "c"];
      const seen: Array<[string, number]> = [];
      const procs = Tween.stagger(
        items,
        (item, i) => {
          seen.push([item, i]);
          return new Process({ update: () => true });
        },
        0,
      );
      expect(procs).toHaveLength(3);
      // The factory is deferred until each item's turn begins (first update).
      expect(seen).toEqual([]);
      procs.forEach((p) => p._update(16));
      expect(seen).toEqual([
        ["a", 0],
        ["b", 1],
        ["c", 2],
      ]);
    });

    it("delays each item's start by stepMs (item 0 starts immediately)", () => {
      const objs = [{ a: 0 }, { a: 0 }, { a: 0 }];
      const procs = Tween.stagger(
        objs,
        (o) => Tween.to(o, "a", 1, 100),
        100,
      );

      // First frame: only item 0's tween is live; later items are still waiting.
      procs.forEach((p) => p._update(50));
      expect(objs[0]!.a).toBeGreaterThan(0);
      expect(objs[1]!.a).toBe(0);
      expect(objs[2]!.a).toBe(0);

      // Advance well past item 1's start: item 0 finished, item 1 has begun.
      for (let i = 0; i < 4; i++) procs.forEach((p) => p._update(50));
      expect(objs[0]!.a).toBeCloseTo(1);
      expect(objs[1]!.a).toBeGreaterThan(0);
    });
  });
});
