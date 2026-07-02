import { describe, expect, it } from "vitest";
import {
  gridCellRect,
  gridNavigate,
  gridRows,
  gridScrollRow,
  gridSlotAtPoint,
  gridWindowSize,
  type GridSpec,
} from "./gridGeometry.js";

// 3 columns, 10 cells:
//   0 1 2
//   3 4 5
//   6 7 8
//   9
describe("gridNavigate (3 columns, 10 cells)", () => {
  const nav = (from: number, dir: "up" | "down" | "left" | "right", wrap = false) =>
    gridNavigate(from, dir, 10, 3, wrap);

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
    expect(gridNavigate(0, "down", 0, 3)).toBe(0);
  });
});

describe("gridScrollRow", () => {
  it("keeps the selected row inside the window", () => {
    // 3 cols, 10 cells -> 4 rows; window of 2.
    expect(gridScrollRow(0, 0, 2, 3, 10)).toBe(0);
    expect(gridScrollRow(6, 0, 2, 3, 10)).toBe(1); // row 2 -> window [1,2]
    expect(gridScrollRow(9, 1, 2, 3, 10)).toBe(2); // row 3 -> window [2,3]
    expect(gridScrollRow(0, 2, 2, 3, 10)).toBe(0); // back up
  });

  it("clamps a stale offset when the grid shrinks", () => {
    expect(gridScrollRow(0, 5, 2, 3, 6)).toBe(0); // 2 rows total -> maxFirst 0
  });
});

describe("cell rects and hit-testing", () => {
  const spec: GridSpec = { columns: 3, cellSize: 50, cellGap: 10, visibleRows: 2 };
  const origin = { x: 100, y: 200 };

  it("places cells on the gap grid, windowed by scroll", () => {
    expect(gridCellRect(4, spec, origin, 0)).toEqual({ x: 160, y: 260, width: 50, height: 50 });
    expect(gridCellRect(7, spec, origin, 0)).toBeNull(); // row 2, outside window
    expect(gridCellRect(7, spec, origin, 1)).toEqual({ x: 160, y: 260, width: 50, height: 50 });
  });

  it("hit-tests are the exact inverse of placement (gaps miss)", () => {
    expect(gridSlotAtPoint(185, 285, spec, origin, 0, 10)).toBe(4);
    expect(gridSlotAtPoint(155, 285, spec, origin, 0, 10)).toBeUndefined(); // in the gap
    expect(gridSlotAtPoint(185, 285, spec, origin, 1, 10)).toBe(7); // scrolled window
    expect(gridSlotAtPoint(0, 0, spec, origin, 0, 10)).toBeUndefined();
    expect(gridSlotAtPoint(185, 345, spec, origin, 0, 10)).toBeUndefined(); // below window
    // Index beyond count misses (phantom cell in the last row).
    expect(gridSlotAtPoint(185, 285, spec, origin, 2, 10)).toBeUndefined();
  });

  it("computes the window size", () => {
    expect(gridWindowSize(spec)).toEqual({ width: 170, height: 110 });
    expect(gridRows(10, 3)).toBe(4);
  });
});
