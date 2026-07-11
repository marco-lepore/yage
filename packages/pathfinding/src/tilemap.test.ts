import { Vec2 } from "@yagejs/core";
import type { TilemapData } from "@yagejs/tilemap";
import { describe, expect, it } from "vitest";
import { gridFromTilemap } from "./tilemap.js";

/** 4x3 map with a "collision" layer: two wall tiles (gid 1) in the middle of row 1. */
function buildTilemap(overrides: Partial<TilemapData> = {}): TilemapData {
  return {
    width: 4,
    height: 3,
    tileWidth: 10,
    tileHeight: 10,
    tileLayers: [
      {
        name: "collision",
        width: 4,
        height: 3,
        visible: true,
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
    const grid = gridFromTilemap(buildTilemap(), { origin: { x: 100, y: 200 } });
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
});
