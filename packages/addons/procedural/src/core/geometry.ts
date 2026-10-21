import { assertInteger, fail } from "./internal.js";
import type {
  RoomConnectionArea,
  RoomOpening,
  RoomSide,
  TileBounds,
  TilePoint,
  TileSize,
} from "./types.js";

export const opposite: Record<RoomSide, RoomSide> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};
export const direction: Record<RoomSide, TilePoint> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

/** Room-local boundary tile where an opening starts. */
export function openingPoint(size: TileSize, opening: RoomOpening): TilePoint {
  switch (opening.side) {
    case "north":
      return { x: opening.offset, y: 0 };
    case "south":
      return { x: opening.offset, y: size.height - 1 };
    case "west":
      return { x: 0, y: opening.offset };
    case "east":
      return { x: size.width - 1, y: opening.offset };
  }
}
/** Room-local boundary tiles an opening covers. */
export function openingTiles(size: TileSize, opening: RoomOpening): TileBounds {
  const point = openingPoint(size, opening);
  const horizontal = opening.side === "north" || opening.side === "south";
  return {
    ...point,
    width: horizontal ? opening.width : 1,
    height: horizontal ? 1 : opening.width,
  };
}
/** Every exact opening a set of connection areas permits. */
export function openings(
  areas: readonly RoomConnectionArea[],
): readonly RoomOpening[] {
  return areas.flatMap((area) => {
    const { min, max } = offsetRange(area);
    return Array.from({ length: max - min + 1 }, (_, i) => ({
      areaId: area.id,
      side: area.side,
      offset: min + i,
      width: area.width ?? 1,
      socket: area.socket ?? "passage",
    }));
  });
}
export function openingsOverlap(a: RoomOpening, b: RoomOpening): boolean {
  return (
    a.side === b.side &&
    a.offset < b.offset + b.width &&
    b.offset < a.offset + a.width
  );
}
/** Opposite sides, equal widths, the same socket. */
export function compatible(a: RoomOpening, b: RoomOpening): boolean {
  return (
    opposite[a.side] === b.side && a.socket === b.socket && a.width === b.width
  );
}
/** Whether `b`'s opening starts on the tile beyond `a`'s, for rooms at these positions. */
export function aligned(
  a: TileBounds,
  aOpening: RoomOpening,
  b: TileBounds,
  bOpening: RoomOpening,
): boolean {
  const p = openingPoint(a, aOpening),
    q = openingPoint(b, bOpening),
    d = direction[aOpening.side];
  return a.x + p.x + d.x === b.x + q.x && a.y + p.y + d.y === b.y + q.y;
}
export function overlaps(a: TileBounds, b: TileBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
export function contains(
  outer: TileBounds,
  inner: TilePoint & TileSize,
): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
export function containsTile(bounds: TileBounds, tile: TilePoint): boolean {
  return (
    tile.x >= bounds.x &&
    tile.y >= bounds.y &&
    tile.x < bounds.x + bounds.width &&
    tile.y < bounds.y + bounds.height
  );
}
function offsetRange(area: RoomConnectionArea): { min: number; max: number } {
  return typeof area.offset === "number"
    ? { min: area.offset, max: area.offset }
    : area.offset;
}

/** Throws for a footprint, connection area or mask that cannot be placed or walked. */
export function validateRoomGeometry(
  label: string,
  size: TileSize,
  areas: readonly RoomConnectionArea[],
  navigation: readonly string[] | undefined,
): void {
  const { width, height } = size;
  assertInteger(`${label} width`, width, 3);
  assertInteger(`${label} height`, height, 3);
  for (const area of areas) {
    if (!Object.hasOwn(direction, area.side))
      fail(`${label} connection "${area.id}" has invalid side "${area.side}"`);
    const extent =
      area.side === "north" || area.side === "south" ? width : height;
    const openingWidth = area.width ?? 1;
    assertInteger(
      `${label} connection "${area.id}" width`,
      openingWidth,
      1,
      extent - 2,
    );
    // Openings leave the corner tiles closed.
    const { min, max } = offsetRange(area);
    const last = extent - openingWidth - 1;
    assertInteger(`${label} connection "${area.id}" offset min`, min, 1, last);
    assertInteger(
      `${label} connection "${area.id}" offset max`,
      max,
      min,
      last,
    );
  }
  if (!navigation) return;
  if (
    navigation.length !== height ||
    navigation.some((row) => row.length !== width || /[^.#]/u.test(row))
  )
    fail(
      `${label} navigation must be ${height} rows of ${width} "#" or "." cells`,
    );
  const floor = new Set<number>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (navigation[y]![x] === ".") {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
          fail(`${label} navigation must be "#" on its boundary`);
        floor.add(y * width + x);
      }
  const first = floor.values().next();
  if (first.done) fail(`${label} navigation needs walkable cells`);
  const queue = [first.value];
  floor.delete(first.value);
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i]! % width,
      y = Math.floor(queue[i]! / width);
    for (const d of Object.values(direction)) {
      const key = (y + d.y) * width + x + d.x;
      if (floor.delete(key)) queue.push(key);
    }
  }
  if (floor.size) fail(`${label} navigation floor must be connected`);
  for (const opening of openings(areas)) {
    const tiles = openingTiles(size, opening),
      d = direction[opening.side];
    for (let row = tiles.y; row < tiles.y + tiles.height; row++)
      for (let col = tiles.x; col < tiles.x + tiles.width; col++)
        if (navigation[row - d.y]![col - d.x] !== ".")
          fail(
            `${label} connection "${opening.areaId}" must open onto walkable floor`,
          );
  }
}
