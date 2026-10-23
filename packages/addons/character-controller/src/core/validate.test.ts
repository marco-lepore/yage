import { describe, expect, it } from "vitest";
import { count, finite, tuningNumbers } from "./validate.js";

describe("validation helpers", () => {
  it("rejects negative or non-finite tuning numbers by name", () => {
    expect(() => tuningNumbers("test", { speed: -1 })).toThrow(/speed/);
    expect(() => tuningNumbers("test", { speed: NaN })).toThrow(/speed/);
    expect(() => tuningNumbers("test", { speed: 0, label: "x" })).not.toThrow();
  });
  it("applies an optional lower bound to finite numbers", () => {
    expect(() => finite("test", "x", -5)).not.toThrow();
    expect(() => finite("test", "x", -5, 0)).toThrow(/test: x/);
    expect(() => finite("test", "x", Infinity)).toThrow(/test: x/);
  });
  it.each([0.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects the count %s",
    (value) => {
      expect(() => count("test", "jumps", value)).toThrow(/test: jumps/);
    },
  );
});
