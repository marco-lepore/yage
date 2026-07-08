import { describe, expect, it } from "vitest";
import { normalizeGap, solveAxis, type AxisConstraints } from "./solvePanelGeometry.js";
import type { CellDefaults } from "../adapter.js";

const base: Omit<AxisConstraints, "count" | "extent" | "available"> = {
  gap: 6,
  defaultCount: 5,
  defaultExtent: 56,
};

describe("solveAxis — no bounds (intrinsic panel)", () => {
  it("fills unset knobs from the defaults", () => {
    expect(solveAxis({ ...base, count: undefined, extent: undefined, available: undefined })).toEqual({
      count: 5,
      extent: 56,
      overdetermined: false,
    });
  });

  it("keeps explicit count and extent (no bounds = no conflict)", () => {
    expect(solveAxis({ ...base, count: 8, extent: 48, available: undefined })).toEqual({
      count: 8,
      extent: 48,
      overdetermined: false,
    });
  });
});

describe("solveAxis — bounds + one knob", () => {
  it("derives the extent from an explicit count, floored to fit", () => {
    // (328 - 4*6) / 5 = 60.8 -> 60; window 5*60 + 4*6 = 324 <= 328.
    expect(solveAxis({ ...base, count: 5, extent: undefined, available: 328 })).toEqual({
      count: 5,
      extent: 60,
      overdetermined: false,
    });
  });

  it("derives the count from an explicit extent", () => {
    // floor((328 + 6) / (60 + 6)) = floor(5.06) = 5.
    expect(solveAxis({ ...base, count: undefined, extent: 60, available: 328 })).toEqual({
      count: 5,
      extent: 60,
      overdetermined: false,
    });
  });

  it("never derives a count below 1", () => {
    expect(solveAxis({ ...base, count: undefined, extent: 60, available: 40 }).count).toBe(1);
  });

  it("never derives an extent below 1", () => {
    expect(solveAxis({ ...base, count: 10, extent: undefined, available: 8 }).extent).toBe(1);
  });
});

describe("solveAxis — bounds + neither (auto-fit)", () => {
  it("uses the default extent and derives the count", () => {
    // floor((328 + 6) / (56 + 6)) = floor(5.38) = 5.
    expect(solveAxis({ ...base, count: undefined, extent: undefined, available: 328 })).toEqual({
      count: 5,
      extent: 56,
      overdetermined: false,
    });
  });

  it("shrinks the extent to the bounds when a single default cell overflows", () => {
    // A 388px default row in a 300px box: 1 column, extent clamped to 300.
    expect(
      solveAxis({
        gap: 0,
        defaultCount: 1,
        defaultExtent: 388,
        count: undefined,
        extent: undefined,
        available: 300,
      }),
    ).toEqual({ count: 1, extent: 300, overdetermined: false });
  });
});

describe("solveAxis — bounds + both (overdetermined)", () => {
  it("keeps the declared values and flags the conflict", () => {
    expect(solveAxis({ ...base, count: 7, extent: 56, available: 328 })).toEqual({
      count: 7,
      extent: 56,
      overdetermined: true,
    });
  });
});

describe("normalizeGap", () => {
  const defaults: CellDefaults = {
    columns: 5,
    visibleRows: 4,
    cellWidth: 56,
    cellHeight: 56,
    gapX: 6,
    gapY: 6,
  };

  it("applies a single number to both axes", () => {
    expect(normalizeGap(10, defaults)).toEqual({ x: 10, y: 10 });
  });

  it("passes an {x,y} object through", () => {
    expect(normalizeGap({ x: 4, y: 12 }, defaults)).toEqual({ x: 4, y: 12 });
  });

  it("falls back to the preset's default gaps when omitted", () => {
    expect(normalizeGap(undefined, defaults)).toEqual({ x: 6, y: 6 });
  });
});
