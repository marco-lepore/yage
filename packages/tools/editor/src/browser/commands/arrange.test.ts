import { describe, expect, it } from "vitest";
import { alignMoves, distributeMoves, type AlignEdge } from "./arrange.js";
import type { WorldBounds } from "./bounds.js";

/** A box by its corner and its size, which is easier to read than four edges. */
function box(x: number, y: number, width: number, height: number): WorldBounds {
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/**
 * Three boxes of unequal size at unequal places, so every alignment moves a
 * different pair and none of the six can pass by accident.
 *
 * `a` is leftmost and topmost, `c` is rightmost and bottommost, and `b` is a
 * different size from both.
 */
const THREE = new Map<string, WorldBounds>([
  ["a", box(0, 0, 20, 10)],
  ["b", box(50, 25, 10, 40)],
  ["c", box(80, 90, 40, 20)],
]);

/** How far each member moves on the axis the alignment acts on. */
function shifts(moves: ReadonlyMap<string, { x: number; y: number }>): {
  x: number[];
  y: number[];
} {
  return {
    x: [...moves.values()].map((move) => move.x),
    y: [...moves.values()].map((move) => move.y),
  };
}

describe("alignMoves", () => {
  it("brings every left edge to the leftmost one", () => {
    expect(shifts(alignMoves(THREE, "left"))).toEqual({
      x: [0, -50, -80],
      y: [0, 0, 0],
    });
  });

  it("brings every right edge to the rightmost one", () => {
    // The union spans 0 to 120, so `a` moves by 100 and `b` by 60 — each by
    // its own distance, which is what an unequal-width selection needs.
    expect(shifts(alignMoves(THREE, "right"))).toEqual({
      x: [100, 60, 0],
      y: [0, 0, 0],
    });
  });

  it("brings every horizontal centre to the middle of the whole box", () => {
    // The union's centre is 60; the three boxes' centres are 10, 55 and 100.
    expect(shifts(alignMoves(THREE, "centerX"))).toEqual({
      x: [50, 5, -40],
      y: [0, 0, 0],
    });
  });

  it("brings every top edge to the topmost one", () => {
    expect(shifts(alignMoves(THREE, "top"))).toEqual({
      x: [0, 0, 0],
      y: [0, -25, -90],
    });
  });

  it("brings every bottom edge to the bottommost one", () => {
    // The union spans 0 to 110.
    expect(shifts(alignMoves(THREE, "bottom"))).toEqual({
      x: [0, 0, 0],
      y: [100, 45, 0],
    });
  });

  it("brings every vertical centre to the middle of the whole box", () => {
    // The union's centre is 55; the three boxes' centres are 5, 45 and 100.
    expect(shifts(alignMoves(THREE, "centerY"))).toEqual({
      x: [0, 0, 0],
      y: [50, 10, -45],
    });
  });

  it("moves a member that draws nothing by its origin alone", () => {
    // A placement with no artwork measures as a point, so it lines that point
    // up with the edge rather than a rectangle it does not have.
    const boxes = new Map<string, WorldBounds>([
      ["wide", box(0, 0, 20, 10)],
      ["point", box(70, 40, 0, 0)],
    ]);

    // The union runs 0 to 70, so the point is the right edge of it.
    expect(alignMoves(boxes, "left").get("point")).toEqual({ x: -70, y: 0 });
    expect(alignMoves(boxes, "right").get("point")).toEqual({ x: 0, y: 0 });
    expect(alignMoves(boxes, "right").get("wide")).toEqual({ x: 50, y: 0 });
  });

  it("moves nobody when they already line up", () => {
    const boxes = new Map<string, WorldBounds>([
      ["a", box(0, 40, 20, 10)],
      ["b", box(60, 40, 5, 30)],
    ]);

    expect(shifts(alignMoves(boxes, "top"))).toEqual({
      x: [0, 0],
      y: [0, 0],
    });
  });

  it("answers nothing for no boxes", () => {
    expect(alignMoves(new Map(), "left").size).toBe(0);
  });

  it.each<AlignEdge>(["left", "centerX", "right", "top", "centerY", "bottom"])(
    "leaves one box where it is under %s",
    (edge) => {
      const boxes = new Map([["only", box(12, 34, 5, 6)]]);

      expect(alignMoves(boxes, edge).get("only")).toEqual({ x: 0, y: 0 });
    },
  );
});

describe("distributeMoves", () => {
  it("leaves an equal gap between boxes of unequal width", () => {
    // 0 to 120 is 120 wide and the three boxes fill 70 of it, so the two gaps
    // are 25 each: `a` ends at 20, `b` runs 45 to 55, `c` starts at 80.
    const moves = distributeMoves(THREE, "x");

    expect(moves.get("a")).toEqual({ x: 0, y: 0 });
    expect(moves.get("b")).toEqual({ x: -5, y: 0 });
    expect(moves.get("c")).toEqual({ x: 0, y: 0 });
  });

  it("leaves an equal gap between boxes of unequal height", () => {
    // 0 to 110 is 110 tall and the three boxes fill 70 of it, so the two gaps
    // are 20 each: `a` ends at 10, `b` runs 30 to 70, `c` starts at 90.
    const moves = distributeMoves(THREE, "y");

    expect(moves.get("a")).toEqual({ x: 0, y: 0 });
    expect(moves.get("b")).toEqual({ x: 0, y: 5 });
    expect(moves.get("c")).toEqual({ x: 0, y: 0 });
  });

  it("spreads a crowded middle out to the ends", () => {
    const boxes = new Map<string, WorldBounds>([
      ["a", box(0, 0, 10, 10)],
      ["b", box(15, 0, 10, 10)],
      ["c", box(30, 0, 10, 10)],
      ["d", box(100, 0, 10, 10)],
    ]);
    // 0 to 110 holds 40 of box, so the three gaps are 70 / 3 each.
    const gap = 70 / 3;
    const moves = distributeMoves(boxes, "x");

    expect(moves.get("a")).toEqual({ x: 0, y: 0 });
    expect(moves.get("b")?.x).toBeCloseTo(10 + gap - 15);
    expect(moves.get("c")?.x).toBeCloseTo(20 + 2 * gap - 30);
    expect(moves.get("d")).toEqual({ x: 0, y: 0 });
  });

  it("gives boxes that overlap an equal negative gap", () => {
    const boxes = new Map<string, WorldBounds>([
      ["a", box(0, 0, 40, 10)],
      ["b", box(5, 0, 40, 10)],
      ["c", box(20, 0, 40, 10)],
    ]);
    // 0 to 60 holds 120 of box, so each gap is -30.
    const moves = distributeMoves(boxes, "x");

    expect(moves.get("a")).toEqual({ x: 0, y: 0 });
    expect(moves.get("b")).toEqual({ x: 5, y: 0 });
    expect(moves.get("c")).toEqual({ x: 0, y: 0 });
  });

  it("moves nothing for two members", () => {
    const boxes = new Map<string, WorldBounds>([
      ["a", box(0, 0, 10, 10)],
      ["b", box(90, 0, 10, 10)],
    ]);

    expect(distributeMoves(boxes, "x").size).toBe(0);
  });

  it("orders by the leading edge, not by the order handed in", () => {
    const boxes = new Map<string, WorldBounds>([
      ["last", box(90, 0, 10, 10)],
      ["first", box(0, 0, 10, 10)],
      ["middle", box(20, 0, 10, 10)],
    ]);
    // 0 to 100 holds 30 of box, so each gap is 35: the middle starts at 45.
    const moves = distributeMoves(boxes, "x");

    expect(moves.get("first")).toEqual({ x: 0, y: 0 });
    expect(moves.get("middle")).toEqual({ x: 25, y: 0 });
    expect(moves.get("last")).toEqual({ x: 0, y: 0 });
  });
});
