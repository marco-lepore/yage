import { describe, expect, it } from "vitest";
import {
  createDefaultRandomSeed,
  createRandomService,
  globalRandom,
  normalizeSeed,
  type InternalRandomService,
} from "./Random.js";

describe("Random", () => {
  describe("normalizeSeed", () => {
    it("coerces seeds into the uint32 range", () => {
      expect(normalizeSeed(0)).toBe(0);
      expect(normalizeSeed(42)).toBe(42);
      expect(normalizeSeed(-1)).toBe(0xffffffff);
      expect(normalizeSeed(0x1_0000_0001)).toBe(1);
    });

    it("treats fractional inputs by truncation, not rounding", () => {
      expect(normalizeSeed(1.9)).toBe(1);
    });
  });

  describe("createDefaultRandomSeed", () => {
    it("produces a uint32 value", () => {
      const seed = createDefaultRandomSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    });
  });

  describe("createRandomService", () => {
    it("returns identical sequences for the same seed", () => {
      const a = createRandomService(123);
      const b = createRandomService(123);
      const seqA = Array.from({ length: 8 }, () => a.float());
      const seqB = Array.from({ length: 8 }, () => b.float());
      expect(seqA).toEqual(seqB);
    });

    it("produces different sequences for different seeds", () => {
      const a = createRandomService(1).float();
      const b = createRandomService(2).float();
      expect(a).not.toBe(b);
    });

    it("float() stays in [0, 1)", () => {
      const rng = createRandomService(7);
      for (let i = 0; i < 1_000; i++) {
        const v = rng.float();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it("range(min, max) stays in [min, max)", () => {
      const rng = createRandomService(7);
      for (let i = 0; i < 1_000; i++) {
        const v = rng.range(-5, 5);
        expect(v).toBeGreaterThanOrEqual(-5);
        expect(v).toBeLessThan(5);
      }
    });

    it("int(min, max) produces inclusive integers", () => {
      const rng = createRandomService(7);
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const v = rng.int(0, 3);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(3);
        seen.add(v);
      }
      // With 200 draws across {0,1,2,3} a fair PRNG should hit every value.
      expect(seen.size).toBe(4);
    });

    it("pick() throws on empty arrays", () => {
      expect(() => createRandomService(1).pick([])).toThrow(/non-empty/);
    });

    it("pick() returns an element from the array", () => {
      const rng = createRandomService(1);
      const arr = ["a", "b", "c"];
      for (let i = 0; i < 50; i++) {
        expect(arr).toContain(rng.pick(arr));
      }
    });

    it("shuffle() permutes in place and preserves elements", () => {
      const rng = createRandomService(99);
      const original = [1, 2, 3, 4, 5, 6, 7, 8];
      const shuffled = [...original];
      const result = rng.shuffle(shuffled);
      expect(result).toBe(shuffled);
      expect(shuffled.slice().sort()).toEqual(original);
    });

    it("shuffle() with the same seed produces the same permutation", () => {
      const a = createRandomService(42).shuffle([1, 2, 3, 4, 5]);
      const b = createRandomService(42).shuffle([1, 2, 3, 4, 5]);
      expect(a).toEqual(b);
    });

    it("getSeed() returns the construction seed", () => {
      const rng = createRandomService(0xdeadbeef);
      expect(rng.getSeed()).toBe(0xdeadbeef);
    });

    it("setSeed() (internal API) resets the sequence", () => {
      const rng = createRandomService(1) as InternalRandomService;
      rng.float();
      rng.float();
      rng.setSeed(1);
      const after = rng.float();
      const fresh = createRandomService(1).float();
      expect(after).toBe(fresh);
      expect(rng.getSeed()).toBe(1);
    });
  });

  describe("globalRandom", () => {
    it("is a working RandomService instance", () => {
      const v = globalRandom.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });
  });
});
