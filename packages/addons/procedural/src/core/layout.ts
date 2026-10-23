import { containsTile, openingTiles } from "./geometry.js";
import { hasAll } from "./internal.js";
import type {
  RoomConnection,
  RoomLayout,
  RoomOpening,
  RoomPlacement,
  TilePoint,
} from "./types.js";

/** The opening `edge` uses on room `roomId`, if it touches that room. */
function openingAt(
  edge: RoomConnection,
  roomId: string,
): RoomOpening | undefined {
  return edge.from === roomId
    ? edge.fromOpening
    : edge.to === roomId
      ? edge.toOpening
      : undefined;
}

/** The openings a layout selected on one room's boundary. */
export function roomOpenings(
  layout: Pick<RoomLayout, "connections">,
  roomId: string,
): readonly RoomOpening[] {
  return layout.connections.flatMap((edge) => {
    const opening = openingAt(edge, roomId);
    return opening ? [opening] : [];
  });
}

/**
 * @internal What makes a room-local tile walkable: the room's floor, a
 * selected opening's connection, or nothing. A room without a mask has walls
 * on its boundary and an open floor inside.
 */
export function tileOwner(
  connections: readonly RoomConnection[],
  room: RoomPlacement,
  col: number,
  row: number,
): RoomPlacement | RoomConnection | null {
  if (col > 0 && row > 0 && col < room.width - 1 && row < room.height - 1)
    return !room.navigation || room.navigation[row]![col] === "." ? room : null;
  for (const edge of connections) {
    const opening = openingAt(edge, room.id);
    if (
      opening &&
      containsTile(openingTiles(room, opening), { x: col, y: row })
    )
      return edge;
  }
  return null;
}

/** @internal Whether the held keys open a tile's owner. */
export function ownerOpen(
  owner: RoomPlacement | RoomConnection,
  room: (id: string) => RoomPlacement,
  hasKey: (key: string) => boolean,
): boolean {
  if (!("fromOpening" in owner)) return hasAll(owner.requires, hasKey);
  return (
    hasAll(owner.requires, hasKey) &&
    hasAll(room(owner.from).requires, hasKey) &&
    hasAll(room(owner.to).requires, hasKey)
  );
}

/**
 * Whether a point moving in four directions can stand on `tile`. Locked
 * rooms and connections are blocked unless `hasKey` returns true for every
 * key they require; it is asked on every call, so the answer follows the
 * game's current keys. Non-integer tiles return false.
 */
export function isRoomLayoutWalkable(
  layout: RoomLayout,
  tile: TilePoint,
  hasKey: (key: string) => boolean = () => false,
): boolean {
  if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) return false;
  const room = layout.regions.find((r) => containsTile(r, tile));
  if (!room) return false;
  const owner = tileOwner(
    layout.connections,
    room,
    tile.x - room.x,
    tile.y - room.y,
  );
  return (
    owner !== null &&
    ownerOpen(owner, (id) => layout.regions.find((r) => r.id === id)!, hasKey)
  );
}
