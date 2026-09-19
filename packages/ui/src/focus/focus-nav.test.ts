import { describe, expect, it } from "vitest";
import { pickNeighbor } from "./focus-nav.js";
import type { FocusRect } from "./focus-nav.js";
import type { FocusDirection } from "../types.js";

const DIRECTIONS: readonly FocusDirection[] = ["up", "down", "left", "right"];

function rect(x: number, y: number, width = 40, height = 20): FocusRect {
  return { x, y, width, height };
}

/** Three boxes stacked in one column, 40 px apart. */
const column = [rect(0, 0), rect(0, 40), rect(0, 80)];

/** Three boxes side by side in one row, 60 px apart. */
const row = [rect(0, 0), rect(60, 0), rect(120, 0)];

/** A 3x3 grid, index `r * 3 + c`, cells 80x40 on a 100x50 pitch. */
const grid: FocusRect[] = [];
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) grid.push(rect(c * 100, r * 50, 80, 40));
}

describe("pickNeighbor", () => {
  it("steps down and up a column", () => {
    expect(pickNeighbor(column, 0, "down", false)).toBe(1);
    expect(pickNeighbor(column, 1, "down", false)).toBe(2);
    expect(pickNeighbor(column, 2, "up", false)).toBe(1);
    expect(pickNeighbor(column, 1, "up", false)).toBe(0);
  });

  it("steps left and right along a row", () => {
    expect(pickNeighbor(row, 0, "right", false)).toBe(1);
    expect(pickNeighbor(row, 1, "right", false)).toBe(2);
    expect(pickNeighbor(row, 2, "left", false)).toBe(1);
    expect(pickNeighbor(row, 1, "left", false)).toBe(0);
  });

  it("prefers a box in the same column over a nearer one to the side", () => {
    const rects = [
      rect(0, 0), // focused
      rect(0, 100), // same column, 100 px down
      rect(100, 30), // no column overlap, only 30 px down
    ];
    expect(pickNeighbor(rects, 0, "down", false)).toBe(1);
  });

  it("prefers a box in the same row over a nearer one above or below", () => {
    const rects = [
      rect(0, 0), // focused
      rect(200, 0), // same row, 200 px right
      rect(60, 40), // no row overlap, only 60 px right
    ];
    expect(pickNeighbor(rects, 0, "right", false)).toBe(1);
  });

  it("weighs sideways distance when no box shares the column", () => {
    const rects = [
      rect(0, 0, 50, 20), // focused, centre (25, 10)
      rect(200, 30, 50, 20), // 30 down, 200 across: 30 + 2 * 200
      rect(60, 100, 50, 20), // 100 down, 60 across: 100 + 2 * 60
    ];
    expect(pickNeighbor(rects, 0, "down", false)).toBe(2);
  });

  it("finds the first cell of the same column in a grid", () => {
    expect(pickNeighbor(grid, 4, "down", false)).toBe(7);
    expect(pickNeighbor(grid, 4, "up", false)).toBe(1);
    expect(pickNeighbor(grid, 4, "right", false)).toBe(5);
    expect(pickNeighbor(grid, 4, "left", false)).toBe(3);
  });

  it("wraps to the far end of a column and a row", () => {
    expect(pickNeighbor(column, 2, "down", true)).toBe(0);
    expect(pickNeighbor(column, 0, "up", true)).toBe(2);
    expect(pickNeighbor(row, 2, "right", true)).toBe(0);
    expect(pickNeighbor(row, 0, "left", true)).toBe(2);
  });

  it("blocks the move at either end when wrapping is off", () => {
    expect(pickNeighbor(column, 2, "down", false)).toBe(-1);
    expect(pickNeighbor(column, 0, "up", false)).toBe(-1);
    expect(pickNeighbor(row, 2, "right", false)).toBe(-1);
    expect(pickNeighbor(row, 0, "left", false)).toBe(-1);
  });

  it("wraps to the same row of a grid, not to the first cell", () => {
    expect(pickNeighbor(grid, 5, "right", true)).toBe(3);
    expect(pickNeighbor(grid, 3, "left", true)).toBe(5);
    expect(pickNeighbor(grid, 7, "down", true)).toBe(1);
    expect(pickNeighbor(grid, 1, "up", true)).toBe(7);
  });

  it("breaks a tie by array index, ahead and wrapping", () => {
    const rects = [rect(0, 0), rect(0, 100), rect(0, 100)];
    expect(pickNeighbor(rects, 0, "down", false)).toBe(1);
    expect(pickNeighbor(rects, 0, "up", true)).toBe(1);
  });

  it("reaches neither of two boxes sharing a centre", () => {
    const rects = [rect(0, 0, 40, 20), rect(10, 5, 20, 10)];
    for (const direction of DIRECTIONS) {
      expect(pickNeighbor(rects, 0, direction, true)).toBe(-1);
      expect(pickNeighbor(rects, 1, direction, true)).toBe(-1);
    }
  });

  it("treats a box level with the focused one as neither ahead nor behind", () => {
    const rects = [rect(0, 0), rect(100, 0)];
    expect(pickNeighbor(rects, 0, "down", true)).toBe(-1);
    expect(pickNeighbor(rects, 0, "up", true)).toBe(-1);
    expect(pickNeighbor(rects, 0, "right", false)).toBe(1);
  });

  it("ignores an offset smaller than the half-pixel slack", () => {
    const rects = [rect(0, 0), rect(0, 0.4)];
    expect(pickNeighbor(rects, 0, "down", true)).toBe(-1);
  });

  it("blocks every move in an empty list", () => {
    for (const direction of DIRECTIONS) {
      expect(pickNeighbor([], -1, direction, true)).toBe(-1);
      expect(pickNeighbor([], 0, direction, true)).toBe(-1);
    }
  });

  it("does not move a lone box onto itself", () => {
    const rects = [rect(0, 0)];
    for (const direction of DIRECTIONS) {
      expect(pickNeighbor(rects, 0, direction, true)).toBe(-1);
    }
  });

  it("lands on the first box whatever the direction when nothing is focused", () => {
    for (const direction of DIRECTIONS) {
      expect(pickNeighbor(column, -1, direction, false)).toBe(0);
      expect(pickNeighbor(grid, -1, direction, true)).toBe(0);
    }
  });

  it("throws naming an index that is outside the list", () => {
    expect(() => pickNeighbor(column, 5, "down", true)).toThrow(
      "pickNeighbor: from must be -1 or an index into rects, got 5.",
    );
  });
});
