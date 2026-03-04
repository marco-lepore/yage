import { describe, it, expect } from "vitest";
import { shallowEqual } from "./shallowEqual.js";

describe("shallowEqual", () => {
  // Primitives
  it("returns true for identical primitives", () => {
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual("a", "a")).toBe(true);
    expect(shallowEqual(true, true)).toBe(true);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(shallowEqual(1, 2)).toBe(false);
    expect(shallowEqual("a", "b")).toBe(false);
    expect(shallowEqual(true, false)).toBe(false);
  });

  it("handles NaN", () => {
    expect(shallowEqual(NaN, NaN)).toBe(true);
  });

  it("distinguishes +0 and -0", () => {
    // Object.is(+0, -0) is false
    expect(shallowEqual(+0, -0)).toBe(false);
  });

  // Arrays
  it("returns true for shallow-equal arrays", () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(shallowEqual([], [])).toBe(true);
  });

  it("returns false for arrays with different values", () => {
    expect(shallowEqual([1, 2], [1, 3])).toBe(false);
  });

  it("returns false for arrays with different lengths", () => {
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("does not deep-compare nested arrays", () => {
    const inner = [1];
    expect(shallowEqual([inner], [inner])).toBe(true);
    expect(shallowEqual([[1]], [[1]])).toBe(false);
  });

  // Objects
  it("returns true for shallow-equal objects", () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({}, {})).toBe(true);
  });

  it("returns false for objects with different values", () => {
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("returns false for objects with different keys", () => {
    expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  // Edge cases
  it("returns false for array vs object", () => {
    expect(shallowEqual([1], { 0: 1 })).toBe(false);
  });

  it("returns false for null vs object", () => {
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual({}, null)).toBe(false);
  });

  it("returns false for null vs undefined", () => {
    expect(shallowEqual(null, undefined)).toBe(false);
  });

  it("returns true for same reference", () => {
    const obj = { a: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });
});
