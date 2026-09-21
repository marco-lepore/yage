import { describe, expect, it } from "vitest";
import {
  FULL_TURN,
  assertBounce,
  assertColor,
  assertNonNegative,
  assertPositive,
  assertSpread,
  assertUnit,
  clampUnit,
} from "./validation.js";

describe("lighting validation", () => {
  it("accepts unit interval boundaries and rejects other values", () => {
    expect(() => assertUnit(0, "value")).not.toThrow();
    expect(() => assertUnit(1, "value")).not.toThrow();

    for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertUnit(value, "value")).toThrow(RangeError);
    }
    expect(() => assertUnit(1.01, "value")).toThrow(/got 1\.01/);
  });

  it("accepts positive finite values and rejects zero or less", () => {
    expect(() => assertPositive(Number.MIN_VALUE, "value")).not.toThrow();

    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertPositive(value, "value")).toThrow(RangeError);
    }
    expect(() => assertPositive(0, "value")).toThrow(/got 0/);
  });

  it("accepts zero and above and rejects negative or unbounded values", () => {
    expect(() => assertNonNegative(0, "value")).not.toThrow();
    expect(() => assertNonNegative(12.5, "value")).not.toThrow();

    for (const value of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertNonNegative(value, "value")).toThrow(RangeError);
    }
    expect(() => assertNonNegative(-0.01, "value")).toThrow(/got -0\.01/);
  });

  it("accepts spreads up to a whole turn and rejects the rest", () => {
    expect(() => assertSpread(Number.MIN_VALUE, "value")).not.toThrow();
    expect(() => assertSpread(FULL_TURN, "value")).not.toThrow();

    for (const value of [0, -1, FULL_TURN + 0.01, Number.NaN]) {
      expect(() => assertSpread(value, "value")).toThrow(RangeError);
    }
    expect(() => assertSpread(-1, "value")).toThrow(/got -1/);
  });

  it("accepts 24-bit integer colours and rejects other numbers", () => {
    expect(() => assertColor(0x000000, "color")).not.toThrow();
    expect(() => assertColor(0xffffff, "color")).not.toThrow();

    for (const value of [-1, 0x1000000, 1.5, Number.NaN]) {
      expect(() => assertColor(value, "color")).toThrow(RangeError);
    }
  });

  it("checks both halves of a bounce setting under one name", () => {
    expect(() =>
      assertBounce({ strength: 0.5, radius: 24 }, "x"),
    ).not.toThrow();
    expect(() => assertBounce({ strength: 2, radius: 24 }, "x")).toThrow(
      "x strength must be a finite number from 0 to 1, got 2.",
    );
    expect(() => assertBounce({ strength: 0.5, radius: -1 }, "x")).toThrow(
      "x radius must be a finite number greater than 0, got -1.",
    );
    for (const blend of ["max", "mix"] as const) {
      expect(() =>
        assertBounce({ strength: 0.5, radius: 24, blend }, "x"),
      ).not.toThrow();
    }
    expect(() =>
      assertBounce({ strength: 0.5, radius: 24, blend: "add" as never }, "x"),
    ).toThrow('x blend must be "max" or "mix", got "add".');
  });

  it("clamps values to the unit interval", () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(0.4)).toBe(0.4);
    expect(clampUnit(1.5)).toBe(1);
  });
});
