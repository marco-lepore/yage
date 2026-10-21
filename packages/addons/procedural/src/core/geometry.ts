import type {
  CatalogDefinition,
  RoomOpening,
  RoomSide,
  RoomTemplate,
  TileBounds,
  TilePoint,
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
export function openingPoint(
  template: RoomTemplate,
  opening: RoomOpening,
): TilePoint {
  switch (opening.side) {
    case "north":
      return { x: opening.offset, y: 0 };
    case "south":
      return { x: opening.offset, y: template.size.height - 1 };
    case "west":
      return { x: 0, y: opening.offset };
    case "east":
      return { x: template.size.width - 1, y: opening.offset };
  }
}
export function openings(template: RoomTemplate): RoomOpening[] {
  return template.connections.flatMap((area) => {
    const min = typeof area.offset === "number" ? area.offset : area.offset.min;
    const max = typeof area.offset === "number" ? area.offset : area.offset.max;
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
export function compatible(a: RoomOpening, b: RoomOpening): boolean {
  return (
    opposite[a.side] === b.side && a.socket === b.socket && a.width === b.width
  );
}
export function overlaps(a: TileBounds, b: TileBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
export function contains(a: TileBounds, b: TileBounds): boolean {
  return (
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height
  );
}
export function freezeCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
export function assertInteger(
  context: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(
      `${context}: integer in [${min}, ${max}] required, got ${value}`,
    );
}
export function fail(message: string): never {
  throw new Error(`Procedural: ${message}`);
}
export function id(value: string, context: string): void {
  if (typeof value !== "string" || !value.length)
    fail(`${context} must be a non-empty string`);
}

export function templateUseLimit(
  definition: CatalogDefinition,
  templateId: string,
): number {
  const limits = definition.maxUses;
  return limits && Object.hasOwn(limits, templateId) ? limits[templateId]! : 64;
}
