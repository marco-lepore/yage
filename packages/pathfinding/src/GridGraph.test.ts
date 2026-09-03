import { Vec2 } from "@yagejs/core";
import { describe, expect, it } from "vitest";
import { GridGraph } from "./GridGraph.js";

describe("GridGraph", () => {
  it("round-trips worldToCell/cellToWorld at the cell centre", () => {
    const grid = new GridGraph({ cols: 4, rows: 4, tileWidth: 16, tileHeight: 16, isWalkable: () => true });
    const center = grid.cellToWorld(2, 1);
    expect(grid.worldToCell(center)).toEqual({ col: 2, row: 1 });
  });

  it("applies the origin offset", () => {
    const grid = new GridGraph({
      cols: 4,
      rows: 4,
      tileWidth: 16,
      tileHeight: 16,
      isWalkable: () => true,
      origin: { x: 100, y: 200 },
    });
    expect(grid.cellToWorld(0, 0)).toEqual(new Vec2(108, 208));
    expect(grid.worldToCell({ x: 108, y: 208 })).toEqual({ col: 0, row: 0 });
  });

  it("reports inBounds at the edges", () => {
    const grid = new GridGraph({ cols: 3, rows: 3, tileWidth: 10, tileHeight: 10, isWalkable: () => true });
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(2, 2)).toBe(true);
    expect(grid.inBounds(3, 0)).toBe(false);
    expect(grid.inBounds(0, 3)).toBe(false);
    expect(grid.inBounds(-1, 0)).toBe(false);
  });

  it("finds a straight diagonal path on an empty grid", () => {
    const grid = new GridGraph({
      cols: 5,
      rows: 5,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: () => true,
      diagonalMovement: "always",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 45, y: 45 });
    expect(path).not.toBeNull();
    expect(path!.cells[0]).toEqual({ col: 0, row: 0 });
    expect(path!.cells.at(-1)).toEqual({ col: 4, row: 4 });
    expect(path!.waypoints).toHaveLength(5);
    expect(path!.cost).toBeCloseTo(4 * Math.SQRT2);
  });

  it("detours around a wall that blocks the direct route", () => {
    // Vertical wall at col 2, open only at row 4 (the U's gap).
    const blocked = new Set(["2,0", "2,1", "2,2", "2,3"]);
    const grid = new GridGraph({
      cols: 5,
      rows: 5,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !blocked.has(`${col},${row}`),
      diagonalMovement: "never",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 45, y: 5 });
    expect(path).not.toBeNull();
    expect(path!.cells.some((c) => c.row === 4)).toBe(true); // detours down through the gap
  });

  it("returns null when the goal cell itself is not walkable", () => {
    const grid = new GridGraph({
      cols: 3,
      rows: 3,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !(col === 2 && row === 2),
    });
    expect(grid.findPath({ x: 5, y: 5 }, { x: 25, y: 25 })).toBeNull();
  });

  it("returns null when the goal is fully enclosed by walls", () => {
    // Corner cell (4,4) has only two orthogonal neighbours; block both.
    const blocked = new Set(["3,4", "4,3"]);
    const grid = new GridGraph({
      cols: 5,
      rows: 5,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !blocked.has(`${col},${row}`),
      diagonalMovement: "never",
    });
    expect(grid.findPath({ x: 5, y: 5 }, { x: 45, y: 45 })).toBeNull();
  });

  it("returns null when the goal is out of bounds", () => {
    const grid = new GridGraph({ cols: 3, rows: 3, tileWidth: 10, tileHeight: 10, isWalkable: () => true });
    expect(grid.findPath({ x: 5, y: 5 }, { x: 500, y: 500 })).toBeNull();
  });

  it("returns null when the start is out of bounds", () => {
    const grid = new GridGraph({ cols: 3, rows: 3, tileWidth: 10, tileHeight: 10, isWalkable: () => true });
    expect(grid.findPath({ x: -500, y: -500 }, { x: 5, y: 5 })).toBeNull();
  });

  it("returns a single-waypoint zero-cost path when start and goal share a cell", () => {
    const grid = new GridGraph({ cols: 3, rows: 3, tileWidth: 10, tileHeight: 10, isWalkable: () => true });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 9, y: 9 });
    expect(path).toEqual({
      cells: [{ col: 0, row: 0 }],
      waypoints: [grid.cellToWorld(0, 0)],
      cost: 0,
    });
  });

  it("still searches from a blocked start cell", () => {
    const grid = new GridGraph({
      cols: 3,
      rows: 1,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col) => col !== 0,
      diagonalMovement: "never",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 25, y: 5 });
    expect(path).not.toBeNull();
    expect(path!.cells[0]).toEqual({ col: 0, row: 0 });
  });

  it("'never' produces only orthogonal steps", () => {
    const grid = new GridGraph({
      cols: 3,
      rows: 3,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: () => true,
      diagonalMovement: "never",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 25, y: 25 });
    expect(path).not.toBeNull();
    for (let i = 1; i < path!.cells.length; i++) {
      const a = path!.cells[i - 1]!;
      const b = path!.cells[i]!;
      const dc = Math.abs(b.col - a.col);
      const dr = Math.abs(b.row - a.row);
      expect(dc + dr).toBe(1); // exactly one axis moves per step
    }
  });

  it("'no-corner-cutting' refuses a diagonal past a single blocked orthogonal neighbour", () => {
    const grid = new GridGraph({
      cols: 2,
      rows: 2,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !(col === 1 && row === 0), // blocks (1,0) only
      diagonalMovement: "no-corner-cutting",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 15, y: 15 }); // (0,0) -> (1,1)
    expect(path).not.toBeNull();
    expect(path!.cells).toEqual([
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ]);
  });

  it("'always' cuts the corner a single blocked orthogonal neighbour would otherwise block", () => {
    const grid = new GridGraph({
      cols: 2,
      rows: 2,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !(col === 1 && row === 0),
      diagonalMovement: "always",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 15, y: 15 });
    expect(path).not.toBeNull();
    expect(path!.cells).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ]);
  });

  it("weighted cost reroutes around an expensive lane", () => {
    // Row 0 costs 10/cell, row 1 costs 1/cell — cheaper to detour down and back.
    const grid = new GridGraph({
      cols: 5,
      rows: 2,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: () => true,
      cost: (_col, row) => (row === 0 ? 10 : 1),
      diagonalMovement: "never",
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 45, y: 5 }); // (0,0) -> (4,0)
    expect(path).not.toBeNull();
    expect(path!.cells.some((c) => c.row === 1)).toBe(true);
    expect(path!.cost).toBeCloseTo(15); // 5 row-1 entries (cost 1) + 1 row-0 entry (cost 10)
  });

  it("re-reads isWalkable on every findPath call", () => {
    const blocked = new Set<string>(["1,0"]);
    const grid = new GridGraph({
      cols: 3,
      rows: 2,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: (col, row) => !blocked.has(`${col},${row}`),
      diagonalMovement: "never",
    });

    const before = grid.findPath({ x: 5, y: 5 }, { x: 25, y: 5 });
    expect(before!.cells.some((c) => c.row === 1)).toBe(true); // detours around (1,0)

    blocked.clear(); // door opens
    const after = grid.findPath({ x: 5, y: 5 }, { x: 25, y: 5 });
    expect(after!.cells.every((c) => c.row === 0)).toBe(true); // straight line now
  });

  it("is deterministic across identical calls", () => {
    const grid = new GridGraph({
      cols: 6,
      rows: 6,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: () => true,
      diagonalMovement: "always",
    });
    const a = grid.findPath({ x: 5, y: 5 }, { x: 55, y: 55 });
    const b = grid.findPath({ x: 5, y: 5 }, { x: 55, y: 55 });
    expect(a).toEqual(b);
  });

  it("rejects unusable tile dimensions", () => {
    const base = { cols: 4, rows: 4, isWalkable: () => true };
    expect(() => new GridGraph({ ...base, tileWidth: 0, tileHeight: 16 })).toThrow(
      /tileWidth must be finite and > 0, got 0/,
    );
    expect(() => new GridGraph({ ...base, tileWidth: 16, tileHeight: -8 })).toThrow(
      /tileHeight must be finite and > 0, got -8/,
    );
    expect(() => new GridGraph({ ...base, tileWidth: NaN, tileHeight: 16 })).toThrow(
      /tileWidth must be finite and > 0, got NaN/,
    );
    expect(() => new GridGraph({ ...base, tileWidth: Infinity, tileHeight: 16 })).toThrow(
      /tileWidth must be finite and > 0, got Infinity/,
    );
  });

  it("rejects grid extents that are not whole counts of cells", () => {
    const base = { tileWidth: 10, tileHeight: 10, isWalkable: () => true };
    expect(() => new GridGraph({ ...base, cols: 0, rows: 4 })).toThrow(
      /cols must be an integer >= 1, got 0/,
    );
    expect(() => new GridGraph({ ...base, cols: 4.5, rows: 4 })).toThrow(
      /cols must be an integer >= 1, got 4.5/,
    );
    expect(() => new GridGraph({ ...base, cols: NaN, rows: 4 })).toThrow(
      /cols must be an integer >= 1, got NaN/,
    );
    expect(() => new GridGraph({ ...base, cols: 4, rows: 0 })).toThrow(
      /rows must be an integer >= 1, got 0/,
    );
    expect(() => new GridGraph({ ...base, cols: 4, rows: 2.5 })).toThrow(
      /rows must be an integer >= 1, got 2.5/,
    );
  });

  it("rejects a non-finite origin", () => {
    const base = { cols: 4, rows: 4, tileWidth: 10, tileHeight: 10, isWalkable: () => true };
    expect(() => new GridGraph({ ...base, origin: { x: NaN, y: 0 } })).toThrow(
      /origin.x must be finite, got NaN/,
    );
    expect(() => new GridGraph({ ...base, origin: { x: 0, y: Infinity } })).toThrow(
      /origin.y must be finite, got Infinity/,
    );
  });

  it("throws from findPath when cost returns a non-finite number", () => {
    const base = { cols: 4, rows: 1, tileWidth: 10, tileHeight: 10, isWalkable: () => true };
    const grid = new GridGraph({
      ...base,
      cost: (col) => (col === 2 ? NaN : 1),
    });
    expect(() => grid.findPath({ x: 5, y: 5 }, { x: 35, y: 5 })).toThrow(
      /GridGraph.findPath: cost must return a finite number, got NaN at cell \(2, 0\)/,
    );

    const finite = new GridGraph({ ...base, cost: () => 1 });
    expect(finite.findPath({ x: 5, y: 5 }, { x: 35, y: 5 })).not.toBeNull();
  });

  it("searches without a cost option", () => {
    const grid = new GridGraph({
      cols: 4,
      rows: 1,
      tileWidth: 10,
      tileHeight: 10,
      isWalkable: () => true,
    });
    const path = grid.findPath({ x: 5, y: 5 }, { x: 35, y: 5 });
    expect(path!.cells).toHaveLength(4);
  });
});
