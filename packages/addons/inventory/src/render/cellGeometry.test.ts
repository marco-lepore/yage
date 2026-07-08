import { describe, expect, it } from "vitest";
import {
  cellAtPoint,
  cellNavigate,
  cellRect,
  cellRowCount,
  cellScrollRow,
  cellWindowSize,
  type CellGridSpec,
} from "./cellGeometry.js";

// 3 columns, 10 cells:
//   0 1 2
//   3 4 5
//   6 7 8
//   9
describe("cellNavigate (3 columns, 10 cells)", () => {
  const nav = (from: number, dir: "up" | "down" | "left" | "right", wrap = false) =>
    cellNavigate(from, dir, 10, 3, wrap);

  it("moves by column vertically and by one horizontally", () => {
    expect(nav(4, "up")).toBe(1);
    expect(nav(4, "down")).toBe(7);
    expect(nav(4, "left")).toBe(3);
    expect(nav(4, "right")).toBe(5);
  });

  it("clamps at edges without wrap", () => {
    expect(nav(1, "up")).toBe(1);
    expect(nav(9, "down")).toBe(9);
    expect(nav(3, "left")).toBe(3);
    expect(nav(5, "right")).toBe(5);
    expect(nav(9, "right")).toBe(9); // lone cell in the last row
  });

  it("snaps down into a shorter last row", () => {
    expect(nav(7, "down")).toBe(9); // below 7 is empty -> last cell
    expect(nav(8, "down")).toBe(9);
    expect(nav(6, "down")).toBe(9);
  });

  it("wraps within rows and columns when asked", () => {
    expect(nav(0, "up", true)).toBe(9); // column 0 bottom is 9
    expect(nav(1, "up", true)).toBe(7); // column 1 bottom (row 3 has no col 1)
    expect(nav(9, "down", true)).toBe(0);
    expect(nav(3, "left", true)).toBe(5); // row end
    expect(nav(5, "right", true)).toBe(3); // row start
    expect(nav(9, "right", true)).toBe(9); // single-cell row: wraps to itself
  });

  it("stays put on an empty grid", () => {
    expect(cellNavigate(0, "down", 0, 3)).toBe(0);
  });
});

describe("cellScrollRow", () => {
  it("keeps the selected row inside the window", () => {
    // 3 cols, 10 cells -> 4 rows; window of 2.
    expect(cellScrollRow(0, 0, 2, 3, 10)).toBe(0);
    expect(cellScrollRow(6, 0, 2, 3, 10)).toBe(1); // row 2 -> window [1,2]
    expect(cellScrollRow(9, 1, 2, 3, 10)).toBe(2); // row 3 -> window [2,3]
    expect(cellScrollRow(0, 2, 2, 3, 10)).toBe(0); // back up
  });

  it("clamps a stale offset when the grid shrinks", () => {
    expect(cellScrollRow(0, 5, 2, 3, 6)).toBe(0); // 2 rows total -> maxFirst 0
  });
});

// Non-square cells with distinct per-axis gaps, so width/height and gapX/gapY
// are each exercised independently (a square-cell bug would pass otherwise).
describe("cell rects and hit-testing (rectangular cells)", () => {
  const spec: CellGridSpec = {
    columns: 3,
    cellWidth: 50,
    cellHeight: 40,
    gapX: 10,
    gapY: 8,
    visibleRows: 2,
  };
  const origin = { x: 100, y: 200 };

  it("places cells on the per-axis gap grid, windowed by scroll", () => {
    // col 1 -> x 100 + 60; row 1 -> y 200 + 48.
    expect(cellRect(4, spec, origin, 0)).toEqual({ x: 160, y: 248, width: 50, height: 40 });
    expect(cellRect(7, spec, origin, 0)).toBeNull(); // row 2, outside window
    expect(cellRect(7, spec, origin, 1)).toEqual({ x: 160, y: 248, width: 50, height: 40 });
  });

  it("hit-tests invert placement, with distinct x- and y-gap dead zones", () => {
    expect(cellAtPoint(185, 268, spec, origin, 0, 10)).toBe(4);
    expect(cellAtPoint(155, 268, spec, origin, 0, 10)).toBeUndefined(); // in the x gap
    expect(cellAtPoint(110, 244, spec, origin, 0, 10)).toBeUndefined(); // in the y gap
    expect(cellAtPoint(185, 268, spec, origin, 1, 10)).toBe(7); // scrolled window
    expect(cellAtPoint(0, 0, spec, origin, 0, 10)).toBeUndefined();
    expect(cellAtPoint(185, 320, spec, origin, 0, 10)).toBeUndefined(); // below window
    // Index beyond count misses (phantom cell in the last row).
    expect(cellAtPoint(185, 268, spec, origin, 2, 10)).toBeUndefined();
  });

  it("computes the window size and row count", () => {
    expect(cellWindowSize(spec)).toEqual({ width: 170, height: 88 });
    expect(cellRowCount(10, 3)).toBe(4);
  });
});

// A list is columns:1 with wide, short cells and no gaps. These are the old
// dedicated list-geometry cases, now the degenerate case of the shared math.
describe("cell math at columns:1 (a list)", () => {
  const nav = (from: number, dir: "up" | "down" | "left" | "right", wrap = false) =>
    cellNavigate(from, dir, 5, 1, wrap);

  it("navigates linearly, clamps at ends, ignores left/right", () => {
    expect(nav(2, "down")).toBe(3);
    expect(nav(2, "up")).toBe(1);
    expect(nav(0, "up")).toBe(0);
    expect(nav(4, "down")).toBe(4);
    expect(nav(2, "left")).toBe(2);
    expect(nav(2, "right")).toBe(2);
  });

  it("wraps when asked", () => {
    expect(nav(0, "up", true)).toBe(4);
    expect(nav(4, "down", true)).toBe(0);
  });

  it("scrolls to keep the selection visible (incl. stale-offset clamp)", () => {
    expect(cellScrollRow(0, 0, 3, 1, 8)).toBe(0);
    expect(cellScrollRow(4, 0, 3, 1, 8)).toBe(2);
    expect(cellScrollRow(1, 2, 3, 1, 8)).toBe(1);
    expect(cellScrollRow(7, 9, 3, 1, 8)).toBe(5); // stale offset clamps
  });

  const spec: CellGridSpec = {
    columns: 1,
    cellWidth: 200,
    cellHeight: 24,
    gapX: 0,
    gapY: 0,
    visibleRows: 3,
  };
  const origin = { x: 50, y: 100 };

  it("full-width rows window with the scroll; hit-test inverts them", () => {
    expect(cellRect(3, spec, origin, 2)).toEqual({ x: 50, y: 124, width: 200, height: 24 });
    expect(cellRect(1, spec, origin, 2)).toBeNull();
    expect(cellAtPoint(60, 130, spec, origin, 2, 8)).toBe(3);
    expect(cellAtPoint(60, 90, spec, origin, 2, 8)).toBeUndefined();
    expect(cellAtPoint(300, 130, spec, origin, 2, 8)).toBeUndefined();
    expect(cellAtPoint(60, 100 + 3 * 24 + 1, spec, origin, 2, 8)).toBeUndefined(); // past window
  });

  it("rejects the exact right edge (1px stricter than the old list hit-test)", () => {
    // Old listRowAtPoint accepted x == origin.x + width; the unified floor
    // semantics put that pixel in the next (nonexistent) column, so it misses.
    expect(cellAtPoint(50 + 200, 130, spec, origin, 2, 8)).toBeUndefined();
    expect(cellAtPoint(50 + 199, 130, spec, origin, 2, 8)).toBe(3);
  });
});
