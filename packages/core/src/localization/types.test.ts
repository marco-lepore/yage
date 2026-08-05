import { describe, it, expect } from "vitest";
import { msg } from "./types.js";

describe("msg", () => {
  it("builds a binding from an id alone, omitting optional fields", () => {
    const binding = msg("hud.score");
    expect(binding).toEqual({ id: "hud.score" });
    expect("values" in binding).toBe(false);
    expect("default" in binding).toBe(false);
  });

  it("carries values and default when provided", () => {
    const binding = msg("hud.score", "Score: {n}", { n: 3 });
    expect(binding).toEqual({
      id: "hud.score",
      values: { n: 3 },
      default: "Score: {n}",
    });
  });

  it("keeps values without a default", () => {
    const binding = msg("hud.score", undefined, { n: 3 });
    expect(binding).toEqual({ id: "hud.score", values: { n: 3 } });
    expect("default" in binding).toBe(false);
  });

  it("does not resolve — it only describes", () => {
    // No adapter is consulted; the returned object is plain data.
    const binding = msg("x", "{n}", { n: 1 });
    expect(typeof binding).toBe("object");
    expect(binding.default).toBe("{n}");
  });
});
