import { describe, expect, it } from "vitest";
import { unionBounds, type WorldBounds } from "./bounds.js";

describe("unionBounds", () => {
  it("covers every rectangle", () => {
    const all: WorldBounds[] = [
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: -5, minY: 20, maxX: 5, maxY: 30 },
    ];

    expect(unionBounds(all)).toEqual({
      minX: -5,
      minY: 0,
      maxX: 10,
      maxY: 30,
    });
  });

  it("reports nothing for no rectangles", () => {
    expect(unionBounds([])).toBeUndefined();
  });
});
