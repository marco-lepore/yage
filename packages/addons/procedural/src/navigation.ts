import { GridGraph } from "@yagejs/pathfinding";
import { ownerOpen, tileOwner } from "./core/layout.js";
import { fail } from "./core/internal.js";
import type {
  RoomConnection,
  RoomLayout,
  RoomPlacement,
  TileMap,
  TileScale,
} from "./core/types.js";

export interface RoomLayoutGraphOptions extends TileScale {
  /**
   * Whether the game holds a key. Asked during every `findPath`, so a
   * collected key opens its rooms and connections without a rebuild.
   * Default: no keys.
   */
  readonly hasKey?: (key: string) => boolean;
}

/**
 * Four-direction navigation over a room layout, with the same rules as
 * `isRoomLayoutWalkable`. Queries and waypoints use world pixels.
 */
export function createRoomLayoutGraph(
  layout: RoomLayout,
  options: RoomLayoutGraphOptions,
): GridGraph {
  const hasKey = options.hasKey ?? (() => false);
  const left = Math.min(...layout.regions.map((r) => r.x)),
    top = Math.min(...layout.regions.map((r) => r.y));
  const cols = Math.max(...layout.regions.map((r) => r.x + r.width)) - left,
    rows = Math.max(...layout.regions.map((r) => r.y + r.height)) - top;
  // Tile owners are resolved once; only the key checks run per query.
  const owners: (RoomPlacement | RoomConnection | null)[] = Array(
    cols * rows,
  ).fill(null);
  for (const room of layout.regions)
    for (let row = 0; row < room.height; row++)
      for (let col = 0; col < room.width; col++)
        owners[(room.y - top + row) * cols + room.x - left + col] = tileOwner(
          layout.connections,
          room,
          col,
          row,
        );
  const rooms = new Map(layout.regions.map((room) => [room.id, room]));
  const room = (id: string): RoomPlacement => rooms.get(id)!;
  return new GridGraph({
    cols,
    rows,
    tileWidth: options.tileWidth,
    tileHeight: options.tileHeight,
    origin: { x: left * options.tileWidth, y: top * options.tileHeight },
    diagonalMovement: "never",
    isWalkable: (col, row) => {
      const owner = owners[row * cols + col];
      return !!owner && ownerOpen(owner, room, hasKey);
    },
  });
}

/** Four-direction navigation over a tile map, such as a cave. Queries and waypoints use world pixels. */
export function createTileMapGraph(map: TileMap, scale: TileScale): GridGraph {
  const rows = map.cells.length,
    cols = map.cells[0]?.length ?? 0;
  if (
    !rows ||
    map.cells.some((row) => row.length !== cols || /[^.#]/u.test(row))
  )
    fail('createTileMapGraph needs equal-length rows of "#" and "." cells');
  const cells = [...map.cells];
  return new GridGraph({
    cols,
    rows,
    tileWidth: scale.tileWidth,
    tileHeight: scale.tileHeight,
    origin: {
      x: map.origin.x * scale.tileWidth,
      y: map.origin.y * scale.tileHeight,
    },
    diagonalMovement: "never",
    isWalkable: (col, row) => cells[row]![col] === ".",
  });
}
