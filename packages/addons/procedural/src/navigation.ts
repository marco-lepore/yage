import { GridGraph } from "@yagejs/pathfinding";
import { prepareRoomNavigation, validateRoomLayout } from "./core/layout.js";
import { assertInteger, fail } from "./core/geometry.js";
import type {
  CatalogDefinition,
  RoomLayout,
  TileMap,
  TileScale,
} from "./core/types.js";
import { resolveTileScale } from "./scale.js";
export interface RoomNavigationOptions {
  readonly keys?: readonly string[];
  readonly maxCells?: number;
}
/** Static four-neighbour navigation. Rebuild when the game's collected keys change. */
export function createRoomLayoutGraph(
  definition: CatalogDefinition,
  layout: RoomLayout,
  scale: TileScale,
  options: RoomNavigationOptions = {},
): GridGraph {
  resolveTileScale(scale);
  const errors = validateRoomLayout(definition, layout);
  if (errors.length) fail(`invalid navigation layout: ${errors.join("; ")}`);
  if (layout.validation.connectedWalkableCells !== true)
    fail(
      "Room navigation requires a navigation mask for every placed template",
    );
  const x = Math.min(...layout.rooms.map((r) => r.x)),
    y = Math.min(...layout.rooms.map((r) => r.y));
  const width = Math.max(...layout.rooms.map((r) => r.x + r.width)) - x,
    height = Math.max(...layout.rooms.map((r) => r.y + r.height)) - y;
  const max = options.maxCells ?? 1_000_000;
  assertInteger("createRoomLayoutGraph maxCells", max, 1, 10_000_000);
  assertInteger("createRoomLayoutGraph cell count", width * height, 1, max);
  const navigation = prepareRoomNavigation(definition, layout, options.keys);
  const cells = Array.from({ length: height }, () =>
    Array<string>(width).fill("#"),
  );
  for (const { room, isWalkable } of navigation)
    for (let row = 0; row < room.height; row++)
      for (let col = 0; col < room.width; col++)
        if (isWalkable(col, row))
          cells[room.y - y + row]![room.x - x + col] = ".";
  return createTileMapGraph(
    { origin: { x, y }, cells: cells.map((row) => row.join("")) },
    scale,
    max,
  );
}
/** Navigation for a cell map, including cave output. No room catalog or region graph required. */
export function createTileMapGraph(
  map: TileMap,
  scale: TileScale,
  maxCells = 1_000_000,
): GridGraph {
  const { tileWidth, tileHeight } = resolveTileScale(scale);
  assertInteger("createTileMapGraph maxCells", maxCells, 1, 10_000_000);
  const rows = map.cells.length,
    cols = map.cells[0]?.length ?? 0;
  assertInteger("createTileMapGraph cell count", rows * cols, 1, maxCells);
  for (const axis of ["x", "y"] as const)
    assertInteger(
      `createTileMapGraph origin.${axis}`,
      map.origin[axis],
      -1_000_000,
      1_000_000,
    );
  if (map.cells.some((row) => row.length !== cols || /[^.#]/u.test(row)))
    fail("TileMap cells must be a rectangular #/. mask");
  const cells = [...map.cells];
  return new GridGraph({
    cols,
    rows,
    tileWidth,
    tileHeight,
    origin: { x: map.origin.x * tileWidth, y: map.origin.y * tileHeight },
    diagonalMovement: "never",
    isWalkable: (col, row) => cells[row]?.[col] === ".",
  });
}
