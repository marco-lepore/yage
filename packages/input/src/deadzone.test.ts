import { describe, expect, it } from "vitest";
import { Vec2 } from "@yagejs/core";
import { applyRadialDeadzone } from "./deadzone.js";

describe("applyRadialDeadzone", () => {
  it("zeroes inside the deadzone", () => {
    expect(applyRadialDeadzone(0.1, 0.05, 0.15)).toEqual(Vec2.ZERO);
  });

  it("rescales magnitude 0→1 across deadzone edge → full travel", () => {
    const v = applyRadialDeadzone(0.5, 0, 0.1);
    expect(v.x).toBeCloseTo((0.5 - 0.1) / 0.9, 5);
    expect(v.y).toBe(0);
    expect(applyRadialDeadzone(1, 0, 0.1).x).toBeCloseTo(1, 5);
  });

  it("preserves direction", () => {
    const v = applyRadialDeadzone(0.6, 0.6, 0.15);
    expect(v.x).toBeCloseTo(v.y, 8);
  });

  it("clamps output magnitude to 1 for raw values past full travel", () => {
    const v = applyRadialDeadzone(1.5, 0, 0.15);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1.0001);
  });

  it("returns ZERO for the zero vector even with deadzone 0 (no NaN)", () => {
    expect(applyRadialDeadzone(0, 0, 0)).toEqual(Vec2.ZERO);
  });
});
