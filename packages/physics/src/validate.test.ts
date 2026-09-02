import { describe, it, expect } from "vitest";
import { assertFiniteNumber, assertPixelsPerMeter } from "./validate.js";

describe("assertFiniteNumber", () => {
  it("passes undefined, finite numbers, and numbers at the minimum", () => {
    expect(() => assertFiniteNumber("Ctx", "x", undefined)).not.toThrow();
    expect(() => assertFiniteNumber("Ctx", "x", -3)).not.toThrow();
    expect(() => assertFiniteNumber("Ctx", "x", 0, 0)).not.toThrow();
  });

  it("names the input and the constraint", () => {
    expect(() => assertFiniteNumber("Ctx", "x", NaN)).toThrow(
      "Ctx: x must be finite, got NaN.",
    );
    expect(() => assertFiniteNumber("Ctx", "x", Infinity, 0)).toThrow(
      "Ctx: x must be finite and >= 0, got Infinity.",
    );
    expect(() => assertFiniteNumber("Ctx", "x", -4, 0)).toThrow(
      "Ctx: x must be finite and >= 0, got -4.",
    );
  });
});

describe("assertPixelsPerMeter", () => {
  it("passes undefined and positive finite numbers", () => {
    expect(() => assertPixelsPerMeter("Ctx", undefined)).not.toThrow();
    expect(() => assertPixelsPerMeter("Ctx", 50)).not.toThrow();
  });

  it("rejects zero, negatives, and non-finite values", () => {
    expect(() => assertPixelsPerMeter("Ctx", 0)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got 0.",
    );
    expect(() => assertPixelsPerMeter("Ctx", -50)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got -50.",
    );
    expect(() => assertPixelsPerMeter("Ctx", NaN)).toThrow(
      "Ctx: pixelsPerMeter must be finite and > 0, got NaN.",
    );
  });
});
