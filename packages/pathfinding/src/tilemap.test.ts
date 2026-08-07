import { Vec2 } from "@yagejs/core";
import type { TilemapColliderConfig, TilemapData } from "@yagejs/tilemap";
import { describe, expect, it } from "vitest";
import type { GridGraph } from "./GridGraph.js";
import { gridFromColliders, gridFromTilemap } from "./tilemap.js";

/** 4x3 map with a "collision" layer: two wall tiles (gid 1) in the middle of row 1. */
function buildTilemap(overrides: Partial<TilemapData> = {}): TilemapData {
  return {
    width: 4,
    height: 3,
    tileWidth: 10,
    tileHeight: 10,
    tilesets: [],
    diagnostics: [],
    tileLayers: [
      {
        name: "collision",
        width: 4,
        height: 3,
        visible: true,
        offsetX: 0,
        offsetY: 0,
        // prettier-ignore
        data: [
          0, 0, 0, 0,
          0, 1, 1, 0,
          0, 0, 0, 0,
        ],
      },
    ],
    objectLayers: [],
    ...overrides,
  };
}

describe("gridFromTilemap", () => {
  it("marks nonzero gids as walls by default", () => {
    const grid = gridFromTilemap(buildTilemap());

    const clearRow = grid.findPath({ x: 5, y: 5 }, { x: 35, y: 5 }); // row 0, no walls
    expect(clearRow).not.toBeNull();
    expect(clearRow!.cells.every((c) => c.row === 0)).toBe(true);

    const blockedRow = grid.findPath({ x: 5, y: 15 }, { x: 35, y: 15 }); // row 1, walls at col 1/2
    expect(blockedRow).not.toBeNull();
    expect(blockedRow!.cells.some((c) => c.row !== 1)).toBe(true); // must detour off row 1
  });

  it("restricts blocking to the named layers", () => {
    const data = buildTilemap({
      tileLayers: [
        {
          name: "collision",
          width: 4,
          height: 3,
          visible: true,
          offsetX: 0,
          offsetY: 0,
          // prettier-ignore
          data: [
            0, 0, 0, 0,
            0, 1, 1, 0,
            0, 0, 0, 0,
          ],
        },
        {
          name: "decoration",
          width: 4,
          height: 3,
          visible: true,
          offsetX: 0,
          offsetY: 0,
          // prettier-ignore
          data: [
            0, 0, 0, 0,
            0, 0, 0, 0,
            1, 1, 1, 1,
          ],
        },
      ],
    });
    const grid = gridFromTilemap(data, { layers: ["collision"] });

    // decoration's row-2 wall is ignored because only "collision" was read.
    const path = grid.findPath({ x: 5, y: 25 }, { x: 35, y: 25 });
    expect(path).not.toBeNull();
    expect(path!.cells.every((c) => c.row === 2)).toBe(true);
  });

  it("honors a custom blocked predicate", () => {
    const grid = gridFromTilemap(buildTilemap(), { blocked: () => false });
    const path = grid.findPath({ x: 5, y: 15 }, { x: 35, y: 15 });
    expect(path!.cells.every((c) => c.row === 1)).toBe(true); // straight through despite gid 1s
  });

  it("honors a custom cost function", () => {
    const grid = gridFromTilemap(buildTilemap(), {
      blocked: () => false,
      cost: (gid) => (gid === 1 ? 10 : 1),
    });
    const path = grid.findPath({ x: 5, y: 15 }, { x: 35, y: 15 });
    expect(path!.cells.some((c) => c.row !== 1)).toBe(true); // detours around the costly gid-1 cells
  });

  it("threads origin into worldToCell/cellToWorld", () => {
    const grid = gridFromTilemap(buildTilemap(), {
      origin: { x: 100, y: 200 },
    });
    expect(grid.cellToWorld(0, 0)).toEqual(new Vec2(105, 205));
  });

  it("builds and routes around a wall end-to-end", () => {
    const grid = gridFromTilemap(buildTilemap());
    const path = grid.findPath({ x: 5, y: 25 }, { x: 35, y: 25 }); // row 2, clear
    expect(path).not.toBeNull();
    expect(path!.cells.every((c) => c.row === 2)).toBe(true);

    const intoWall = grid.findPath({ x: 5, y: 5 }, { x: 15, y: 15 }); // goal cell (1,1) is a wall
    expect(intoWall).toBeNull();
  });

  it("masks Tiled flip flags off gids before the blocked/cost callbacks", () => {
    const FLIP_H = 0x80000000;
    const map = buildTilemap();
    // Replace the wall at (1,1) with a horizontally-flipped instance of gid 1.
    map.tileLayers[0]!.data[5] = (FLIP_H | 1) >>> 0;

    const seen: number[] = [];
    const grid = gridFromTilemap(map, {
      blocked: (gid) => {
        seen.push(gid);
        return gid === 1;
      },
    });

    expect(seen).not.toContain((FLIP_H | 1) >>> 0); // callbacks get base ids only
    const blockedRow = grid.findPath({ x: 5, y: 15 }, { x: 35, y: 15 });
    expect(blockedRow!.cells.some((c) => c.row !== 1)).toBe(true); // flipped wall still blocks
  });

  it("throws when a layers filter matches no tile layer", () => {
    expect(() =>
      gridFromTilemap(buildTilemap(), { layers: ["colision"] }),
    ).toThrow(/no tile layer matches/);
  });
});

/** Bare grid dimensions — `gridFromColliders` never reads tileLayers/objectLayers. */
function buildData(overrides: Partial<TilemapData> = {}): TilemapData {
  return {
    width: 3,
    height: 3,
    tileWidth: 10,
    tileHeight: 10,
    tileLayers: [],
    objectLayers: [],
    tilesets: [],
    diagnostics: [],
    ...overrides,
  };
}

/**
 * Whether `(col, row)` is walkable, probed through an orthogonal neighbor
 * `(nCol, nRow)`. `findPath` only requires the *goal* cell to be walkable —
 * the start may be blocked — so a direct edge between adjacent cells always
 * exists when the goal is walkable, regardless of the start's own status or
 * of any other cell in the grid. That makes this probe exact: non-null iff
 * `(col, row)` is walkable.
 */
function walkable(
  grid: GridGraph,
  col: number,
  row: number,
  nCol: number,
  nRow: number,
): boolean {
  return (
    grid.findPath(grid.cellToWorld(nCol, nRow), grid.cellToWorld(col, row)) !==
    null
  );
}

describe("gridFromColliders", () => {
  it("blocks exactly the cells a rect fully covers", () => {
    // Interior to cols 1-2, row 0 only — doesn't touch any cell boundary.
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 11, y: 1, width: 18, height: 8 },
    ];
    const grid = gridFromColliders(buildData({ width: 5, height: 2 }), {
      shapes,
    });

    expect(walkable(grid, 0, 0, 0, 1)).toBe(true);
    expect(walkable(grid, 1, 0, 1, 1)).toBe(false);
    expect(walkable(grid, 2, 0, 2, 1)).toBe(false);
    expect(walkable(grid, 3, 0, 3, 1)).toBe(true);
    expect(walkable(grid, 4, 0, 4, 1)).toBe(true);
  });

  it("blocks a cell a rect only grazes at a shared edge", () => {
    // Exactly fills col 0; its right edge lands exactly on col 1's left edge.
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 0, y: 1, width: 10, height: 8 },
    ];
    const grid = gridFromColliders(buildData({ width: 3, height: 2 }), {
      shapes,
    });

    expect(walkable(grid, 0, 0, 0, 1)).toBe(false); // fully covered
    expect(walkable(grid, 1, 0, 1, 1)).toBe(false); // grazed, still blocks
    expect(walkable(grid, 2, 0, 2, 1)).toBe(true); // untouched
  });

  it("rotates a rect about its (x, y) pivot: blocks the cross it sweeps, not the diagonal corners", () => {
    // A square of side 8*sqrt2 rotated 45 degrees about (25, 17) forms a
    // diamond centered on (25, 25) reaching 8px into each of the 4
    // orthogonal neighbor cells, short of the 4 diagonal corner cells
    // (whose nearest point is 10px away in each axis).
    const shapes: TilemapColliderConfig[] = [
      {
        type: "rect",
        x: 25,
        y: 17,
        width: 8 * Math.SQRT2,
        height: 8 * Math.SQRT2,
        rotation: Math.PI / 4,
      },
    ];
    const grid = gridFromColliders(buildData({ width: 5, height: 5 }), {
      shapes,
    });

    expect(walkable(grid, 2, 2, 2, 0)).toBe(false); // center
    expect(walkable(grid, 2, 1, 2, 0)).toBe(false); // top
    expect(walkable(grid, 3, 2, 4, 2)).toBe(false); // right
    expect(walkable(grid, 2, 3, 2, 4)).toBe(false); // bottom
    expect(walkable(grid, 1, 2, 0, 2)).toBe(false); // left
    expect(walkable(grid, 1, 1, 1, 0)).toBe(true); // diagonal corner
    expect(walkable(grid, 3, 1, 3, 0)).toBe(true);
    expect(walkable(grid, 1, 3, 1, 4)).toBe(true);
    expect(walkable(grid, 3, 3, 3, 4)).toBe(true);
  });

  it("blocks a circle's disc, not the AABB corners", () => {
    // Radius 6 circle centered on (25, 25): reaches the 4 orthogonal
    // neighbors (5px to their nearest edge) but not the diagonal corners
    // (7.07px to their nearest corner).
    const shapes: TilemapColliderConfig[] = [
      { type: "circle", x: 19, y: 19, width: 12, height: 12, radius: 6 },
    ];
    const grid = gridFromColliders(buildData({ width: 5, height: 5 }), {
      shapes,
    });

    expect(walkable(grid, 2, 2, 2, 0)).toBe(false); // center
    expect(walkable(grid, 2, 1, 2, 0)).toBe(false); // top
    expect(walkable(grid, 3, 2, 4, 2)).toBe(false); // right
    expect(walkable(grid, 2, 3, 2, 4)).toBe(false); // bottom
    expect(walkable(grid, 1, 2, 0, 2)).toBe(false); // left
    expect(walkable(grid, 1, 1, 1, 0)).toBe(true); // diagonal corner
    expect(walkable(grid, 3, 1, 3, 0)).toBe(true);
    expect(walkable(grid, 1, 3, 1, 4)).toBe(true);
    expect(walkable(grid, 3, 3, 3, 4)).toBe(true);
  });

  it("blocks the cells a capsule's rounded core sweeps", () => {
    // Horizontal capsule, halfHeight 17, radius 3, bbox y:[2,8] (row 0
    // only). Core segment runs x:[5,39] at y=5; rounded ends extend the
    // reach to x:[2,42] — cols 0-4 overlap, col 5 (starting at x=50) doesn't.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "capsule",
        x: 2,
        y: 2,
        width: 40,
        height: 6,
        halfHeight: 17,
        radius: 3,
        axis: "x",
      },
    ];
    const grid = gridFromColliders(buildData({ width: 6, height: 2 }), {
      shapes,
    });

    for (let col = 0; col <= 4; col++) {
      expect(walkable(grid, col, 0, col, 1)).toBe(false);
    }
    expect(walkable(grid, 5, 0, 5, 1)).toBe(true);
  });

  it("leaves the concavity of a concave polygon walkable", () => {
    // A "U" traced as one outline: solid everywhere except a notch cut out
    // of the top (x:[9,21], y:[0,21]) — insetting the notch 1px from cols
    // 1/2's shared edges keeps this test independent from the edge-graze
    // behavior covered above.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polygon",
        x: 0,
        y: 0,
        vertices: [
          { x: 0, y: 30 },
          { x: 0, y: 0 },
          { x: 9, y: 0 },
          { x: 9, y: 21 },
          { x: 21, y: 21 },
          { x: 21, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 30 },
        ],
      },
    ];
    const grid = gridFromColliders(buildData({ width: 3, height: 3 }), {
      shapes,
    });

    expect(walkable(grid, 0, 0, 1, 0)).toBe(false); // left leg
    expect(walkable(grid, 2, 0, 1, 0)).toBe(false); // right leg
    expect(walkable(grid, 0, 1, 1, 1)).toBe(false);
    expect(walkable(grid, 2, 1, 1, 1)).toBe(false);
    expect(walkable(grid, 0, 2, 1, 2)).toBe(false); // bottom connector
    expect(walkable(grid, 1, 2, 1, 1)).toBe(false);
    expect(walkable(grid, 2, 2, 1, 2)).toBe(false);
    expect(walkable(grid, 1, 0, 1, 1)).toBe(true); // notch interior
    expect(walkable(grid, 1, 1, 1, 0)).toBe(true);
  });

  it("fills a closed polyline — the shape a Tiled Polygon-tool object extracts as", () => {
    // The extractor converts polygon objects to polylines with the first
    // vertex re-appended; the closed chain means "region", so the interior
    // fills. A rectangular ring whose interior spans cells (1,1) and (2,1) —
    // probing between those two adjacent interior cells distinguishes a real
    // fill from mere enclosure by the blocked ring.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polyline",
        x: 0,
        y: 0,
        vertices: [
          { x: 1, y: 1 },
          { x: 39, y: 1 },
          { x: 39, y: 29 },
          { x: 1, y: 29 },
          { x: 1, y: 1 }, // closing vertex, as extractCollisionShapes appends
        ],
      },
    ];
    const grid = gridFromColliders(buildData({ width: 5, height: 3 }), {
      shapes,
    });

    expect(walkable(grid, 1, 1, 2, 1)).toBe(false); // interior fills (no edge crosses either cell)
    expect(walkable(grid, 3, 0, 4, 0)).toBe(false); // the ring itself blocks
    expect(walkable(grid, 4, 1, 4, 0)).toBe(true); // outside the ring
  });

  it("blocks every cell a thin polyline crosses and no others", () => {
    // Slope-0.8 diagonal (not 45 degrees, so it never lands exactly on a
    // grid vertex): a clean staircase through 5 of the 9 cells.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polyline",
        x: 0,
        y: 3,
        vertices: [
          { x: 0, y: 0 },
          { x: 30, y: 24 },
        ],
      },
    ];
    const grid = gridFromColliders(buildData({ width: 3, height: 3 }), {
      shapes,
    });

    const blocked = new Set(["0,0", "0,1", "1,1", "2,1", "2,2"]);
    for (let row = 0; row < 3; row++) {
      const nRow = row === 0 ? 1 : row - 1; // an adjacent row, used as the probe neighbor
      for (let col = 0; col < 3; col++) {
        expect(walkable(grid, col, row, col, nRow)).toBe(
          !blocked.has(`${col},${row}`),
        );
      }
    }
  });

  it("blocks every cell a large polygon fully contains", () => {
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polygon",
        x: 0,
        y: 0,
        vertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      },
    ];
    const grid = gridFromColliders(
      buildData({ width: 10, height: 10, tileWidth: 10, tileHeight: 10 }),
      {
        shapes,
      },
    );

    expect(walkable(grid, 5, 5, 5, 6)).toBe(false); // well inside, far from any edge
  });

  it("blocks the one cell a small polygon sits inside, not its neighbors", () => {
    // A 6x6 square centered in cell (1,1), nowhere near its edges.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polygon",
        x: 0,
        y: 0,
        vertices: [
          { x: 12, y: 12 },
          { x: 18, y: 12 },
          { x: 18, y: 18 },
          { x: 12, y: 18 },
        ],
      },
    ];
    const grid = gridFromColliders(buildData({ width: 3, height: 3 }), {
      shapes,
    });

    expect(walkable(grid, 1, 1, 0, 1)).toBe(false);
    expect(walkable(grid, 0, 1, 1, 1)).toBe(true);
    expect(walkable(grid, 2, 1, 1, 1)).toBe(true);
    expect(walkable(grid, 1, 0, 1, 1)).toBe(true);
    expect(walkable(grid, 1, 2, 1, 1)).toBe(true);
  });

  it("clamps a shape outside the grid without throwing, and blocks nothing", () => {
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: -1000, y: -1000, width: 10, height: 10 },
    ];
    expect(() => gridFromColliders(buildData(), { shapes })).not.toThrow();

    const grid = gridFromColliders(buildData(), { shapes });
    expect(walkable(grid, 0, 0, 1, 0)).toBe(true);
  });

  it("clamps a shape straddling the grid boundary to its in-bounds portion", () => {
    // x:[-5,5] x y:[-5,5] overlaps cell (0,0) only in its own top-left quarter.
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: -5, y: -5, width: 10, height: 10 },
    ];
    const grid = gridFromColliders(buildData(), { shapes });

    expect(walkable(grid, 0, 0, 1, 0)).toBe(false);
    expect(walkable(grid, 1, 0, 0, 0)).toBe(true);
  });

  it("threads origin into worldToCell/cellToWorld without shifting shape coordinates", () => {
    // The shape covers cell (1,1) in map-local px; origin only moves the
    // world <-> cell mapping the caller's coordinates go through.
    const shapes: TilemapColliderConfig[] = [
      { type: "rect", x: 11, y: 11, width: 8, height: 8 },
    ];
    const grid = gridFromColliders(buildData(), {
      shapes,
      origin: { x: 100, y: 200 },
    });

    expect(grid.cellToWorld(0, 0)).toEqual(new Vec2(105, 205));
    expect(
      grid.findPath(grid.cellToWorld(0, 1), grid.cellToWorld(1, 1)),
    ).toBeNull();
    expect(
      grid.findPath(grid.cellToWorld(0, 0), grid.cellToWorld(1, 0)),
    ).not.toBeNull();
  });

  it("builds and routes around a polygon wall end-to-end", () => {
    // Solid block over cols 0-2, row 1 (x:[0,29], y:[11,19]) — inset 1px
    // from every shared grid line, so it blocks only row 1 (not rows 0/2)
    // and leaves col 3's row 1 (x:[30,40]) open as the only gap.
    const shapes: TilemapColliderConfig[] = [
      {
        type: "polygon",
        x: 0,
        y: 11,
        vertices: [
          { x: 0, y: 0 },
          { x: 29, y: 0 },
          { x: 29, y: 8 },
          { x: 0, y: 8 },
        ],
      },
    ];
    const grid = gridFromColliders(buildData({ width: 4, height: 3 }), {
      shapes,
    });

    const path = grid.findPath({ x: 5, y: 5 }, { x: 35, y: 25 }); // (0,0) -> (3,2)
    expect(path).not.toBeNull();
    expect(path!.cells.some((c) => c.col === 3 && c.row === 1)).toBe(true); // through the gap
    expect(path!.cells.some((c) => c.row === 1 && c.col < 3)).toBe(false); // never the wall
  });
});
