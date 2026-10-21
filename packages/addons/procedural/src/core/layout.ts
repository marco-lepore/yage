import { validateAssignments, resolveRoomTemplate } from "./catalog.js";
import {
  compatible,
  contains,
  direction,
  openingPoint,
  openings,
  openingsOverlap,
  overlaps,
  fail,
} from "./geometry.js";
import { resolveOptions, validateDefinition } from "./validate.js";
import type {
  RoomConnection,
  CatalogDefinition,
  RoomLayout,
  RoomOpening,
  RoomPlacement,
  TilePoint,
} from "./types.js";

export function roomOpenings(
  layout: { readonly connections: readonly RoomConnection[] },
  roomId: string,
): readonly RoomOpening[] {
  return layout.connections.flatMap((edge) =>
    edge.from === roomId
      ? [edge.fromOpening]
      : edge.to === roomId
        ? [edge.toOpening]
        : [],
  );
}
export function validateRoomLayout(
  definition: CatalogDefinition,
  layout: RoomLayout,
): readonly string[] {
  validateDefinition(definition);
  const errors: string[] = validateAssignments(
    definition,
    layout.rooms,
    layout.connections.map((edge) => ({
      ...edge,
      fromPort: edge.fromOpening.areaId,
      toPort: edge.toOpening.areaId,
    })),
  );
  if (errors.length) return errors;
  if (
    layout.generatorVersion !== 4 ||
    layout.definitionId !== definition.id ||
    layout.definitionRevision !== definition.revision
  )
    errors.push(
      "Generator version or definition identity/revision does not match.",
    );
  const options = resolveOptions(layout.options),
    graph = definition.graph;
  const placed = new Map(layout.rooms.map((room) => [room.id, room]));
  for (const room of layout.rooms) {
    const template = resolveRoomTemplate(definition, room);
    if (
      room.width !== template.size.width ||
      room.height !== template.size.height ||
      !Number.isSafeInteger(room.x) ||
      !Number.isSafeInteger(room.y) ||
      Math.abs(room.x) > 1_010_000 ||
      Math.abs(room.y) > 1_010_000
    )
      errors.push(`Room "${room.id}" has invalid geometry.`);
    if (options.bounds && !contains(options.bounds, room))
      errors.push(`Room "${room.id}" exceeds bounds.`);
    if (
      room.id === graph.start &&
      (room.x !== options.origin.x || room.y !== options.origin.y)
    )
      errors.push("Start room does not match origin.");
  }
  for (let i = 0; i < layout.rooms.length; i++)
    for (let j = i + 1; j < layout.rooms.length; j++)
      if (overlaps(layout.rooms[i]!, layout.rooms[j]!))
        errors.push("Placed room footprints overlap.");
  for (const edge of layout.connections) {
    const a = placed.get(edge.from)!,
      b = placed.get(edge.to)!;
    const at = resolveRoomTemplate(definition, a),
      bt = resolveRoomTemplate(definition, b);
    const matches = (x: RoomOpening, y: RoomOpening): boolean =>
      x.areaId === y.areaId &&
      x.side === y.side &&
      x.offset === y.offset &&
      x.width === y.width &&
      x.socket === y.socket;
    if (
      !openings(at).some((o) => matches(o, edge.fromOpening)) ||
      !openings(bt).some((o) => matches(o, edge.toOpening))
    ) {
      errors.push(`Connection "${edge.id}" uses an undeclared opening.`);
      continue;
    }
    const p = openingPoint(at, edge.fromOpening),
      q = openingPoint(bt, edge.toOpening),
      d = direction[edge.fromOpening.side];
    if (
      !compatible(edge.fromOpening, edge.toOpening) ||
      a.x + p.x + d.x !== b.x + q.x ||
      a.y + p.y + d.y !== b.y + q.y
    )
      errors.push(
        `Connection "${edge.id}" has incompatible or misaligned openings.`,
      );
  }
  for (const room of layout.rooms) {
    const selected = roomOpenings(layout, room.id);
    for (let i = 0; i < selected.length; i++)
      for (let j = i + 1; j < selected.length; j++)
        if (openingsOverlap(selected[i]!, selected[j]!))
          errors.push(`Room "${room.id}" has overlapping openings.`);
  }
  const hasMasks = layout.rooms.every(
    (room) => resolveRoomTemplate(definition, room).navigation,
  );
  if (
    layout.validation.requiredRegions !== true ||
    layout.validation.nonOverlapping !== true ||
    layout.validation.compatibleOpenings !== true ||
    layout.validation.progression !== true ||
    layout.validation.connectedWalkableCells !== (hasMasks ? true : null)
  )
    errors.push("Layout validation claims do not match available geometry.");
  return errors;
}
/** Navigation queries require a mask for every placed template. Keys are supplied by the game. */
export function isRoomLayoutWalkable(
  definition: CatalogDefinition,
  layout: RoomLayout,
  point: TilePoint,
  keys: readonly string[] = [],
): boolean {
  const navigation = prepareRoomNavigation(definition, layout, keys);
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y))
    return false;
  const entry = navigation.find(
    ({ room }) =>
      point.x >= room.x &&
      point.y >= room.y &&
      point.x < room.x + room.width &&
      point.y < room.y + room.height,
  );
  return entry
    ? entry.isWalkable(point.x - entry.room.x, point.y - entry.room.y)
    : false;
}

interface RoomNavigation {
  readonly room: RoomPlacement;
  readonly isWalkable: (col: number, row: number) => boolean;
}

/** @internal Shared local-tile queries for point lookups and grid construction. */
export function prepareRoomNavigation(
  definition: CatalogDefinition,
  layout: RoomLayout,
  keys: readonly string[] = [],
): readonly RoomNavigation[] {
  const allowed = (required: readonly string[] | undefined): boolean =>
    (required ?? []).every((key) => keys.includes(key));
  const accessible = new Set(
    definition.graph.regions
      .filter((r) => allowed(r.requires))
      .map((r) => r.id),
  );
  const links = new Set(
    definition.graph.connections
      .filter((c) => allowed(c.requires))
      .map((c) => c.id),
  );
  return layout.rooms.map((room) => {
    const template = resolveRoomTemplate(definition, room);
    const mask = template.navigation;
    if (!mask)
      fail(
        "Room navigation requires a navigation mask for every placed template",
      );
    const passages = layout.connections.flatMap((edge) => {
      if (
        !links.has(edge.id) ||
        !accessible.has(edge.from) ||
        !accessible.has(edge.to)
      )
        return [];
      const opening =
        edge.from === room.id
          ? edge.fromOpening
          : edge.to === room.id
            ? edge.toOpening
            : undefined;
      if (!opening) return [];
      return [
        {
          ...openingPoint(template, opening),
          width:
            opening.side === "north" || opening.side === "south"
              ? opening.width
              : 1,
          height:
            opening.side === "east" || opening.side === "west"
              ? opening.width
              : 1,
        },
      ];
    });
    return {
      room,
      isWalkable: (col, row) => {
        if (!accessible.has(room.id)) return false;
        if (col > 0 && row > 0 && col < room.width - 1 && row < room.height - 1)
          return mask[row]![col] === ".";
        return passages.some(
          (p) =>
            col >= p.x &&
            row >= p.y &&
            col < p.x + p.width &&
            row < p.y + p.height,
        );
      },
    };
  });
}
