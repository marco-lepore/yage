import {
  assertInteger,
  direction,
  fail,
  id,
  openings,
  openingPoint,
} from "./geometry.js";
import type { RoomTemplate } from "./types.js";

export function validateTemplate(template: RoomTemplate): void {
  id(template.id, "template id");
  const label = `template "${template.id}"`;
  const { width, height } = template.size;
  assertInteger(`${label} width`, width, 3, 64);
  assertInteger(`${label} height`, height, 3, 64);
  if (
    !template.kinds.length ||
    new Set(template.kinds).size !== template.kinds.length
  )
    fail(`${label} needs unique kinds`);
  template.kinds.forEach((kind) => id(kind, `${label} kind`));
  assertInteger(
    `${label} connection areas`,
    template.connections.length,
    0,
    64,
  );
  const areas = new Set<string>();
  for (const area of template.connections) {
    id(area.id, `${label} connection area`);
    if (areas.has(area.id)) fail(`${label} duplicate area "${area.id}"`);
    areas.add(area.id);
    if (!Object.hasOwn(direction, area.side))
      fail(`${label} invalid side "${area.side}"`);
    const extent =
      area.side === "north" || area.side === "south" ? width : height;
    assertInteger(`${label} opening width`, area.width ?? 1, 1, extent - 2);
    const min = typeof area.offset === "number" ? area.offset : area.offset.min;
    const max = typeof area.offset === "number" ? area.offset : area.offset.max;
    assertInteger(
      `${label} offset min`,
      min,
      1,
      extent - (area.width ?? 1) - 1,
    );
    assertInteger(
      `${label} offset max`,
      max,
      min,
      extent - (area.width ?? 1) - 1,
    );
    id(area.socket ?? "passage", `${label} socket`);
  }
  const cells = template.navigation;
  if (!cells) return;
  if (
    cells.length !== height ||
    cells.some((row) => row.length !== width || /[^.#]/u.test(row))
  )
    fail(`${label} navigation must match its size and contain only . and #`);
  const floor = new Set<string>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (cells[y]![x] === ".") {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
          fail(`${label} navigation boundary must be closed`);
        floor.add(`${x},${y}`);
      }
  if (!floor.size) fail(`${label} needs walkable interior cells`);
  const queue = [floor.values().next().value!];
  floor.delete(queue[0]!);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]!.split(",").map(Number) as [number, number];
    for (const d of Object.values(direction)) {
      const key = `${x + d.x},${y + d.y}`;
      if (floor.delete(key)) queue.push(key);
    }
  }
  if (floor.size) fail(`${label} navigation interior is disconnected`);
  for (const opening of openings(template)) {
    const p = openingPoint(template, opening),
      d = direction[opening.side];
    for (let i = 0; i < opening.width; i++) {
      const x = p.x - d.x + (d.x === 0 ? i : 0),
        y = p.y - d.y + (d.y === 0 ? i : 0);
      if (cells[y]![x] !== ".")
        fail(
          `${label} connection area "${opening.areaId}" must open onto walkable interior`,
        );
    }
  }
}
