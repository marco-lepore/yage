import type { RandomService } from "@yagejs/core";
import { describe, expect, it } from "vitest";

import { BUILTIN_FUNCTION_NAMES, createBuiltinFunctions } from "./functions.js";

/** A random source that always draws `value` (0 → first pick, 0.99 → last). */
function fixedRandom(value: number): RandomService {
  return {
    float: () => value,
    range: (min, max) => min + value * (max - min),
    int: (min, max) => Math.min(max, Math.floor(min + value * (max - min + 1))),
    pick: (arr) =>
      arr[Math.min(arr.length - 1, Math.floor(value * arr.length))]!,
    shuffle: (arr) => arr,
    getSeed: () => 0,
  };
}

const call = (name: string, ...args: (string | number | boolean | null)[]) =>
  createBuiltinFunctions(fixedRandom(0))[name]!(...args);

describe("BUILTIN_FUNCTIONS", () => {
  it("rounding family", () => {
    expect(call("round", 2.5)).toBe(2);
    expect(call("round", 3.5)).toBe(4);
    expect(call("round", -2.5)).toBe(-2);
    expect(call("round", 2.6)).toBe(3);
    expect(call("round_places", 3.14159, 2)).toBe(3.14);
    expect(call("floor", 2.7)).toBe(2);
    expect(call("ceil", 2.1)).toBe(3);
    expect(call("int", -2.7)).toBe(-2);
    expect(call("decimal", 2.25)).toBe(0.25);
    expect(call("inc", 2)).toBe(3);
    expect(call("inc", 2.2)).toBe(3);
    expect(call("dec", 2)).toBe(1);
    expect(call("dec", 2.8)).toBe(2);
  });

  it("random family draws from the given source and stays in range", () => {
    const high = createBuiltinFunctions(fixedRandom(0.999999));
    expect(high["dice"]!(6)).toBe(6);
    expect(high["random_range"]!(3, 5)).toBe(5);
    expect(call("dice", 6)).toBe(1);
    expect(call("random_range", 3, 5)).toBe(3);
    expect(call("random_range_float", 1, 2)).toBe(1);
    expect(call("random")).toBe(0);
  });

  it("BUILTIN_FUNCTION_NAMES lists every built-in", () => {
    expect([...BUILTIN_FUNCTION_NAMES].sort()).toEqual(
      Object.keys(createBuiltinFunctions(fixedRandom(0))).sort(),
    );
    expect(BUILTIN_FUNCTION_NAMES.has("dice")).toBe(true);
  });

  it("conversions", () => {
    expect(call("string", 5)).toBe("5");
    expect(call("string", null)).toBe("");
    expect(call("number", "4.5")).toBe(4.5);
    expect(call("bool", "false")).toBe(false);
    expect(call("bool", "true")).toBe(true);
    expect(call("bool", 0)).toBe(false);
    expect(call("format_invariant", 1.5)).toBe("1.5");
    expect(call("min", 2, 3)).toBe(2);
    expect(call("max", 2, 3)).toBe(3);
  });

  it("format", () => {
    expect(call("format", "{0} coins", 3)).toBe("3 coins");
    expect(call("format", "{0:F1} kg", 2.25)).toBe("2.3 kg");
    expect(call("format", "#{0:D3}", 7)).toBe("#007");
    expect(call("format", "{0:P0}", 0.5)).toBe("50%");
    expect(call("format", "{{{0}}}", "x")).toBe("{x}");
  });
});
