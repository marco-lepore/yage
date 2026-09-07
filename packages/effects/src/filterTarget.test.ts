import { describe, expect, it } from "vitest";

import { targetScale, toFilterRegion } from "./filterTarget.js";

describe("filter target conversion", () => {
  it("reports identity axes without a target", () => {
    expect(targetScale(undefined)).toEqual({
      scaleX: 1,
      scaleY: 1,
      sizeScale: 1,
    });
  });

  it("reads axis magnitudes from the world transform", () => {
    expect(
      targetScale({ worldTransform: { a: 3, b: 0, c: 0, d: 1 } } as never),
    ).toEqual({ scaleX: 3, scaleY: 1, sizeScale: 2 });
  });

  it("subtracts the rasterized region origin", () => {
    const out = { x: 0, y: 0 };
    toFilterRegion(
      { worldTransform: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 10 } } as never,
      { _activeFilterData: { bounds: { minX: 20, minY: 4 } } } as never,
      50,
      15,
      out,
    );
    expect(out).toEqual({ x: 110, y: 36 });
  });

  it("treats a missing region as an origin at zero", () => {
    const out = { x: 0, y: 0 };
    toFilterRegion(
      { worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 } } as never,
      {} as never,
      10,
      20,
      out,
    );
    expect(out).toEqual({ x: 15, y: 27 });
  });
});
